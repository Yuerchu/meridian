//! The text service object TSF activates per thread.
//!
//! One instance per application thread that takes input. It owns the pipe
//! connection to the host, the composition state, and the sinks TSF calls
//! back on: keys, focus changes, the Chinese/English compartment, the active
//! profile. Everything happens on the thread that activated it; there is no
//! lock and no other thread.
//!
//! Every COM entry point is wrapped in `catch_unwind`: a panic here would
//! unwind into the application's message loop, and the application is not
//! ours to crash. A key whose handling panicked is passed through.

mod display;
mod privacy;
mod sinks;

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use meridian_ime_proto::{ClientMessage, Frame, KeyEvent, Mode, Profile, ServerMessage};
use windows::Win32::Foundation::{E_INVALIDARG, FALSE, LPARAM, TRUE, WPARAM};
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN};
use windows::Win32::UI::TextServices::{
    CLSID_TF_CategoryMgr, CLSID_TF_InputProcessorProfiles, GUID_COMPARTMENT_EMPTYCONTEXT,
    GUID_COMPARTMENT_KEYBOARD_DISABLED, GUID_COMPARTMENT_KEYBOARD_INPUTMODE_CONVERSION,
    GUID_COMPARTMENT_KEYBOARD_OPENCLOSE, GUID_TFCAT_TIP_KEYBOARD, ITfActiveLanguageProfileNotifySink, ITfCategoryMgr,
    ITfCompartment, ITfCompartmentEventSink, ITfCompartmentMgr, ITfContext, ITfDisplayAttributeProvider,
    ITfInputProcessorProfileMgr, ITfKeyEventSink, ITfKeyEventSink_Impl, ITfKeystrokeMgr, ITfSource,
    ITfTextInputProcessor_Impl, ITfTextInputProcessorEx, ITfTextInputProcessorEx_Impl, ITfThreadMgr,
    ITfThreadMgrEventSink, TF_CONVERSIONMODE_NATIVE, TF_INVALID_COOKIE, TF_TMAE_SECUREMODE,
};
use windows_core::{BOOL, GUID, IUnknown, IUnknownImpl, Interface, Ref, Result, implement};

use super::composition::Shared;
use super::key::{VK_LSHIFT, VK_RSHIFT, VK_SHIFT_, eats_key, event_from};
use super::log;
use crate::client::Client;

#[implement(
    ITfTextInputProcessorEx,
    ITfKeyEventSink,
    ITfThreadMgrEventSink,
    ITfCompartmentEventSink,
    ITfActiveLanguageProfileNotifySink,
    ITfDisplayAttributeProvider
)]
pub struct TextService {
    client_id: Cell<u32>,
    thread_mgr: RefCell<Option<ITfThreadMgr>>,
    client: Rc<RefCell<Client>>,
    shared: Rc<Shared>,
    chinese_mode: Cell<bool>,
    /// Shift went down and nothing else has since: a release is a tap.
    shift_tap: Cell<bool>,
    /// On the secure desktop: no composition, no host.
    secure: Cell<bool>,
    thread_mgr_cookie: Cell<u32>,
    openclose_cookie: Cell<u32>,
    profile_cookie: Cell<u32>,
    openclose: RefCell<Option<ITfCompartment>>,
}

impl TextService {
    pub fn new() -> Self {
        super::object_created();
        Self {
            client_id: Cell::new(0),
            thread_mgr: RefCell::new(None),
            client: Rc::new(RefCell::new(Client::new(0, Profile::PinyinSimplified))),
            shared: Rc::new(Shared::default()),
            chinese_mode: Cell::new(true),
            shift_tap: Cell::new(false),
            secure: Cell::new(false),
            thread_mgr_cookie: Cell::new(TF_INVALID_COOKIE),
            openclose_cookie: Cell::new(TF_INVALID_COOKIE),
            profile_cookie: Cell::new(TF_INVALID_COOKIE),
            openclose: RefCell::new(None),
        }
    }
}

