//! Drawing the candidate window with Direct2D and DirectWrite.
//!
//! Carried over from the prototype: a borderless popup that never activates,
//! rounded by a window region, coloured like Rime's win11dark theme. What
//! changed: it is placed from the rectangle the text service measured
//! (`Layout`) rather than from `GetCaretPos`, which modern applications do
//! not maintain; DPI is the monitor's, taken per placement; and the process
//! is per-monitor aware as a whole rather than per call.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{Receiver, Sender};

use meridian_ime_proto::{Frame, PreeditKind, Rect};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Direct2D::Common::*;
use windows::Win32::Graphics::Direct2D::*;
use windows::Win32::Graphics::DirectWrite::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::HiDpi::GetDpiForMonitor;
use windows::Win32::UI::HiDpi::MDT_EFFECTIVE_DPI;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows_core::{PCWSTR, w};

use super::{UiCommand, WM_UI_COMMAND, drain};

const WINDOW_CLASS_NAME: PCWSTR = w!("MeridianIme_Candidate");
const FONT_FAMILY: PCWSTR = w!("Microsoft YaHei UI");

// Layout in device-independent pixels.
const FONT_SIZE_PT: f32 = 14.0;
const FONT_SIZE_DIP: f32 = FONT_SIZE_PT * 96.0 / 72.0;
const MARGIN_X: f32 = 12.0;
const MARGIN_Y: f32 = 8.0;
const SPACING: f32 = 8.0;
const CANDIDATE_SPACING: f32 = 4.0;
const HILITE_PADDING_X: f32 = 8.0;
const HILITE_PADDING_Y: f32 = 2.0;
const CORNER_RADIUS: f32 = 10.0;
const HILITE_CORNER: f32 = 8.0;
const MARK_WIDTH: f32 = 4.0;
const MARK_GAP: f32 = 6.0;
const NUM_COL_WIDTH: f32 = 28.0;
const LINE_HEIGHT: f32 = FONT_SIZE_DIP * 1.4;
const MIN_WIDTH: f32 = 120.0;
/// Gap between the caret rectangle and the window.
const CARET_GAP: f32 = 4.0;

// win11dark.
const COLOR_BG: D2D1_COLOR_F = D2D1_COLOR_F {
    r: 0.173,
    g: 0.173,
    b: 0.173,
    a: 1.0,
};
const COLOR_TEXT: D2D1_COLOR_F = D2D1_COLOR_F {
    r: 0.976,
    g: 0.976,
    b: 0.976,
    a: 1.0,
};
const COLOR_DIM: D2D1_COLOR_F = D2D1_COLOR_F {
    r: 0.62,
    g: 0.62,
    b: 0.62,
    a: 1.0,
};
const COLOR_HILITE_BG: D2D1_COLOR_F = D2D1_COLOR_F {
    r: 0.220,
    g: 0.220,
    b: 0.220,
    a: 1.0,
};
const COLOR_HILITE_MARK: D2D1_COLOR_F = D2D1_COLOR_F {
    r: 0.298,
    g: 0.761,
    b: 1.0,
    a: 1.0,
};

struct Window {
    hwnd: HWND,
    d2d: ID2D1Factory,
    dwrite: IDWriteFactory,
    render_target: Option<ID2D1HwndRenderTarget>,
    text_format: IDWriteTextFormat,
    frame: Frame,
    width_dip: f32,
    height_dip: f32,
    dpi: f32,
    visible: bool,
}

thread_local! {
    static WINDOW: std::cell::RefCell<Option<Window>> = const { std::cell::RefCell::new(None) };
}

