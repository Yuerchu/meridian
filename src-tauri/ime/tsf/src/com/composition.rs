//! The composition: what the document shows while keys are being typed, and
//! the edit sessions that change it.
//!
//! TSF never lets a text service touch the document directly. Every change
//! is an `ITfEditSession` handed to `ITfContext::RequestEditSession`, which
//! calls back `DoEditSession(ec)` once it holds the document lock; the edit
//! cookie `ec` is the proof of that lock and every range call takes it. The
//! sessions here are always asynchronous (`TF_ES_READWRITE` without
//! `TF_ES_SYNC`): a synchronous session inside the key sink is documented as
//! allowed and measured to crash applications whose text store lives in
//! another process (the current Notepad). Asynchronous means the callback
//! runs after `OnKeyDown` has returned, on the same thread, so the local
//! view of "are we composing" is updated from the host's reply before the
//! session is even requested, and `OnTestKeyDown` never disagrees with a
//! document that has not caught up yet.

use std::cell::{Cell, RefCell};
use std::mem::ManuallyDrop;
use std::rc::Rc;

use meridian_ime_proto::{ClientMessage, Rect};
use windows::Win32::Foundation::{E_FAIL, RECT};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::TextServices::{
    GUID_PROP_ATTRIBUTE, INSERT_TEXT_AT_SELECTION_FLAGS, ITfComposition, ITfCompositionSink, ITfCompositionSink_Impl,
    ITfContext, ITfContextComposition, ITfEditSession, ITfEditSession_Impl, ITfInsertAtSelection, ITfRange, TF_AE_NONE,
    TF_ANCHOR_END, TF_ES_READWRITE, TF_IAS_QUERYONLY, TF_SELECTION, TF_SELECTIONSTYLE,
};
use windows_core::{BOOL, Interface, Ref, Result, implement};

use super::log;
use crate::client::Client;

/// Composition state shared between the text service, the edit sessions and
/// the composition sink. Single-threaded by construction: TSF calls a text
/// service on the thread that activated it.
#[derive(Default)]
pub struct Shared {
    composition: RefCell<Option<ITfComposition>>,
    /// The context the composition was started in.
    context: RefCell<Option<ITfContext>>,
    /// The local view: `true` between the first eaten key and the commit,
    /// updated from the host's reply ahead of the document.
    composing: Cell<bool>,
    /// The display attribute atom (`RegisterGUID`), resolved once.
    attr_atom: Cell<Option<u32>>,
    /// The application ended the composition itself; the host must be told
    /// to drop its buffer before the next key.
    server_stale: Cell<bool>,
    client_id: Cell<u32>,
}

impl Shared {
    pub fn set_client_id(&self, id: u32) {
        self.client_id.set(id);
    }

    pub fn set_attr_atom(&self, atom: u32) {
        self.attr_atom.set(Some(atom));
    }

    pub fn is_composing(&self) -> bool {
        self.composing.get()
    }

    pub fn set_composing(&self, on: bool) {
        self.composing.set(on);
    }

    pub fn take_server_stale(&self) -> bool {
        self.server_stale.take()
    }

    pub fn has_composition(&self) -> bool {
        self.composition.borrow().is_some()
    }

    /// The application terminated the composition (focus moved, a click
    /// elsewhere, a spreadsheet cell closing). The text is left as the
    /// application decided; we only forget it.
    pub fn terminated(&self) {
        *self.composition.borrow_mut() = None;
        *self.context.borrow_mut() = None;
        self.composing.set(false);
        self.server_stale.set(true);
    }

    /// Requests an asynchronous edit session applying `commit` and then the
    /// preedit (an empty preedit ends the composition). The measured
    /// rectangle is reported to the host through `client` from inside the
    /// session, which is the only place it can be measured.
    pub fn apply(
        self: &Rc<Self>,
        ctx: &ITfContext,
        commit: Option<String>,
        preedit: String,
        client: Rc<RefCell<Client>>,
    ) {
        let session: ITfEditSession = ApplySession {
            shared: self.clone(),
            ctx: ctx.clone(),
            commit,
            preedit,
            client,
        }
        .into();
        self.request(ctx, &session);
    }