impl Default for TextService {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for TextService {
    fn drop(&mut self) {
        super::object_destroyed();
    }
}

/// Runs `f`, turning a panic into `fallback` and a log line.
fn guarded<T>(what: &str, fallback: T, f: impl FnOnce() -> T) -> T {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(v) => v,
        Err(_) => {
            log::warn(&format!("panic in {what}"));
            fallback
        }
    }
}

impl TextService_Impl {
    fn activate(&self, tm: &ITfThreadMgr, tid: u32, flags: u32) -> Result<()> {
        self.client_id.set(tid);
        self.shared.set_client_id(tid);
        *self.thread_mgr.borrow_mut() = Some(tm.clone());
        self.secure.set(flags & TF_TMAE_SECUREMODE != 0);
        let profile = active_profile();
        *self.client.borrow_mut() = Client::new(tid as u64, profile);

        // SAFETY: COM calls on the STA thread that activated us.
        unsafe {
            let keystrokes: ITfKeystrokeMgr = tm.cast()?;
            let this: IUnknown = self.to_interface();
            let key_sink: ITfKeyEventSink = this.cast()?;
            keystrokes.AdviseKeyEventSink(tid, &key_sink, true)?;

            if let Ok(source) = tm.cast::<ITfSource>() {
                let sink: ITfThreadMgrEventSink = this.cast()?;
                if let Ok(cookie) = source.AdviseSink(&ITfThreadMgrEventSink::IID, &sink) {
                    self.thread_mgr_cookie.set(cookie);
                }
                let profile_sink: ITfActiveLanguageProfileNotifySink = this.cast()?;
                if let Ok(cookie) = source.AdviseSink(&ITfActiveLanguageProfileNotifySink::IID, &profile_sink) {
                    self.profile_cookie.set(cookie);
                }
            }

            if let Ok(compartments) = tm.cast::<ITfCompartmentMgr>() {
                if let Ok(openclose) = compartments.GetCompartment(&GUID_COMPARTMENT_KEYBOARD_OPENCLOSE) {
                    let _ = openclose.SetValue(tid, &VARIANT::from(1i32));
                    if let Ok(source) = openclose.cast::<ITfSource>() {
                        let sink: ITfCompartmentEventSink = this.cast()?;
                        if let Ok(cookie) = source.AdviseSink(&ITfCompartmentEventSink::IID, &sink) {
                            self.openclose_cookie.set(cookie);
                        }
                    }
                    *self.openclose.borrow_mut() = Some(openclose);
                }
                if let Ok(conversion) = compartments.GetCompartment(&GUID_COMPARTMENT_KEYBOARD_INPUTMODE_CONVERSION) {
                    let _ = conversion.SetValue(tid, &VARIANT::from(TF_CONVERSIONMODE_NATIVE as i32));
                }
            }

            if let Ok(categories) =
                CoCreateInstance::<_, ITfCategoryMgr>(&CLSID_TF_CategoryMgr, None, CLSCTX_INPROC_SERVER)
                && let Ok(atom) = categories.RegisterGUID(&super::GUID_DISPLAY_ATTR_INPUT)
            {
                self.shared.set_attr_atom(atom);
            }
        }
        self.chinese_mode.set(true);
        if !self.secure.get() {
            let _ = self.client.borrow_mut().connection();
        }
        log::info(&format!(
            "activated: client id {tid}, profile {profile:?}, secure {}",
            self.secure.get()
        ));
        Ok(())
    }

