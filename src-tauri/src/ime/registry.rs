//! Is the text service registered, and is it switched on for this user?
//!
//! Registration is machine-wide and needs elevation (`regsvr32` on the DLL,
//! which the installer runs). Whether the profile is enabled for the current
//! user is a per-user setting TSF keeps under HKCU and lets an ordinary
//! process change through `ITfInputProcessorProfiles::EnableLanguageProfile`
//! — which is how "turn it on for me" works without a prompt.

use meridian_ime_proto::ids;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Input::KeyboardAndMouse::HKL;
use windows::Win32::UI::TextServices::{
    CLSID_TF_InputProcessorProfiles, ITfInputProcessorProfileMgr, ITfInputProcessorProfiles, TF_INPUTPROCESSORPROFILE,
    TF_IPP_FLAG_ENABLED, TF_PROFILETYPE_INPUTPROCESSOR,
};
use windows_core::GUID;
use windows_registry::LOCAL_MACHINE;

const CLSID: GUID = GUID::from_u128(ids::CLSID);
const PROFILE_PINYIN: GUID = GUID::from_u128(ids::PROFILE_PINYIN);
const PROFILE_ZHUYIN: GUID = GUID::from_u128(ids::PROFILE_ZHUYIN);

/// The 64-bit COM registration exists.
pub fn is_registered_x64() -> bool {
    LOCAL_MACHINE
        .open(format!("SOFTWARE\\Classes\\CLSID\\{}\\InprocServer32", ids::CLSID_STR))
        .is_ok()
}

/// The 32-bit COM registration exists (the WOW6432Node view).
pub fn is_registered_x86() -> bool {
    LOCAL_MACHINE
        .open(format!(
            "SOFTWARE\\Classes\\WOW6432Node\\CLSID\\{}\\InprocServer32",
            ids::CLSID_STR
        ))
        .is_ok()
}

/// The path the 64-bit registration points at, for the status page.
pub fn registered_dll_x64() -> Option<String> {
    LOCAL_MACHINE
        .open(format!("SOFTWARE\\Classes\\CLSID\\{}\\InprocServer32", ids::CLSID_STR))
        .ok()
        .and_then(|k| k.get_string("").ok())
}

fn with_com<T>(f: impl FnOnce() -> T) -> T {
    // SAFETY: COM initialisation on this thread, paired below.
    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let out = f();
    if hr.is_ok() {
        // SAFETY: balances the successful initialisation above.
        unsafe { CoUninitialize() };
    }
    out
}

/// Whether the pinyin profile is enabled for the current user.
pub fn is_enabled_for_user() -> bool {
    with_com(|| {
        // SAFETY: COM calls on an apartment thread.
        unsafe {
            let Ok(mgr) = CoCreateInstance::<_, ITfInputProcessorProfileMgr>(
                &CLSID_TF_InputProcessorProfiles,
                None,
                CLSCTX_INPROC_SERVER,
            ) else {
                return false;
            };
            let mut profile = TF_INPUTPROCESSORPROFILE::default();
            if mgr
                .GetProfile(
                    TF_PROFILETYPE_INPUTPROCESSOR,
                    ids::LANGID_ZH_CN,
                    &CLSID,
                    &PROFILE_PINYIN,
                    HKL::default(),
                    &mut profile,
                )
                .is_err()
            {
                return false;
            }
            profile.dwFlags & TF_IPP_FLAG_ENABLED != 0
        }
    })
}

/// Enables or disables both profiles for the current user. Needs the
/// machine-wide registration to exist first.
pub fn set_enabled_for_user(enabled: bool) -> Result<(), String> {
    with_com(|| {
        // SAFETY: COM calls on an apartment thread.
        unsafe {
            let profiles: ITfInputProcessorProfiles =
                CoCreateInstance(&CLSID_TF_InputProcessorProfiles, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| e.to_string())?;
            profiles
                .EnableLanguageProfile(&CLSID, ids::LANGID_ZH_CN, &PROFILE_PINYIN, enabled)
                .map_err(|e| format!("pinyin profile: {e}"))?;
            profiles
                .EnableLanguageProfile(&CLSID, ids::LANGID_ZH_TW, &PROFILE_ZHUYIN, enabled)
                .map_err(|e| format!("zhuyin profile: {e}"))?;
            Ok(())
        }
    })
}
