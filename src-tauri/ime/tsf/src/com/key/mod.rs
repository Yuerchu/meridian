//! From a Win32 key message to a [`KeyEvent`], and the pure decision of
//! whether the text service eats a key.

use meridian_ime_proto::{KeyEvent, Modifiers};
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, GetKeyboardLayout, GetKeyboardState, ToUnicodeEx, VK_CAPITAL, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN,
    VK_SHIFT,
};

pub const VK_BACK: u32 = 0x08;
pub const VK_TAB: u32 = 0x09;
pub const VK_RETURN: u32 = 0x0D;
pub const VK_SHIFT_: u32 = 0x10;
pub const VK_ESCAPE: u32 = 0x1B;
pub const VK_SPACE: u32 = 0x20;
pub const VK_PRIOR: u32 = 0x21;
pub const VK_NEXT: u32 = 0x22;
pub const VK_END: u32 = 0x23;
pub const VK_HOME: u32 = 0x24;
pub const VK_LEFT: u32 = 0x25;
pub const VK_UP: u32 = 0x26;
pub const VK_RIGHT: u32 = 0x27;
pub const VK_DOWN: u32 = 0x28;
pub const VK_DELETE: u32 = 0x2E;
pub const VK_LSHIFT: u32 = 0xA0;
pub const VK_RSHIFT: u32 = 0xA1;

/// Reads the modifier state and the character the key produces.
pub fn event_from(wparam: WPARAM, lparam: LPARAM) -> KeyEvent {
    let vk = wparam.0 as u32;
    let scancode = ((lparam.0 >> 16) & 0xFF) as u32;
    // SAFETY: plain state queries; the buffers are valid for the call.
    let (mods, caps_lock, ch) = unsafe {
        let down = |k: i32| GetKeyState(k) < 0;
        let mods = Modifiers {
            ctrl: down(VK_CONTROL.0 as i32),
            shift: down(VK_SHIFT.0 as i32),
            alt: down(VK_MENU.0 as i32),
            win: down(VK_LWIN.0 as i32) || down(VK_RWIN.0 as i32),
        };
        let caps_lock = (GetKeyState(VK_CAPITAL.0 as i32) & 1) != 0;
        let ch = if mods.ctrl || mods.alt || mods.win {
            None
        } else {
            let mut state = [0u8; 256];
            let _ = GetKeyboardState(&mut state);
            let mut buf = [0u16; 4];
            let layout = GetKeyboardLayout(0);
            // Bit 2: do not change the keyboard's dead-key state.
            let n = ToUnicodeEx(vk, scancode, &state, &mut buf, 1 << 2, Some(layout));
            if n == 1 {
                char::from_u32(buf[0] as u32).filter(|c| !c.is_control())
            } else {
                None
            }
        };
        (mods, caps_lock, ch)
    };
    KeyEvent {
        vk,
        ch,
        mods,
        caps_lock,
    }
}

/// Whether a key is ours, decided before asking the host so that
/// `OnTestKeyDown` and `OnKeyDown` agree and the application is told the
/// same thing twice. Mirrors the session's own rules: modifiers pass;
/// English mode passes everything; a letter is always ours in Chinese mode;
/// while composing every editing key and every printable key is ours;
/// when not composing a printable non-letter is ours only when the host may
/// turn it into full-width punctuation.
pub fn eats_key(ev: &KeyEvent, composing: bool, chinese_mode: bool, full_width_punctuation: bool) -> bool {
    if ev.mods.ctrl || ev.mods.alt || ev.mods.win {
        return false;
    }
    if !chinese_mode || ev.caps_lock {
        return false;
    }
    if let Some(ch) = ev.ch
        && ch.is_ascii_alphabetic()
    {
        return true;
    }
    if composing {
        return match ev.vk {
            VK_BACK | VK_TAB | VK_RETURN | VK_ESCAPE | VK_SPACE | VK_PRIOR | VK_NEXT | VK_END | VK_HOME | VK_LEFT
            | VK_UP | VK_RIGHT | VK_DOWN | VK_DELETE => true,
            _ => ev.ch.is_some_and(|c| !c.is_control()),
        };
    }
    full_width_punctuation && ev.ch.is_some_and(meridian_ime_proto_punct::is_full_width_candidate)
}

/// The punctuation the session may replace, kept here so the two ends of the
/// pipe agree on what is worth asking about.
mod meridian_ime_proto_punct {
    pub fn is_full_width_candidate(c: char) -> bool {
        matches!(
            c,
            ',' | '.'
                | '?'
                | '!'
                | ':'
                | ';'
                | '('
                | ')'
                | '['
                | ']'
                | '<'
                | '>'
                | '\\'
                | '^'
                | '_'
                | '$'
                | '~'
                | '"'
                | '\''
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(ch: Option<char>, vk: u32) -> KeyEvent {
        KeyEvent {
            vk,
            ch,
            mods: Modifiers::default(),
            caps_lock: false,
        }
    }

    #[test]
    fn decision_table() {
        assert!(eats_key(&key(Some('a'), 0x41), false, true, true));
        assert!(!eats_key(&key(Some('a'), 0x41), false, false, true), "english mode");
        let mut caps = key(Some('A'), 0x41);
        caps.caps_lock = true;
        assert!(!eats_key(&caps, false, true, true));
        let mut ctrl = key(Some('c'), 0x43);
        ctrl.mods.ctrl = true;
        assert!(!eats_key(&ctrl, true, true, true));
        assert!(
            !eats_key(&key(Some('1'), 0x31), false, true, true),
            "digit outside composition"
        );
        assert!(
            eats_key(&key(Some('1'), 0x31), true, true, true),
            "digit selects while composing"
        );
        assert!(eats_key(&key(None, VK_BACK), true, true, true));
        assert!(!eats_key(&key(None, VK_BACK), false, true, true));
        assert!(
            eats_key(&key(Some(','), 0xBC), false, true, true),
            "punctuation may become full-width"
        );
        assert!(!eats_key(&key(Some(','), 0xBC), false, true, false));
        assert!(!eats_key(&key(Some('3'), 0x33), false, true, true));
    }
}