/// The window thread's body.
pub fn run(rx: Receiver<UiCommand>, thread_id: Arc<AtomicU32>, quit_requested: Arc<AtomicBool>, ready: Sender<()>) {
    // SAFETY: plain thread id query; the message queue exists after PeekMessage.
    unsafe {
        thread_id.store(GetCurrentThreadId(), Ordering::Relaxed);
        let mut msg = MSG::default();
        let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
    }
    let created = Window::create();
    WINDOW.with(|w| *w.borrow_mut() = created);
    let _ = ready.send(());

    // SAFETY: the standard message loop.
    unsafe {
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.hwnd.is_invalid() && msg.message == WM_UI_COMMAND {
                for cmd in drain(&rx) {
                    match cmd {
                        UiCommand::Show { frame, rect } => with_window(|w| w.show(frame, rect)),
                        UiCommand::Hide => with_window(|w| w.hide()),
                        UiCommand::Quit => {
                            PostQuitMessage(0);
                        }
                    }
                }
                continue;
            }
            if msg.message == WM_QUERYENDSESSION || msg.message == WM_ENDSESSION {
                quit_requested.store(true, Ordering::Relaxed);
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    WINDOW.with(|w| {
        if let Some(mut win) = w.borrow_mut().take() {
            win.destroy();
        }
    });
}

fn with_window(f: impl FnOnce(&mut Window)) {
    WINDOW.with(|cell| {
        if let Ok(mut opt) = cell.try_borrow_mut()
            && let Some(w) = opt.as_mut()
        {
            f(w);
        }
    });
}

impl Window {
    fn create() -> Option<Self> {
        // SAFETY: Win32/Direct2D creation calls on the thread that will own
        // the window; every handle is checked before use.
        unsafe {
            let hinstance = GetModuleHandleW(None).ok()?;
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: WINDOW_CLASS_NAME,
                ..Default::default()
            };
            let _ = RegisterClassExW(&wc);
            let d2d: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None).ok()?;
            let dwrite: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).ok()?;
            let text_format = dwrite
                .CreateTextFormat(
                    FONT_FAMILY,
                    None,
                    DWRITE_FONT_WEIGHT_NORMAL,
                    DWRITE_FONT_STYLE_NORMAL,
                    DWRITE_FONT_STRETCH_NORMAL,
                    FONT_SIZE_DIP,
                    w!("zh-CN"),
                )
                .ok()?;
            let hwnd = CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                WINDOW_CLASS_NAME,
                w!(""),
                WS_POPUP,
                0,
                0,
                1,
                1,
                None,
                None,
                Some(hinstance.into()),
                None,
            )
            .ok()?;
            Some(Self {
                hwnd,
                d2d,
                dwrite,
                render_target: None,
                text_format,
                frame: Frame::default(),
                width_dip: 1.0,
                height_dip: 1.0,
                dpi: 96.0,
                visible: false,
            })
        }
    }

    fn destroy(&mut self) {
        self.render_target = None;
        // SAFETY: our own window.
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
    }

    fn dip_to_px(&self, dip: f32) -> i32 {
        (dip * self.dpi / 96.0).round() as i32
    }

    fn hide(&mut self) {
        if self.visible {
            self.visible = false;
            // SAFETY: our own window.
            unsafe {
                let _ = ShowWindow(self.hwnd, SW_HIDE);
            }
        }
    }

    fn show(&mut self, frame: Frame, rect: Option<Rect>) {
        if frame.is_empty() {
            self.hide();
            return;
        }
        self.frame = frame;
        let anchor = rect.unwrap_or_else(fallback_anchor);
        let (work, dpi) = monitor_for(&anchor);
        if (self.dpi - dpi).abs() > 0.5 {
            self.dpi = dpi;
            self.render_target = None;
        }
        self.calculate_size();
        let w_px = self.dip_to_px(self.width_dip);
        let h_px = self.dip_to_px(self.height_dip);
        if let Some(rt) = &self.render_target {
            let size = D2D_SIZE_U {
                width: w_px.max(1) as u32,
                height: h_px.max(1) as u32,
            };
            // SAFETY: a live render target.
            if unsafe { rt.Resize(&size) }.is_err() {
                self.render_target = None;
            }
        }
        let gap = self.dip_to_px(CARET_GAP);
        let mut x = anchor.left;
        let mut y = anchor.bottom + gap;
        if y + h_px > work.bottom {
            // No room below: above the caret.
            y = anchor.top - gap - h_px;
        }
        if x + w_px > work.right {
            x = work.right - w_px;
        }
        if x < work.left {
            x = work.left;
        }
        if y < work.top {
            y = work.top;
        }
        self.update_region(w_px, h_px);
        // SAFETY: our own window.
        unsafe {
            let _ = SetWindowPos(
                self.hwnd,
                Some(HWND_TOPMOST),
                x,
                y,
                w_px,
                h_px,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            let _ = InvalidateRect(Some(self.hwnd), None, false);
        }
        self.visible = true;
    }

    fn update_region(&self, w: i32, h: i32) {
        let r = self.dip_to_px(CORNER_RADIUS * 2.0);
        // SAFETY: GDI region on our own window; the region is owned by the
        // system after SetWindowRgn.
        unsafe {
            let rgn = CreateRoundRectRgn(0, 0, w + 1, h + 1, r, r);
            if !rgn.is_invalid() {
                let _ = SetWindowRgn(self.hwnd, Some(rgn), false);
            }
        }
    }

    fn ensure_render_target(&mut self) {
        if self.render_target.is_some() {
            return;
        }
        let w = self.dip_to_px(self.width_dip).max(1) as u32;
        let h = self.dip_to_px(self.height_dip).max(1) as u32;
        let props = D2D1_RENDER_TARGET_PROPERTIES::default();
        let hwnd_props = D2D1_HWND_RENDER_TARGET_PROPERTIES {
            hwnd: self.hwnd,
            pixelSize: D2D_SIZE_U { width: w, height: h },
            presentOptions: D2D1_PRESENT_OPTIONS_NONE,
        };
        // SAFETY: factory and window are ours.
        if let Ok(rt) = unsafe { self.d2d.CreateHwndRenderTarget(&props, &hwnd_props) } {
            unsafe { rt.SetDpi(self.dpi, self.dpi) };
            self.render_target = Some(rt);
        }
    }

    fn measure(&self, text: &str) -> f32 {
        let utf16: Vec<u16> = text.encode_utf16().collect();
        // SAFETY: DirectWrite layout on our own factory.
        unsafe {
            match self
                .dwrite
                .CreateTextLayout(&utf16, &self.text_format, 10000.0, 10000.0)
            {
                Ok(layout) => {
                    let mut metrics = DWRITE_TEXT_METRICS::default();
                    let _ = layout.GetMetrics(&mut metrics);
                    metrics.widthIncludingTrailingWhitespace
                }
                Err(_) => 50.0,
            }
        }
    }

    fn preedit_text(&self) -> String {
        self.frame.preedit.iter().map(|s| s.text.as_str()).collect()
    }

    fn footer_text(&self) -> Option<String> {
        if let Some(n) = &self.frame.notice {
            return Some(n.clone());
        }
        if self.frame.page_count > 1 {
            return Some(format!("‹ {}/{} ›", self.frame.page + 1, self.frame.page_count));
        }
        None
    }

    fn calculate_size(&mut self) {
        let mut content_w: f32 = 0.0;
        let mut h: f32 = MARGIN_Y;
        let preedit = self.preedit_text();
        if !preedit.is_empty() {
            content_w = content_w.max(self.measure(&preedit));
            h += LINE_HEIGHT;
        }
        if !preedit.is_empty() && !self.frame.candidates.is_empty() {
            h += SPACING;
        }
        for (i, c) in self.frame.candidates.iter().enumerate() {
            let label_w = self.measure(&format!("{}.", i + 1));
            let text_w = self.measure(&c.text);
            let row_w =
                HILITE_PADDING_X + MARK_WIDTH + MARK_GAP + label_w.max(NUM_COL_WIDTH) + text_w + HILITE_PADDING_X;
            content_w = content_w.max(row_w);
            if i > 0 {
                h += CANDIDATE_SPACING;
            }
            h += HILITE_PADDING_Y * 2.0 + LINE_HEIGHT;
        }
        if let Some(footer) = self.footer_text() {
            content_w = content_w.max(self.measure(&footer));
            h += SPACING + LINE_HEIGHT;
        }
        h += MARGIN_Y;
        self.width_dip = (content_w + MARGIN_X * 2.0).max(MIN_WIDTH);
        self.height_dip = h;
    }

    fn paint(&mut self) {
        self.ensure_render_target();
        let Some(rt) = self.render_target.clone() else { return };
        // SAFETY: Direct2D drawing between BeginDraw/EndDraw on our target.
        unsafe {
            rt.BeginDraw();
            rt.Clear(Some(&COLOR_BG));
            let (Ok(text_brush), Ok(dim_brush), Ok(hilite_brush), Ok(mark_brush)) = (
                rt.CreateSolidColorBrush(&COLOR_TEXT, None),
                rt.CreateSolidColorBrush(&COLOR_DIM, None),
                rt.CreateSolidColorBrush(&COLOR_HILITE_BG, None),
                rt.CreateSolidColorBrush(&COLOR_HILITE_MARK, None),
            ) else {
                let _ = rt.EndDraw(None, None);
                return;
            };
            let w = self.width_dip;
            let mut y = MARGIN_Y;

            // Preedit: fixed and complete syllables in full colour, the
            // syllable still being typed dimmed.
            let mut x = MARGIN_X;
            let mut drew_preedit = false;
            for seg in &self.frame.preedit {
                let brush = if seg.kind == PreeditKind::Partial {
                    &dim_brush
                } else {
                    &text_brush
                };
                let utf16: Vec<u16> = seg.text.encode_utf16().collect();
                let width = self.measure(&seg.text);
                let rect = D2D_RECT_F {
                    left: x,
                    top: y,
                    right: x + width + 2.0,
                    bottom: y + LINE_HEIGHT,
                };
                rt.DrawText(
                    &utf16,
                    &self.text_format,
                    &rect,
                    brush,
                    D2D1_DRAW_TEXT_OPTIONS_NONE,
                    DWRITE_MEASURING_MODE_NATURAL,
                );
                x += width;
                drew_preedit = true;
            }
            if drew_preedit {
                y += LINE_HEIGHT;
            }
            if drew_preedit && !self.frame.candidates.is_empty() {
                y += SPACING;
            }

            for (i, cand) in self.frame.candidates.iter().enumerate() {
                if i > 0 {
                    y += CANDIDATE_SPACING;
                }
                let row_top = y;
                let row_bottom = y + HILITE_PADDING_Y * 2.0 + LINE_HEIGHT;
                if i == self.frame.highlight {
                    let hilite = D2D1_ROUNDED_RECT {
                        rect: D2D_RECT_F {
                            left: MARGIN_X,
                            top: row_top,
                            right: w - MARGIN_X,
                            bottom: row_bottom,
                        },
                        radiusX: HILITE_CORNER,
                        radiusY: HILITE_CORNER,
                    };
                    rt.FillRoundedRectangle(&hilite, &hilite_brush);
                    let mark = D2D1_ROUNDED_RECT {
                        rect: D2D_RECT_F {
                            left: MARGIN_X + HILITE_PADDING_X,
                            top: row_top + HILITE_PADDING_Y + 2.0,
                            right: MARGIN_X + HILITE_PADDING_X + MARK_WIDTH,
                            bottom: row_bottom - HILITE_PADDING_Y - 2.0,
                        },
                        radiusX: 2.0,
                        radiusY: 2.0,
                    };
                    rt.FillRoundedRectangle(&mark, &mark_brush);
                }
                let text_y = row_top + HILITE_PADDING_Y;
                let label_x = MARGIN_X + HILITE_PADDING_X + MARK_WIDTH + MARK_GAP;
                let label: Vec<u16> = format!("{}.", i + 1).encode_utf16().collect();
                let label_rect = D2D_RECT_F {
                    left: label_x,
                    top: text_y,
                    right: label_x + NUM_COL_WIDTH,
                    bottom: text_y + LINE_HEIGHT,
                };
                rt.DrawText(
                    &label,
                    &self.text_format,
                    &label_rect,
                    &dim_brush,
                    D2D1_DRAW_TEXT_OPTIONS_NONE,
                    DWRITE_MEASURING_MODE_NATURAL,
                );
                let text: Vec<u16> = cand.text.encode_utf16().collect();
                let text_rect = D2D_RECT_F {
                    left: label_x + NUM_COL_WIDTH,
                    top: text_y,
                    right: w - MARGIN_X - HILITE_PADDING_X,
                    bottom: text_y + LINE_HEIGHT,
                };
                rt.DrawText(
                    &text,
                    &self.text_format,
                    &text_rect,
                    &text_brush,
                    D2D1_DRAW_TEXT_OPTIONS_NONE,
                    DWRITE_MEASURING_MODE_NATURAL,
                );
                y = row_bottom;
            }

            if let Some(footer) = self.footer_text() {
                y += SPACING;
                let utf16: Vec<u16> = footer.encode_utf16().collect();
                let rect = D2D_RECT_F {
                    left: MARGIN_X,
                    top: y,
                    right: w - MARGIN_X,
                    bottom: y + LINE_HEIGHT,
                };
                rt.DrawText(
                    &utf16,
                    &self.text_format,
                    &rect,
                    &dim_brush,
                    D2D1_DRAW_TEXT_OPTIONS_NONE,
                    DWRITE_MEASURING_MODE_NATURAL,
                );
            }

            let border = D2D1_ROUNDED_RECT {
                rect: D2D_RECT_F {
                    left: 0.5,
                    top: 0.5,
                    right: w - 0.5,
                    bottom: self.height_dip - 0.5,
                },
                radiusX: CORNER_RADIUS,
                radiusY: CORNER_RADIUS,
            };
            rt.DrawRoundedRectangle(&border, &hilite_brush, 1.0, None);
            if rt.EndDraw(None, None).is_err() {
                self.render_target = None;
            }
        }
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_PAINT => {
            with_window(|w| w.paint());
            // SAFETY: validating our own window's update region.
            unsafe {
                let _ = ValidateRect(Some(hwnd), None);
            }
            LRESULT(0)
        }
        WM_ERASEBKGND => LRESULT(1),
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        // SAFETY: default handling.
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

/// The work area and DPI of the monitor the caret is on.
fn monitor_for(anchor: &Rect) -> (RECT, f32) {
    // SAFETY: monitor queries with valid out-structures.
    unsafe {
        let pt = POINT {
            x: anchor.left,
            y: anchor.bottom,
        };
        let monitor = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let work = if GetMonitorInfoW(monitor, &mut info).as_bool() {
            info.rcWork
        } else {
            RECT {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080,
            }
        };
        let (mut dx, mut dy) = (96u32, 96u32);
        let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        (work, dx as f32)
    }
}

/// Where to put the window when the text service could not measure the
/// composition: the foreground thread's caret if it publishes one, else the
/// mouse pointer.
fn fallback_anchor() -> Rect {
    // SAFETY: queries with valid out-structures; the foreground window may
    // belong to another process, which these calls allow.
    unsafe {
        let mut info = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        if GetGUIThreadInfo(0, &mut info).is_ok() && !info.hwndCaret.is_invalid() {
            let mut top_left = POINT {
                x: info.rcCaret.left,
                y: info.rcCaret.top,
            };
            let mut bottom_right = POINT {
                x: info.rcCaret.right,
                y: info.rcCaret.bottom,
            };
            let _ = ClientToScreen(info.hwndCaret, &mut top_left);
            let _ = ClientToScreen(info.hwndCaret, &mut bottom_right);
            return Rect {
                left: top_left.x,
                top: top_left.y,
                right: bottom_right.x,
                bottom: bottom_right.y,
            };
        }
        let mut pt = POINT::default();
        let _ = GetCursorPos(&mut pt);
        Rect {
            left: pt.x,
            top: pt.y,
            right: pt.x,
            bottom: pt.y + 16,
        }
    }
}
