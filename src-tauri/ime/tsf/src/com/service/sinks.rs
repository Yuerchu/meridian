//! The sinks that are not about keys: focus, the compartment, the profile,
//! and the caret.

use meridian_ime_proto::ClientMessage;
use windows::Win32::UI::TextServices::{
    GUID_COMPARTMENT_KEYBOARD_OPENCLOSE, ITfActiveLanguageProfileNotifySink_Impl, ITfCompartmentEventSink_Impl,
    ITfContext, ITfDocumentMgr, ITfEditRecord, ITfTextEditSink_Impl, ITfThreadMgrEventSink_Impl,
};
use windows_core::{BOOL, GUID, Interface, Ref, Result};

use super::{TextService_Impl, guarded, profile_of};

impl ITfThreadMgrEventSink_Impl for TextService_Impl {
    fn OnInitDocumentMgr(&self, _pdim: Ref<'_, ITfDocumentMgr>) -> Result<()> {
        Ok(())
    }

    fn OnUninitDocumentMgr(&self, _pdim: Ref<'_, ITfDocumentMgr>) -> Result<()> {
        Ok(())
    }

    /// The focused document changed: whatever was being composed is left as
    /// it stands, the host forgets its buffer, and the new document's
    /// sensitivity is read.
    fn OnSetFocus(&self, pdim_focus: Ref<'_, ITfDocumentMgr>, _pdim_prev: Ref<'_, ITfDocumentMgr>) -> Result<()> {
        guarded("ThreadMgr::OnSetFocus", (), || {
            if self.shared.is_composing() || self.shared.has_composition() {
                self.shared.finish_as_is();
            }
            self.shift_tap.set(false);
            self.shared.set_predicting(false);
            let session_id = self.client.borrow().session_id();
            if self.client.borrow().is_connected() {
                let _ = self.client.borrow_mut().request(&ClientMessage::Reset { session_id });
            }
            // SAFETY: COM call on a live document manager.
            let top = pdim_focus.as_ref().and_then(|dim| unsafe { dim.GetTop() }.ok());
            self.watch_edits(top.as_ref());
            if self.secure.get() {
                return;
            }
            if let Some(ctx) = &top {
                super::privacy::read_and_report(ctx, self.client.clone(), self.client_id.get());
            }
        });
        Ok(())
    }

    fn OnPushContext(&self, _pic: Ref<'_, ITfContext>) -> Result<()> {
        Ok(())
    }

    fn OnPopContext(&self, _pic: Ref<'_, ITfContext>) -> Result<()> {
        Ok(())
    }
}

/// A prediction list belongs where the caret was when it was offered. The
/// keys that move the caret already close it on their way to the
/// application; this catches the mouse, and anything else that moves the
/// selection without a key. Our own commits move it too, and are skipped.
impl ITfTextEditSink_Impl for TextService_Impl {
    fn OnEndEdit(&self, _pic: Ref<'_, ITfContext>, _ec: u32, record: Ref<'_, ITfEditRecord>) -> Result<()> {
        guarded("TextEdit::OnEndEdit", (), || {
            if self.shared.take_own_edit() || !self.shared.is_predicting() {
                return;
            }
            // SAFETY: COM call on the record TSF handed us for this call.
            let moved = record
                .as_ref()
                .and_then(|r| unsafe { r.GetSelectionStatus() }.ok())
                .is_some_and(|b| b.as_bool());
            if moved {
                self.dismiss();
            }
        });
        Ok(())
    }
}

impl ITfCompartmentEventSink_Impl for TextService_Impl {
    fn OnChange(&self, rguid: *const GUID) -> Result<()> {
        guarded("Compartment::OnChange", (), || {
            // SAFETY: TSF passes a valid GUID pointer.
            let guid = unsafe { rguid.as_ref() };
            if guid == Some(&GUID_COMPARTMENT_KEYBOARD_OPENCLOSE) {
                self.on_openclose_changed();
            }
        });
        Ok(())
    }
}

impl ITfActiveLanguageProfileNotifySink_Impl for TextService_Impl {
    fn OnActivated(&self, clsid: *const GUID, guid_profile: *const GUID, activated: BOOL) -> Result<()> {
        guarded("Profile::OnActivated", (), || {
            // SAFETY: TSF passes valid GUID pointers.
            let (Some(clsid), Some(profile)) = (unsafe { clsid.as_ref() }, unsafe { guid_profile.as_ref() }) else {
                return;
            };
            if *clsid != crate::com::CLSID_MERIDIAN_IME || !activated.as_bool() {
                return;
            }
            let profile = profile_of(profile);
            if self.shared.is_composing() {
                self.shared.finish_as_is();
            }
            self.client.borrow_mut().set_profile(profile);
            if !self.secure.get() {
                let _ = self.client.borrow_mut().connection();
            }
            crate::com::log::info(&format!("profile switched to {profile:?}"));
        });
        Ok(())
    }
}

// `Interface` is used by the `cast` calls in the parent module; re-exported
// here so the compiler sees one import path for both files.
#[allow(unused_imports)]
use Interface as _;
