//! What crosses JNI, decoded. Kept apart from the `extern` functions so it is
//! tested on the desktop: the Android side only moves values in and out.
//!
//! A key crosses as four integers rather than JSON, since there is one per
//! keystroke and the fields are fixed. Everything coming back is JSON of the
//! types `meridian-ime-session` already serialises, mirrored by
//! `@Serializable` classes in `EngineBridge.kt`.

use meridian_ime_engine::InputScheme;
use meridian_ime_proto::{KeyEvent, Modifiers};

/// Modifier bits as `Vk.kt` packs them.
pub const MOD_SHIFT: i32 = 1;
pub const MOD_CTRL: i32 = 2;
pub const MOD_ALT: i32 = 4;
/// Android's Meta, which the session treats as Windows' Win key: a shortcut,
/// never text.
pub const MOD_META: i32 = 8;

/// A key from the keyboard: `vk` a Windows virtual-key code (0 for a key that
/// is only a character, such as a grid key), `ch` a Unicode scalar or
/// negative for none.
pub fn key_event(vk: i32, ch: i32, mods: i32, caps_lock: bool) -> Result<KeyEvent, String> {
    let vk = u32::try_from(vk).map_err(|_| format!("negative virtual key {vk}"))?;
    let ch = if ch < 0 {
        None
    } else {
        Some(char::from_u32(ch as u32).ok_or_else(|| format!("{ch:#x} is not a Unicode scalar"))?)
    };
    if mods & !(MOD_SHIFT | MOD_CTRL | MOD_ALT | MOD_META) != 0 {
        return Err(format!("unknown modifier bits {mods:#x}"));
    }
    Ok(KeyEvent {
        vk,
        ch,
        mods: Modifiers {
            shift: mods & MOD_SHIFT != 0,
            ctrl: mods & MOD_CTRL != 0,
            alt: mods & MOD_ALT != 0,
            win: mods & MOD_META != 0,
        },
        caps_lock,
    })
}

/// The scheme a layer types, by the name `host.json` uses; `None` is the
/// configured one. An unknown name is an error, not the default.
pub fn scheme(name: Option<&str>) -> Result<Option<InputScheme>, String> {
    match name {
        None => Ok(None),
        Some("pinyin") => Ok(Some(InputScheme::Pinyin)),
        Some("zhuyin") => Ok(Some(InputScheme::Zhuyin)),
        Some("grid") => Ok(Some(InputScheme::Grid)),
        Some(other) => Err(format!("unknown scheme {other:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_decode_and_garbage_is_refused() {
        let e = key_event(0x41, 'a' as i32, 0, false).unwrap();
        assert_eq!((e.vk, e.ch), (0x41, Some('a')));
        assert!(!e.mods.shift && !e.mods.ctrl);

        let e = key_event(0, 0xE005, 0, false).unwrap();
        assert_eq!(e.ch, Some('\u{E005}'), "a grid key is a character with no virtual key");

        let e = key_event(0x08, -1, MOD_CTRL | MOD_META, true).unwrap();
        assert_eq!(e.ch, None);
        assert!(e.mods.ctrl && e.mods.win && !e.mods.alt && e.caps_lock);

        assert!(key_event(-1, -1, 0, false).is_err());
        assert!(key_event(0, 0xD800, 0, false).is_err(), "a surrogate is not a char");
        assert!(key_event(0, 'a' as i32, 16, false).is_err());
    }

    #[test]
    fn schemes_by_name_only() {
        assert_eq!(scheme(None), Ok(None));
        assert_eq!(scheme(Some("grid")), Ok(Some(InputScheme::Grid)));
        assert_eq!(scheme(Some("zhuyin")), Ok(Some(InputScheme::Zhuyin)));
        assert!(scheme(Some("Grid")).is_err());
        assert!(scheme(Some("")).is_err());
    }
}
