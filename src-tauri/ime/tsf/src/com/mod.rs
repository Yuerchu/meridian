//! The COM surface of the DLL: what `regsvr32` and `ctfmon` call.
//!
//! Every application that takes text input loads this library into its own
//! process, so it holds no engine, reads no file and computes no path. What
//! it does is register itself as a text service, forward keys to the host
//! over a named pipe, and apply the answers to the document. The engine's
//! mistakes happen in the host; a mistake here happens inside Word.

pub mod composition;
pub mod factory;
pub mod key;
pub mod log;
pub mod registry;
pub mod service;

use std::sync::atomic::{AtomicIsize, AtomicPtr, Ordering};

use windows::Win32::Foundation::{CLASS_E_CLASSNOTAVAILABLE, E_INVALIDARG, HINSTANCE, HMODULE, S_FALSE, S_OK, TRUE};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows_core::BOOL;
use windows_core::{GUID, HRESULT, IUnknown, Interface};

use meridian_ime_proto::ids;

/// The text service's class id. New for Meridian; never reuse the prototype's.
pub const CLSID_MERIDIAN_IME: GUID = GUID::from_u128(ids::CLSID);
/// Registry spelling of [`CLSID_MERIDIAN_IME`], braces and uppercase.
pub const CLSID_MERIDIAN_IME_STR: &str = ids::CLSID_STR;
/// The zh-CN profile: pinyin.
pub const GUID_PROFILE_PINYIN: GUID = GUID::from_u128(ids::PROFILE_PINYIN);
/// The zh-TW profile: zhuyin.
pub const GUID_PROFILE_ZHUYIN: GUID = GUID::from_u128(ids::PROFILE_ZHUYIN);
/// The display attribute the composition is drawn with (dotted underline).
pub const GUID_DISPLAY_ATTR_INPUT: GUID = GUID::from_u128(ids::DISPLAY_ATTR_INPUT);

pub const LANGID_ZH_CN: u16 = ids::LANGID_ZH_CN;
pub const LANGID_ZH_TW: u16 = ids::LANGID_ZH_TW;
pub const DISPLAY_NAME_PINYIN: &str = ids::DISPLAY_NAME_PINYIN;
pub const DISPLAY_NAME_ZHUYIN: &str = ids::DISPLAY_NAME_ZHUYIN;
/// The icon file the installer places beside the DLL.
pub const ICON_FILE_NAME: &str = ids::ICON_FILE_NAME;

static DLL_HINSTANCE: AtomicPtr<core::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());
/// Live COM objects this DLL handed out; `DllCanUnloadNow` says yes at zero.
static OBJECT_COUNT: AtomicIsize = AtomicIsize::new(0);

pub(crate) fn hinstance() -> HINSTANCE {
    HINSTANCE(DLL_HINSTANCE.load(Ordering::Relaxed))
}

pub(crate) fn object_created() {
    OBJECT_COUNT.fetch_add(1, Ordering::Relaxed);
}

pub(crate) fn object_destroyed() {
    OBJECT_COUNT.fetch_sub(1, Ordering::Relaxed);
}

/// Full path of this DLL, for the `InprocServer32` value.
pub fn module_path() -> Option<std::path::PathBuf> {
    let mut buf = vec![0u16; 1024];
    // SAFETY: `buf` is a valid, writable buffer of the stated length; the
    // module handle is the one `DllMain` recorded (or null for the process).
    let len = unsafe { GetModuleFileNameW(Some(HMODULE(hinstance().0)), &mut buf) } as usize;
    if len == 0 || len >= buf.len() {
        return None;
    }
    Some(std::path::PathBuf::from(String::from_utf16_lossy(&buf[..len])))
}

/// The directory the DLL sits in: where the host executable and the icon are.
pub fn module_dir() -> Option<std::path::PathBuf> {
    module_path().and_then(|p| p.parent().map(|d| d.to_path_buf()))
}

const DLL_PROCESS_ATTACH: u32 = 1;

#[unsafe(no_mangle)]
unsafe extern "system" fn DllMain(hinstance: HMODULE, reason: u32, _reserved: *mut core::ffi::c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        DLL_HINSTANCE.store(hinstance.0, Ordering::Relaxed);
    }
    TRUE
}

#[unsafe(no_mangle)]
unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut core::ffi::c_void,
) -> HRESULT {
    if ppv.is_null() || rclsid.is_null() || riid.is_null() {
        return E_INVALIDARG;
    }
    // SAFETY: checked non-null above; COM guarantees the pointees are valid
    // for the duration of the call.
    unsafe { *ppv = std::ptr::null_mut() };
    if unsafe { *rclsid } != CLSID_MERIDIAN_IME {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let unknown: IUnknown = factory::ClassFactory.into();
    unsafe { unknown.query(riid, ppv) }
}

#[unsafe(no_mangle)]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    if OBJECT_COUNT.load(Ordering::Relaxed) <= 0 {
        S_OK
    } else {
        S_FALSE
    }
}

/// `regsvr32 meridian_ime_tsf.dll`: the whole registration, so no separate
/// tool is needed and the installer can use the standard verb.
#[unsafe(no_mangle)]
extern "system" fn DllRegisterServer() -> HRESULT {
    match registry::register() {
        Ok(()) => S_OK,
        Err(e) => {
            log::warn(&format!("DllRegisterServer failed: {e}"));
            e.into()
        }
    }
}

#[unsafe(no_mangle)]
extern "system" fn DllUnregisterServer() -> HRESULT {
    match registry::unregister() {
        Ok(()) => S_OK,
        Err(e) => {
            log::warn(&format!("DllUnregisterServer failed: {e}"));
            e.into()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clsid_string_matches_constant() {
        assert_eq!(registry::guid_string(&CLSID_MERIDIAN_IME), CLSID_MERIDIAN_IME_STR);
    }

    #[test]
    fn guids_are_distinct() {
        let all = [
            CLSID_MERIDIAN_IME,
            GUID_PROFILE_PINYIN,
            GUID_PROFILE_ZHUYIN,
            GUID_DISPLAY_ATTR_INPUT,
        ];
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }
}