    /// Requests an edit session that leaves the composed text as plain text
    /// (a mode switch, deactivation, focus moving on).
    pub fn finish_as_is(self: &Rc<Self>) {
        let ctx = self.context.borrow().clone();
        if let Some(ctx) = ctx {
            let session: ITfEditSession = FinishSession { shared: self.clone() }.into();
            self.request(&ctx, &session);
        }
        self.composing.set(false);
    }

    fn request(&self, ctx: &ITfContext, session: &ITfEditSession) {
        // SAFETY: COM call on the STA thread with a live context.
        let hr = unsafe { ctx.RequestEditSession(self.client_id.get(), session, TF_ES_READWRITE) };
        match hr {
            Ok(inner) if inner.is_err() => log::warn(&format!("edit session refused: {inner}")),
            Ok(_) => {}
            Err(e) => log::warn(&format!("RequestEditSession failed: {e}")),
        }
    }
}

/// Commits text and sets or ends the composition.
#[implement(ITfEditSession)]
struct ApplySession {
    shared: Rc<Shared>,
    ctx: ITfContext,
    commit: Option<String>,
    preedit: String,
    client: Rc<RefCell<Client>>,
}

impl ITfEditSession_Impl for ApplySession_Impl {
    fn DoEditSession(&self, ec: u32) -> Result<()> {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.run(ec))) {
            Ok(r) => r,
            Err(_) => {
                log::warn("panic in ApplySession");
                Err(E_FAIL.into())
            }
        }
    }
}

impl ApplySession_Impl {
    fn run(&self, ec: u32) -> Result<()> {
        let shared = &self.shared;
        if let Some(text) = &self.commit {
            commit_text(shared, &self.ctx, ec, text)?;
        }
        if self.preedit.is_empty() {
            // No commit and nothing left to show: the buffer was backspaced
            // away or cancelled. The range still holds the last preedit the
            // document was shown, and `EndComposition` alone would leave it
            // there as ordinary text. After a commit the composition is
            // already gone and this is a no-op.
            cancel_composition(shared, ec)?;
        } else {
            update_preedit(shared, &self.ctx, ec, &self.preedit)?;
            if let Some(rect) = measure(shared, &self.ctx, ec) {
                let session_id = self.client.borrow().session_id();
                let mut client = self.client.borrow_mut();
                if client.is_connected() {
                    let _ = client.request(&ClientMessage::Layout { session_id, rect });
                }
            }
        }
        Ok(())
    }
}

/// Ends the composition leaving its text in place.
#[implement(ITfEditSession)]
struct FinishSession {
    shared: Rc<Shared>,
}

impl ITfEditSession_Impl for FinishSession_Impl {
    fn DoEditSession(&self, ec: u32) -> Result<()> {
        end_composition(&self.shared, ec)
    }
}

/// Told when the application ends the composition on its own.
#[implement(ITfCompositionSink)]
struct CompositionSink {
    shared: Rc<Shared>,
}

impl ITfCompositionSink_Impl for CompositionSink_Impl {
    fn OnCompositionTerminated(&self, _ecwrite: u32, _composition: Ref<'_, ITfComposition>) -> Result<()> {
        self.shared.terminated();
        Ok(())
    }
}

/// The range where a new composition starts: the current selection,
/// collapsed by the insertion query.
fn insertion_range(ctx: &ITfContext, ec: u32) -> Result<ITfRange> {
    // SAFETY: COM calls under the edit cookie.
    unsafe {
        let ias: ITfInsertAtSelection = ctx.cast()?;
        ias.InsertTextAtSelection(ec, TF_IAS_QUERYONLY, &[])
    }
}

fn start_composition(shared: &Rc<Shared>, ctx: &ITfContext, ec: u32) -> Result<ITfComposition> {
    let range = insertion_range(ctx, ec)?;
    let sink: ITfCompositionSink = CompositionSink { shared: shared.clone() }.into();
    // SAFETY: COM calls under the edit cookie.
    let composition = unsafe {
        let cc: ITfContextComposition = ctx.cast()?;
        cc.StartComposition(ec, &range, &sink)?
    };
    *shared.composition.borrow_mut() = Some(composition.clone());
    *shared.context.borrow_mut() = Some(ctx.clone());
    Ok(composition)
}

