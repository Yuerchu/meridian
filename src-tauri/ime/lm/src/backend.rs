//! What runs the graph, behind a trait so the scorer's timing can be tested
//! without a runtime.
//!
//! The graph's contract:
//!
//! | name        | type          | shape      |
//! |-------------|---------------|------------|
//! | `ctx_ids`   | int64 input   | `[B, Lc]`  |
//! | `ctx_mask`  | int64 input   | `[B, Lc]`  |
//! | `text_ids`  | int64 input   | `[B, Lt]`  |
//! | `text_mask` | int64 input   | `[B, Lt]`  |
//! | `logp`      | float output  | `[B, Lt]`  |
//!
//! `logp[b, i]` is log P(text_i | text_<i, ctx) for row `b`, already gathered
//! at the candidate's own token; the scorer sums it under the mask.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

/// One batch: every row shares the context, each has its own candidate.
#[derive(Debug, Clone, PartialEq)]
pub struct Batch {
    pub rows: usize,
    pub ctx_len: usize,
    pub text_len: usize,
    pub ctx_ids: Vec<i64>,
    pub ctx_mask: Vec<i64>,
    pub text_ids: Vec<i64>,
    pub text_mask: Vec<i64>,
}

impl Batch {
    /// Pads every candidate to the longest and repeats the context per row.
    pub fn new(ctx: &[i64], texts: &[Vec<i64>], pad: i64) -> Batch {
        let rows = texts.len();
        let ctx_len = ctx.len().max(1);
        let text_len = texts.iter().map(Vec::len).max().unwrap_or(0).max(1);
        let mut b = Batch {
            rows,
            ctx_len,
            text_len,
            ctx_ids: Vec::with_capacity(rows * ctx_len),
            ctx_mask: Vec::with_capacity(rows * ctx_len),
            text_ids: Vec::with_capacity(rows * text_len),
            text_mask: Vec::with_capacity(rows * text_len),
        };
        for t in texts {
            for i in 0..ctx_len {
                b.ctx_ids.push(ctx.get(i).copied().unwrap_or(pad));
                b.ctx_mask.push(i64::from(i < ctx.len()));
            }
            for i in 0..text_len {
                b.text_ids.push(t.get(i).copied().unwrap_or(pad));
                b.text_mask.push(i64::from(i < t.len()));
            }
        }
        b
    }
}

/// One run's cancellation. The caller that gives up sets the flag and calls
/// whatever the backend registered to stop the run in flight; a backend that
/// registers after the flag is set is stopped at once.
#[derive(Default)]
pub struct RunCtl {
    cancelled: AtomicBool,
    stop: Mutex<Option<Box<dyn Fn() + Send>>>,
}

impl RunCtl {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Called by the backend before it runs.
    pub fn on_cancel(&self, stop: Box<dyn Fn() + Send>) {
        let mut slot = self.stop.lock().unwrap_or_else(|p| p.into_inner());
        if self.is_cancelled() {
            stop();
        } else {
            *slot = Some(stop);
        }
    }

    /// Called by the scorer when it stops waiting.
    pub fn cancel(&self) {
        let mut slot = self.stop.lock().unwrap_or_else(|p| p.into_inner());
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(stop) = slot.take() {
            stop();
        }
    }
}

/// Runs the graph. Owned by the scorer's worker thread and never shared, so
/// a runtime whose session is not thread-safe is used safely.
pub trait Backend {
    /// `logp`, row-major `[rows, text_len]`.
    fn run(&mut self, batch: &Batch, ctl: &RunCtl) -> Result<Vec<f32>, String>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn a_batch_pads_and_masks() {
        let b = Batch::new(&[5, 6], &[vec![10], vec![11, 12, 13]], 0);
        assert_eq!((b.rows, b.ctx_len, b.text_len), (2, 2, 3));
        assert_eq!(b.ctx_ids, vec![5, 6, 5, 6]);
        assert_eq!(b.ctx_mask, vec![1, 1, 1, 1]);
        assert_eq!(b.text_ids, vec![10, 0, 0, 11, 12, 13]);
        assert_eq!(b.text_mask, vec![1, 0, 0, 1, 1, 1]);
        let empty = Batch::new(&[], &[vec![]], 0);
        assert_eq!((empty.ctx_len, empty.text_len), (1, 1), "no zero-length axis");
        assert_eq!(empty.ctx_mask, vec![0]);
    }

    #[test]
    fn cancelling_stops_a_run_registered_before_or_after() {
        let stops = Arc::new(AtomicUsize::new(0));
        let counter = |s: &Arc<AtomicUsize>| {
            let s = s.clone();
            Box::new(move || {
                s.fetch_add(1, Ordering::SeqCst);
            }) as Box<dyn Fn() + Send>
        };
        let before = RunCtl::default();
        before.on_cancel(counter(&stops));
        before.cancel();
        assert_eq!(stops.load(Ordering::SeqCst), 1);
        let after = RunCtl::default();
        after.cancel();
        after.on_cancel(counter(&stops));
        assert_eq!(
            stops.load(Ordering::SeqCst),
            2,
            "registered too late is stopped at once"
        );
        assert!(after.is_cancelled());
    }
}
