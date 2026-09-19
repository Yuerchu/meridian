//! How the composition is drawn: one display attribute, a dotted underline
//! in the application's own colours.

use std::cell::Cell;

use windows::Win32::Foundation::{E_INVALIDARG, S_FALSE};
use windows::Win32::UI::TextServices::{
    IEnumTfDisplayAttributeInfo, IEnumTfDisplayAttributeInfo_Impl, ITfDisplayAttributeInfo,
    ITfDisplayAttributeInfo_Impl, ITfDisplayAttributeProvider_Impl, TF_ATTR_INPUT, TF_CT_NONE, TF_DA_COLOR,
    TF_DA_COLOR_0, TF_DISPLAYATTRIBUTE, TF_LS_DOT,
};
use windows_core::{BSTR, GUID, OutRef, Result, implement};

use super::TextService_Impl;

const DESCRIPTION: &str = "Meridian 输入法组字";

fn attribute() -> TF_DISPLAYATTRIBUTE {
    let none = TF_DA_COLOR {
        r#type: TF_CT_NONE,
        Anonymous: TF_DA_COLOR_0 { nIndex: 0 },
    };
    TF_DISPLAYATTRIBUTE {
        crText: none,
        crBk: none,
        lsStyle: TF_LS_DOT,
        fBoldLine: false.into(),
        crLine: none,
        bAttr: TF_ATTR_INPUT,
    }
}

impl ITfDisplayAttributeProvider_Impl for TextService_Impl {
    fn EnumDisplayAttributeInfo(&self) -> Result<IEnumTfDisplayAttributeInfo> {
        Ok(Enumerator { index: Cell::new(0) }.into())
    }

    fn GetDisplayAttributeInfo(&self, guid: *const GUID) -> Result<ITfDisplayAttributeInfo> {
        // SAFETY: TSF passes a valid GUID pointer.
        let guid = unsafe { guid.as_ref() }.ok_or_else(|| windows_core::Error::from(E_INVALIDARG))?;
        if *guid != crate::com::GUID_DISPLAY_ATTR_INPUT {
            return Err(E_INVALIDARG.into());
        }
        Ok(Info.into())
    }
}

#[implement(ITfDisplayAttributeInfo)]
struct Info;

impl ITfDisplayAttributeInfo_Impl for Info_Impl {
    fn GetGUID(&self) -> Result<GUID> {
        Ok(crate::com::GUID_DISPLAY_ATTR_INPUT)
    }

    fn GetDescription(&self) -> Result<BSTR> {
        Ok(BSTR::from(DESCRIPTION))
    }

    fn GetAttributeInfo(&self, out: *mut TF_DISPLAYATTRIBUTE) -> Result<()> {
        if out.is_null() {
            return Err(E_INVALIDARG.into());
        }
        // SAFETY: checked non-null; TSF owns the target.
        unsafe { *out = attribute() };
        Ok(())
    }

    fn SetAttributeInfo(&self, _attr: *const TF_DISPLAYATTRIBUTE) -> Result<()> {
        Ok(())
    }

    fn Reset(&self) -> Result<()> {
        Ok(())
    }
}

#[implement(IEnumTfDisplayAttributeInfo)]
struct Enumerator {
    index: Cell<u32>,
}

impl IEnumTfDisplayAttributeInfo_Impl for Enumerator_Impl {
    fn Clone(&self) -> Result<IEnumTfDisplayAttributeInfo> {
        Ok(Enumerator {
            index: Cell::new(self.index.get()),
        }
        .into())
    }

    fn Next(&self, count: u32, out: *mut Option<ITfDisplayAttributeInfo>, fetched: *mut u32) -> Result<()> {
        let mut n = 0u32;
        if count > 0 && self.index.get() == 0 && !out.is_null() {
            // SAFETY: TSF provides an array of `count` slots.
            unsafe { *out = Some(Info.into()) };
            self.index.set(1);
            n = 1;
        }
        if !fetched.is_null() {
            // SAFETY: valid out-pointer when non-null.
            unsafe { *fetched = n };
        }
        if n == count { Ok(()) } else { Err(S_FALSE.into()) }
    }

    fn Reset(&self) -> Result<()> {
        self.index.set(0);
        Ok(())
    }

    fn Skip(&self, count: u32) -> Result<()> {
        self.index.set(self.index.get() + count);
        Ok(())
    }
}

// `OutRef` appears in some windows-rs signatures for these interfaces; keep
// the import visible so a signature change is a compile error here.
#[allow(unused_imports)]
use OutRef as _;