    fn deactivate(&self) {
        if self.shared.is_composing() || self.shared.has_composition() {
            self.shared.finish_as_is();
        }
        let tm = self.thread_mgr.borrow_mut().take();
        if let Some(tm) = tm {
            // SAFETY: undoing the advises made in `activate`.
            unsafe {
                if let Ok(keystrokes) = tm.cast::<ITfKeystrokeMgr>() {
                    let _ = keystrokes.UnadviseKeyEventSink(self.client_id.get());
                }
                if let Ok(source) = tm.cast::<ITfSource>() {
                    for cookie in [&self.thread_mgr_cookie, &self.profile_cookie] {
                        if cookie.get() != TF_INVALID_COOKIE {
                            let _ = source.UnadviseSink(cookie.get());
                            cookie.set(TF_INVALID_COOKIE);
                        }
                    }
                }
                let openclose = self.openclose.borrow_mut().take();
                if let Some(openclose) = openclose
                    && let Ok(source) = openclose.cast::<ITfSource>()
                    && self.openclose_cookie.get() != TF_INVALID_COOKIE
                {
                    let _ = source.UnadviseSink(self.openclose_cookie.get());
                    self.openclose_cookie.set(TF_INVALID_COOKIE);
                }
            }
        }
        self.client.borrow_mut().bye();
        log::info("deactivated");
    }

    /// The host's view of settings, or the defaults when it is not there.
    fn full_width_punctuation(&self) -> bool {
        self.client
            .borrow()
            .settings()
            .map(|s| s.full_width_punctuation)
            .unwrap_or(true)
    }

    fn keyboard_disabled(&self, ctx: &ITfContext) -> bool {
        // SAFETY: compartment reads on a live context.
        unsafe {
            let Ok(mgr) = ctx.cast::<ITfCompartmentMgr>() else {
                return false;
            };
            for guid in [&GUID_COMPARTMENT_KEYBOARD_DISABLED, &GUID_COMPARTMENT_EMPTYCONTEXT] {
                if let Ok(c) = mgr.GetCompartment(guid)
                    && let Ok(v) = c.GetValue()
                    && let Ok(n) = i32::try_from(&v)
                    && n != 0
                {
                    return true;
                }
            }
        }
        false
    }

    /// Both key sinks call this so they cannot disagree.
    fn would_eat(&self, ctx: &ITfContext, ev: &KeyEvent) -> bool {
        if self.secure.get() || self.keyboard_disabled(ctx) {
            return false;
        }
        eats_key(
            ev,
            self.shared.is_composing(),
            self.chinese_mode.get(),
            self.full_width_punctuation(),
        )
    }

    /// Sends one key and applies the answer. Returns whether the key was eaten.
    fn handle_key(&self, ctx: &ITfContext, ev: KeyEvent) -> bool {
        if !self.would_eat(ctx, &ev) {
            return false;
        }
        let session_id = self.client.borrow().session_id();
        if self.shared.take_server_stale() {
            let _ = self.client.borrow_mut().request(&ClientMessage::Reset { session_id });
        }
        let reply = self.client.borrow_mut().request(&ClientMessage::Key {
            session_id,
            event: ev,
            surrounding: None,
        });
        match reply {
            Some(ServerMessage::KeyResult {
                consumed,
                commit,
                frame,
                ..
            }) => self.apply_result(ctx, consumed, commit, frame, ev.ch),
            Some(other) => {
                log::warn(&format!("unexpected reply to a key: {other:?}"));
                self.self_insert(ctx, ev.ch)
            }
            None => self.self_insert(ctx, ev.ch),
        }
    }

    /// The host answered.
    fn apply_result(
        &self,
        ctx: &ITfContext,
        consumed: bool,
        commit: Option<String>,
        frame: Frame,
        ch: Option<char>,
    ) -> bool {
        self.sync_mode(frame.mode);
        let preedit = frame.preedit_text();
        let composing = !preedit.is_empty();
        if !consumed && commit.is_none() && !composing {
            // The host passed the key on. We already told the application we
            // would eat it, so the character goes in by hand: some
            // applications drop a key that was declared eaten and then not.
            return self.self_insert(ctx, ch);
        }
        self.shared.set_composing(composing);
        if commit.is_some() || composing || self.shared.has_composition() {
            self.shared.apply(ctx, commit, preedit, self.client.clone());
        }
        true
    }

