//! Windows virtual-key codes the state machine matches on. Printable keys
//! are matched on `KeyEvent::ch` instead, so these are only the function keys.

pub const VK_BACK: u32 = 0x08;
pub const VK_TAB: u32 = 0x09;
pub const VK_RETURN: u32 = 0x0D;
pub const VK_SHIFT: u32 = 0x10;
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

/// Builds a key event for a printable character with no modifiers, the way
/// the CLI's script replay and the tests do.
pub fn printable(ch: char) -> meridian_ime_proto::KeyEvent {
    let vk = match ch {
        'a'..='z' => (ch as u8 - b'a' + 0x41) as u32,
        'A'..='Z' => (ch as u8 - b'A' + 0x41) as u32,
        '0'..='9' => (ch as u8 - b'0' + 0x30) as u32,
        ' ' => VK_SPACE,
        _ => 0,
    };
    meridian_ime_proto::KeyEvent {
        vk,
        ch: Some(ch),
        mods: meridian_ime_proto::Modifiers {
            shift: ch.is_ascii_uppercase(),
            ..Default::default()
        },
        caps_lock: false,
    }
}

/// A function key with no character.
pub fn function(vk: u32) -> meridian_ime_proto::KeyEvent {
    meridian_ime_proto::KeyEvent {
        vk,
        ch: None,
        mods: Default::default(),
        caps_lock: false,
    }
}
