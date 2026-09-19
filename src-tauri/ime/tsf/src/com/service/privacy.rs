//! Is this a password field? Asked of the document, answered to the host.
//!
//! The input scope is an application property on the context, readable only
//! under an edit session (a read lock is enough). It is read once per focus
//! change and reported as `Focus { private }`; the host keeps reading the
//! dictionary as usual and stops learning for that session. Applications
//! that set no scope are treated as ordinary — the keyboard-disabled
//! compartment covers password boxes in the applications that use it, and
//! is checked per key rather than here.

use std::cell::RefCell;
use std::rc::Rc;

use meridian_ime_proto::ClientMessage;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::TextServices::{
    GUID_PROP_INPUTSCOPE, ITfContext, ITfEditSession, ITfEditSession_Impl, ITfInsertAtSelection, TF_ES_READ,
    TF_IAS_QUERYONLY,
};
use windows::Win32::UI::TextServices::{
    IS_ALPHANUMERIC_PIN, IS_NUMERIC_PASSWORD, IS_NUMERIC_PIN, IS_PASSWORD, IS_PRIVATE, ITfInputScope, InputScope,
};
use windows_core::{IUnknown, Interface, Result, implement};

use crate::client::Client;
use crate::com::log;

/// Requests the read session; the report goes out from inside it.
pub fn read_and_report(ctx: &ITfContext, client: Rc<RefCell<Client>>, client_id: u32) {
    let session: ITfEditSession = PrivacySession {
        ctx: ctx.clone(),
        client,
    }
    .into();
    // SAFETY: COM call on the STA thread.
    let hr = unsafe { ctx.RequestEditSession(client_id, &session, TF_ES_READ) };
    if let Err(e) = hr {
        log::debug(&format!("privacy read session refused: {e}"));
    }
}

#[implement(ITfEditSession)]
struct PrivacySession {
    ctx: ITfContext,
    client: Rc<RefCell<Client>>,
}

impl ITfEditSession_Impl for PrivacySession_Impl {
    fn DoEditSession(&self, ec: u32) -> Result<()> {
        let private =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| is_private(&self.ctx, ec))).unwrap_or(false);
        let session_id = self.client.borrow().session_id();
        let mut client = self.client.borrow_mut();
        if client.is_connected() {
            let _ = client.request(&ClientMessage::Focus { session_id, private });
        }
        Ok(())
    }
}

fn is_private(ctx: &ITfContext, ec: u32) -> bool {
    // SAFETY: COM calls under a read edit cookie; the returned buffer is
    // freed with CoTaskMemFree as the interface documents.
    unsafe {
        let Ok(prop) = ctx.GetAppProperty(&GUID_PROP_INPUTSCOPE) else {
            return false;
        };
        let Ok(ias) = ctx.cast::<ITfInsertAtSelection>() else {
            return false;
        };
        let Ok(range) = ias.InsertTextAtSelection(ec, TF_IAS_QUERYONLY, &[]) else {
            return false;
        };
        let Ok(value) = prop.GetValue(ec, &range) else {
            return false;
        };
        let Ok(unknown) = IUnknown::try_from(&value) else {
            return false;
        };
        let Ok(scope) = unknown.cast::<ITfInputScope>() else {
            return false;
        };
        let mut scopes: *mut InputScope = std::ptr::null_mut();
        let mut count = 0u32;
        if scope.GetInputScopes(&mut scopes, &mut count).is_err() || scopes.is_null() {
            return false;
        }
        let list = std::slice::from_raw_parts(scopes, count as usize).to_vec();
        CoTaskMemFree(Some(scopes as *const _));
        list.iter().any(|s| {
            matches!(
                *s,
                IS_PASSWORD | IS_PRIVATE | IS_NUMERIC_PASSWORD | IS_NUMERIC_PIN | IS_ALPHANUMERIC_PIN
            )
        })
    }
}