    /// Puts the key's own character in the document, or lets the key go if
    /// it has none. Used when the host is unreachable and when it declines a
    /// key we had promised to eat.
    fn self_insert(&self, ctx: &ITfContext, ch: Option<char>) -> bool {
        match ch {
            Some(c) if !c.is_control() => {
                self.shared.set_composing(false);
                self.shared
                    .apply(ctx, Some(c.to_string()), String::new(), self.client.clone());
                true
            }
            _ => false,
        }
    }

    /// Keeps the DLL's mode and the openclose compartment in step with the host.
    fn sync_mode(&self, mode: Mode) {
        let chinese = mode == Mode::Chinese;
        if self.chinese_mode.get() == chinese {
            return;
        }
        self.chinese_mode.set(chinese);
        if let Some(c) = self.openclose.borrow().as_ref() {
            // SAFETY: compartment write on our own client id.
            unsafe {
                let _ = c.SetValue(self.client_id.get(), &VARIANT::from(if chinese { 1i32 } else { 0 }));
            }
        }
    }

    /// A bare Shift tap: the host toggles the mode and says what to do with
    /// anything half-typed.
    fn shift_tap(&self, ctx: &ITfContext) -> bool {
        if self.secure.get() {
            return false;
        }
        let session_id = self.client.borrow().session_id();
        let ev = KeyEvent {
            vk: VK_SHIFT_,
            ch: None,
            mods: Default::default(),
            caps_lock: false,
        };
        match self.client.borrow_mut().request(&ClientMessage::Key {
            session_id,
            event: ev,
            surrounding: None,
        }) {
            Some(ServerMessage::KeyResult {
                consumed,
                commit,
                frame,
                ..
            }) => self.apply_result(ctx, consumed, commit, frame, None),
            _ => {
                // No host: toggle locally so English mode still works.
                let chinese = !self.chinese_mode.get();
                self.sync_mode(if chinese { Mode::Chinese } else { Mode::English });
                true
            }
        }
    }

    /// The compartment changed under us (the taskbar indicator was clicked).
    fn on_openclose_changed(&self) {
        let value = self.openclose.borrow().as_ref().and_then(|c| {
            // SAFETY: compartment read.
            unsafe { c.GetValue().ok().and_then(|v| i32::try_from(&v).ok()) }
        });
        let Some(value) = value else { return };
        let chinese = value != 0;
        if chinese == self.chinese_mode.get() {
            return;
        }
        // Ask the host to toggle so both sides agree; the reply's mode wins.
        let session_id = self.client.borrow().session_id();
        let ev = KeyEvent {
            vk: VK_SHIFT_,
            ch: None,
            mods: Default::default(),
            caps_lock: false,
        };
        match self.client.borrow_mut().request(&ClientMessage::Key {
            session_id,
            event: ev,
            surrounding: None,
        }) {
            Some(ServerMessage::KeyResult { frame, .. }) => {
                self.chinese_mode.set(frame.mode == Mode::Chinese);
                self.shared.set_composing(false);
            }
            _ => self.chinese_mode.set(chinese),
        }
    }

    /// A Shift tap only means something when no other modifier is held.
    fn would_toggle(&self) -> bool {
        // SAFETY: key state queries.
        unsafe {
            let down = |k: i32| GetKeyState(k) < 0;
            !(down(VK_CONTROL.0 as i32) || down(VK_MENU.0 as i32) || down(VK_LWIN.0 as i32) || down(VK_RWIN.0 as i32))
        }
    }
}

impl ITfTextInputProcessor_Impl for TextService_Impl {
    fn Activate(&self, ptim: Ref<'_, ITfThreadMgr>, tid: u32) -> Result<()> {
        self.ActivateEx(ptim, tid, 0)
    }

    fn Deactivate(&self) -> Result<()> {
        guarded("Deactivate", (), || self.deactivate());
        Ok(())
    }
}

impl ITfTextInputProcessorEx_Impl for TextService_Impl {
    fn ActivateEx(&self, ptim: Ref<'_, ITfThreadMgr>, tid: u32, flags: u32) -> Result<()> {
        let Some(tm) = ptim.as_ref() else {
            return Err(E_INVALIDARG.into());
        };
        guarded("ActivateEx", Err(E_INVALIDARG.into()), || self.activate(tm, tid, flags))
    }
}

