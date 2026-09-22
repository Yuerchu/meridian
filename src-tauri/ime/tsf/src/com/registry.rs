//! Registering the text service: the COM class, two language profiles and
//! the categories that make TSF list it.
//!
//! `regsvr32` runs elevated, so `HKEY_CLASSES_ROOT` here means the machine
//! hive. The profile registration writes under `HKLM\SOFTWARE\Microsoft\CTF`
//! through `ITfInputProcessorProfileMgr`, which is the only way `ctfmon`
//! learns a TIP exists. The categories are not optional decoration: without
//! `IMMERSIVESUPPORT` and `SYSTRAYSUPPORT` the profile shows up in the
//! settings list and vanishes from the switcher.

use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Input::KeyboardAndMouse::HKL;
use windows::Win32::UI::TextServices::{
    CLSID_TF_CategoryMgr, CLSID_TF_InputProcessorProfiles, GUID_TFCAT_DISPLAYATTRIBUTEPROVIDER,
    GUID_TFCAT_TIP_KEYBOARD, GUID_TFCAT_TIPCAP_COMLESS, GUID_TFCAT_TIPCAP_IMMERSIVESUPPORT,
    GUID_TFCAT_TIPCAP_INPUTMODECOMPARTMENT, GUID_TFCAT_TIPCAP_SECUREMODE, GUID_TFCAT_TIPCAP_SYSTRAYSUPPORT,
    GUID_TFCAT_TIPCAP_UIELEMENTENABLED, ITfCategoryMgr, ITfInputProcessorProfileMgr,
};
use windows_core::{Error, GUID, HRESULT, Result};
use windows_registry::CLASSES_ROOT;

use super::*;

const CATEGORIES: [GUID; 8] = [
    GUID_TFCAT_TIP_KEYBOARD,
    GUID_TFCAT_TIPCAP_UIELEMENTENABLED,
    GUID_TFCAT_TIPCAP_SECUREMODE,
    GUID_TFCAT_TIPCAP_COMLESS,
    GUID_TFCAT_TIPCAP_INPUTMODECOMPARTMENT,
    GUID_TFCAT_TIPCAP_IMMERSIVESUPPORT,
    GUID_TFCAT_TIPCAP_SYSTRAYSUPPORT,
    GUID_TFCAT_DISPLAYATTRIBUTEPROVIDER,
];

/// `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`, uppercase, as the registry wants it.
pub fn guid_string(g: &GUID) -> String {
    format!(
        "{{{:08X}-{:04X}-{:04X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}}}",
        g.data1,
        g.data2,
        g.data3,
        g.data4[0],
        g.data4[1],
        g.data4[2],
        g.data4[3],
        g.data4[4],
        g.data4[5],
        g.data4[6],
        g.data4[7],
    )
}

/// Runs `f` inside an apartment; a thread that already initialised COM in
/// another mode is used as it is.
fn with_com<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    // SAFETY: plain COM initialisation on this thread, paired below.
    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let initialised = hr.is_ok();
    let out = f();
    if initialised {
        // SAFETY: balances the successful CoInitializeEx above.
        unsafe { CoUninitialize() };
    }
    out
}

pub fn register() -> Result<()> {
    let dll = module_path().ok_or_else(|| Error::new(HRESULT(-1), "cannot resolve the DLL's own path"))?;
    let dll_str = dll.to_string_lossy().into_owned();
    let icon = dll.with_file_name(ICON_FILE_NAME);
    let icon_wide: Vec<u16> = if icon.exists() {
        icon.to_string_lossy().encode_utf16().collect()
    } else {
        Vec::new()
    };

    let key = CLASSES_ROOT
        .create(format!("CLSID\\{CLSID_MERIDIAN_IME_STR}\\InprocServer32"))
        .map_err(|e| Error::new(e.code(), "cannot create the CLSID key (run elevated)"))?;
    key.set_string("", &dll_str)
        .map_err(|e| Error::new(e.code(), "cannot write InprocServer32"))?;
    key.set_string("ThreadingModel", "Apartment")
        .map_err(|e| Error::new(e.code(), "cannot write ThreadingModel"))?;
    CLASSES_ROOT
        .create(format!("CLSID\\{CLSID_MERIDIAN_IME_STR}"))
        .and_then(|k| k.set_string("", DISPLAY_NAME_PINYIN))
        .map_err(|e| Error::new(e.code(), "cannot name the CLSID"))?;

    with_com(|| {
        // SAFETY: standard COM object creation and calls on an apartment thread.
        unsafe {
            let profiles: ITfInputProcessorProfileMgr =
                CoCreateInstance(&CLSID_TF_InputProcessorProfiles, None, CLSCTX_INPROC_SERVER)?;
            let desc_pinyin: Vec<u16> = DISPLAY_NAME_PINYIN.encode_utf16().collect();
            profiles.RegisterProfile(
                &CLSID_MERIDIAN_IME,
                LANGID_ZH_CN,
                &GUID_PROFILE_PINYIN,
                &desc_pinyin,
                &icon_wide,
                0,
                HKL::default(),
                0,
                true,
                0,
            )?;
            let desc_zhuyin: Vec<u16> = DISPLAY_NAME_ZHUYIN.encode_utf16().collect();
            profiles.RegisterProfile(
                &CLSID_MERIDIAN_IME,
                LANGID_ZH_TW,
                &GUID_PROFILE_ZHUYIN,
                &desc_zhuyin,
                &icon_wide,
                0,
                HKL::default(),
                0,
                true,
                0,
            )?;
            let categories: ITfCategoryMgr = CoCreateInstance(&CLSID_TF_CategoryMgr, None, CLSCTX_INPROC_SERVER)?;
            for cat in &CATEGORIES {
                categories.RegisterCategory(&CLSID_MERIDIAN_IME, cat, &CLSID_MERIDIAN_IME)?;
            }
        }
        Ok(())
    })?;
    log::info(&format!("registered {dll_str}"));
    Ok(())
}

/// Best effort: every step is attempted even when an earlier one fails, and
/// only the first error is reported.
pub fn unregister() -> Result<()> {
    let mut first_err: Option<Error> = None;
    let com_result = with_com(|| {
        // SAFETY: as in `register`.
        unsafe {
            if let Ok(categories) =
                CoCreateInstance::<_, ITfCategoryMgr>(&CLSID_TF_CategoryMgr, None, CLSCTX_INPROC_SERVER)
            {
                for cat in &CATEGORIES {
                    let _ = categories.UnregisterCategory(&CLSID_MERIDIAN_IME, cat, &CLSID_MERIDIAN_IME);
                }
            }
            let profiles: ITfInputProcessorProfileMgr =
                CoCreateInstance(&CLSID_TF_InputProcessorProfiles, None, CLSCTX_INPROC_SERVER)?;
            let a = profiles.UnregisterProfile(&CLSID_MERIDIAN_IME, LANGID_ZH_CN, &GUID_PROFILE_PINYIN, 0);
            let b = profiles.UnregisterProfile(&CLSID_MERIDIAN_IME, LANGID_ZH_TW, &GUID_PROFILE_ZHUYIN, 0);
            a.and(b)
        }
    });
    if let Err(e) = com_result {
        first_err.get_or_insert(e);
    }
    if let Err(e) = CLASSES_ROOT.remove_tree(format!("CLSID\\{CLSID_MERIDIAN_IME_STR}")) {
        // A key that is already gone is not a failure to remove it.
        if e.code() != HRESULT::from_win32(2) {
            first_err.get_or_insert(Error::new(e.code(), "cannot remove the CLSID key"));
        }
    }
    log::info("unregistered");
    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}