fn update_preedit(shared: &Rc<Shared>, ctx: &ITfContext, ec: u32, text: &str) -> Result<()> {
    let existing = shared.composition.borrow().clone();
    let composition = match existing {
        Some(c) => c,
        None => start_composition(shared, ctx, ec)?,
    };
    let utf16: Vec<u16> = text.encode_utf16().collect();
    // SAFETY: COM calls under the edit cookie.
    unsafe {
        let range = composition.GetRange()?;
        range.SetText(ec, 0, &utf16)?;
        if let Some(atom) = shared.attr_atom.get() {
            let prop = ctx.GetProperty(&GUID_PROP_ATTRIBUTE)?;
            let value = VARIANT::from(atom as i32);
            let _ = prop.SetValue(ec, &range, &value);
        }
        move_caret_to_end(ctx, ec, &range)?;
    }
    Ok(())
}

fn commit_text(shared: &Shared, ctx: &ITfContext, ec: u32, text: &str) -> Result<()> {
    let utf16: Vec<u16> = text.encode_utf16().collect();
    let composition = shared.composition.borrow().clone();
    // SAFETY: COM calls under the edit cookie.
    unsafe {
        match composition {
            Some(c) => {
                let range = c.GetRange()?;
                range.SetText(ec, 0, &utf16)?;
                move_caret_to_end(ctx, ec, &range)?;
                c.EndComposition(ec)?;
                *shared.composition.borrow_mut() = None;
                *shared.context.borrow_mut() = None;
            }
            None => {
                let ias: ITfInsertAtSelection = ctx.cast()?;
                let range = ias.InsertTextAtSelection(ec, INSERT_TEXT_AT_SELECTION_FLAGS(0), &utf16)?;
                move_caret_to_end(ctx, ec, &range)?;
            }
        }
    }
    Ok(())
}

fn end_composition(shared: &Shared, ec: u32) -> Result<()> {
    let composition = shared.composition.borrow_mut().take();
    *shared.context.borrow_mut() = None;
    if let Some(c) = composition {
        // SAFETY: COM call under the edit cookie.
        unsafe { c.EndComposition(ec)? };
    }
    Ok(())
}

/// Ends the composition and takes its text with it: the range is emptied
/// first, because ending a composition only removes the marking and leaves
/// whatever the range holds in the document.
fn cancel_composition(shared: &Shared, ec: u32) -> Result<()> {
    let composition = shared.composition.borrow_mut().take();
    *shared.context.borrow_mut() = None;
    if let Some(c) = composition {
        // SAFETY: COM calls under the edit cookie.
        unsafe {
            let range = c.GetRange()?;
            range.SetText(ec, 0, &[])?;
            c.EndComposition(ec)?;
        }
    }
    Ok(())
}

/// Puts the caret after `range`, so the next insertion continues the text.
unsafe fn move_caret_to_end(ctx: &ITfContext, ec: u32, range: &ITfRange) -> Result<()> {
    // SAFETY: the caller holds the edit cookie.
    unsafe {
        let end = range.Clone()?;
        end.Collapse(ec, TF_ANCHOR_END)?;
        let selection = TF_SELECTION {
            range: ManuallyDrop::new(Some(end)),
            style: TF_SELECTIONSTYLE {
                ase: TF_AE_NONE,
                fInterimChar: BOOL(0),
            },
        };
        let result = ctx.SetSelection(
            ec,
            &[TF_SELECTION {
                range: ManuallyDrop::new((*selection.range).clone()),
                style: selection.style,
            }],
        );
        drop(ManuallyDrop::into_inner(selection.range));
        result
    }
}

/// The composition's rectangle on screen, if the view has a layout for it.
/// `TF_E_NOLAYOUT` is common right after `SetText`; the host then keeps its
/// last position or falls back to the caret it can see.
fn measure(shared: &Shared, ctx: &ITfContext, ec: u32) -> Option<Rect> {
    let composition = shared.composition.borrow().clone()?;
    // SAFETY: COM calls under the edit cookie.
    unsafe {
        let range = composition.GetRange().ok()?;
        let view = ctx.GetActiveView().ok()?;
        let mut rc = RECT::default();
        let mut clipped = BOOL(0);
        view.GetTextExt(ec, &range, &mut rc, &mut clipped).ok()?;
        if rc.right <= rc.left && rc.bottom <= rc.top {
            return None;
        }
        Some(Rect {
            left: rc.left,
            top: rc.top,
            right: rc.right,
            bottom: rc.bottom,
        })
    }
}