impl ITfKeyEventSink_Impl for TextService_Impl {
    fn OnSetFocus(&self, foreground: BOOL) -> Result<()> {
        guarded("OnSetFocus", (), || {
            if foreground.as_bool() {
                if !self.secure.get() {
                    let _ = self.client.borrow_mut().connection();
                }
            } else if self.shared.is_composing() || self.shared.has_composition() {
                self.shared.finish_as_is();
                let session_id = self.client.borrow().session_id();
                let _ = self.client.borrow_mut().request(&ClientMessage::Reset { session_id });
            }
        });
        Ok(())
    }

    fn OnTestKeyDown(&self, pic: Ref<'_, ITfContext>, wparam: WPARAM, lparam: LPARAM) -> Result<BOOL> {
        Ok(guarded("OnTestKeyDown", FALSE, || {
            let Some(ctx) = pic.as_ref() else { return FALSE };
            let ev = event_from(wparam, lparam);
            if is_shift(ev.vk) {
                return FALSE;
            }
            if self.would_eat(ctx, &ev) { TRUE } else { FALSE }
        }))
    }

    fn OnKeyDown(&self, pic: Ref<'_, ITfContext>, wparam: WPARAM, lparam: LPARAM) -> Result<BOOL> {
        Ok(guarded("OnKeyDown", FALSE, || {
            let Some(ctx) = pic.as_ref() else { return FALSE };
            let ev = event_from(wparam, lparam);
            if is_shift(ev.vk) {
                self.shift_tap.set(true);
                return FALSE;
            }
            self.shift_tap.set(false);
            if self.handle_key(ctx, ev) { TRUE } else { FALSE }
        }))
    }

    fn OnTestKeyUp(&self, _pic: Ref<'_, ITfContext>, wparam: WPARAM, _lparam: LPARAM) -> Result<BOOL> {
        let vk = wparam.0 as u32;
        Ok(if is_shift(vk) && self.shift_tap.get() && self.would_toggle() {
            TRUE
        } else {
            FALSE
        })
    }

    fn OnKeyUp(&self, pic: Ref<'_, ITfContext>, wparam: WPARAM, _lparam: LPARAM) -> Result<BOOL> {
        Ok(guarded("OnKeyUp", FALSE, || {
            let vk = wparam.0 as u32;
            if is_shift(vk) && self.shift_tap.take() {
                let Some(ctx) = pic.as_ref() else { return FALSE };
                if !self.would_toggle() {
                    return FALSE;
                }
                return if self.shift_tap(ctx) { TRUE } else { FALSE };
            }
            FALSE
        }))
    }

    fn OnPreservedKey(&self, _pic: Ref<'_, ITfContext>, _guid: *const GUID) -> Result<BOOL> {
        Ok(FALSE)
    }
}

fn is_shift(vk: u32) -> bool {
    matches!(vk, VK_SHIFT_ | VK_LSHIFT | VK_RSHIFT)
}

/// Which of our two profiles is active, read from TSF at activation.
fn active_profile() -> Profile {
    // SAFETY: COM calls on the STA thread.
    unsafe {
        let Ok(profiles) = CoCreateInstance::<_, ITfInputProcessorProfileMgr>(
            &CLSID_TF_InputProcessorProfiles,
            None,
            CLSCTX_INPROC_SERVER,
        ) else {
            return Profile::PinyinSimplified;
        };
        let mut profile = Default::default();
        if profiles
            .GetActiveProfile(&GUID_TFCAT_TIP_KEYBOARD, &mut profile)
            .is_ok()
        {
            return profile_of(&profile.guidProfile);
        }
    }
    Profile::PinyinSimplified
}

pub(super) fn profile_of(guid: &GUID) -> Profile {
    if *guid == super::GUID_PROFILE_ZHUYIN {
        Profile::ZhuyinTraditional
    } else {
        Profile::PinyinSimplified
    }
}
