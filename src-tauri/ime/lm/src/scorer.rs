//! The engine's [`SentenceScorer`], backed by a model on its own thread.
//!
//! A query asks once and waits at most the budget. The worker thread owns
//! the backend; the query thread sends it a batch and waits on a reply
//! channel with a timeout. Three things keep a slow or broken model from
//! ever costing the person a keystroke:
//!
//! - **The budget.** A reply that does not come in time is abandoned: the
//!   run is cancelled (the backend's own stop, `RunOptions::terminate` for
//!   ONNX Runtime) and the query answers with nothing, which the engine reads
//!   as "no opinion". The worker drops a late reply on the floor.
//! - **The breaker.** Five misses in a row and the scorer stops asking for
//!   two seconds, then tries again. A model too slow for this machine costs
//!   one budget every two seconds instead of one per key.
//! - **The cache.** A candidate scored under a context is not scored again
//!   for the same context: most of the next keystroke's candidates were on
//!   this one's list.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use meridian_ime_engine::{ScoreRequest, SentenceScorer};

use crate::backend::{Backend, Batch, RunCtl};
use crate::bundle::Limits;
use crate::vocab::Vocab;

/// Misses in a row that open the breaker.
pub const BREAKER_MISSES: u32 = 5;
/// How long an open breaker stays open.
pub const BREAKER_PAUSE: Duration = Duration::from_secs(2);
/// Scores kept before the cache is emptied.
pub const CACHE_CAPACITY: usize = 4096;

struct Job {
    batch: Batch,
    ctl: Arc<RunCtl>,
    reply: SyncSender<Result<Vec<f32>, String>>,
}

#[derive(Debug, Default)]
struct Breaker {
    misses: u32,
    open_until: Option<Instant>,
}

impl Breaker {
    fn is_open(&mut self, now: Instant) -> bool {
        match self.open_until {
            Some(t) if now < t => true,
            Some(_) => {
                // Half open: the next answer decides.
                self.open_until = None;
                self.misses = BREAKER_MISSES - 1;
                false
            }
            None => false,
        }
    }

    fn miss(&mut self, now: Instant) {
        self.misses += 1;
        if self.misses >= BREAKER_MISSES {
            self.open_until = Some(now + BREAKER_PAUSE);
            tracing::warn!(pause = ?BREAKER_PAUSE, "language model keeps missing its budget; pausing it");
        }
    }

    fn hit(&mut self) {
        self.misses = 0;
    }
}

/// What the scorer has done, for tests and the bench.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ScorerStats {
    /// Batches sent to the model.
    pub runs: u64,
    /// Queries answered from the cache alone.
    pub cached: u64,
    /// Queries that got nothing: timeout, backend error, open breaker.
    pub missed: u64,
}

pub struct LmScorer {
    jobs: Mutex<mpsc::Sender<Job>>,
    vocab: Vocab,
    limits: Limits,
    scale: f64,
    budget: Duration,
    breaker: Mutex<Breaker>,
    cache: Mutex<HashMap<(u64, String), f64>>,
    stats: Mutex<ScorerStats>,
}

impl LmScorer {
    /// Starts the worker thread. `make` builds the backend *on* that thread,
    /// so a backend that may not move between threads never has to. Returns
    /// once it is built, or with its error.
    pub fn spawn<B, F>(make: F, vocab: Vocab, limits: Limits, scale: f64, budget: Duration) -> Result<LmScorer, String>
    where
        B: Backend + 'static,
        F: FnOnce() -> Result<B, String> + Send + 'static,
    {
        let (tx, rx) = mpsc::channel::<Job>();
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);
        std::thread::Builder::new()
            .name("ime-lm".into())
            .spawn(move || {
                let mut backend = match make() {
                    Ok(b) => {
                        let _ = ready_tx.send(Ok(()));
                        b
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                for job in rx {
                    if job.ctl.is_cancelled() {
                        continue;
                    }
                    let result = backend.run(&job.batch, &job.ctl);
                    // The caller may have given up; a late answer is dropped.
                    let _ = job.reply.try_send(result);
                }
            })
            .map_err(|e| format!("cannot start the model thread: {e}"))?;
        ready_rx
            .recv()
            .map_err(|_| "the model thread ended before it was ready".to_string())??;
        Ok(LmScorer {
            jobs: Mutex::new(tx),
            vocab,
            limits,
            scale,
            budget,
            breaker: Mutex::new(Breaker::default()),
            cache: Mutex::new(HashMap::new()),
            stats: Mutex::new(ScorerStats::default()),
        })
    }

    pub fn stats(&self) -> ScorerStats {
        *self.stats.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn bump(&self, f: impl FnOnce(&mut ScorerStats)) {
        f(&mut self.stats.lock().unwrap_or_else(|p| p.into_inner()));
    }

    /// One run for these candidate ids; `None` when it did not come back in
    /// time or failed.
    fn run(&self, ctx: &[i64], texts: &[Vec<i64>]) -> Option<Vec<f64>> {
        let batch = Batch::new(ctx, texts, self.vocab.pad());
        let (reply, answer) = mpsc::sync_channel(1);
        let ctl = Arc::new(RunCtl::default());
        let job = Job {
            batch: batch.clone(),
            ctl: ctl.clone(),
            reply,
        };
        if self.jobs.lock().unwrap_or_else(|p| p.into_inner()).send(job).is_err() {
            tracing::warn!("the model thread is gone");
            return None;
        }
        self.bump(|s| s.runs += 1);
        let logp = match answer.recv_timeout(self.budget) {
            Ok(Ok(logp)) => logp,
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "language model run failed");
                return None;
            }
            Err(RecvTimeoutError::Timeout) => {
                ctl.cancel();
                return None;
            }
            Err(RecvTimeoutError::Disconnected) => return None,
        };
        if logp.len() != batch.rows * batch.text_len {
            tracing::warn!(
                got = logp.len(),
                expected = batch.rows * batch.text_len,
                "language model answered with the wrong shape"
            );
            return None;
        }
        Some(
            (0..batch.rows)
                .map(|r| {
                    let row = r * batch.text_len;
                    (0..batch.text_len)
                        .filter(|&i| batch.text_mask[row + i] != 0)
                        .map(|i| f64::from(logp[row + i]))
                        .sum::<f64>()
                        * self.scale
                })
                .collect(),
        )
    }
}

fn context_hash(req: &ScoreRequest<'_>) -> u64 {
    let mut h = DefaultHasher::new();
    format!("{:?}", req.scheme).hash(&mut h);
    req.keys.hash(&mut h);
    req.left.hash(&mut h);
    req.right.hash(&mut h);
    req.hints.hash(&mut h);
    h.finish()
}

impl SentenceScorer for LmScorer {
    fn score(&self, req: &ScoreRequest<'_>) -> Vec<f64> {
        if req.texts.is_empty() {
            return Vec::new();
        }
        let now = Instant::now();
        if self.breaker.lock().unwrap_or_else(|p| p.into_inner()).is_open(now) {
            self.bump(|s| s.missed += 1);
            return Vec::new();
        }
        let key = context_hash(req);
        let known: Vec<Option<f64>> = {
            let cache = self.cache.lock().unwrap_or_else(|p| p.into_inner());
            req.texts
                .iter()
                .map(|t| cache.get(&(key, t.to_string())).copied())
                .collect()
        };
        let missing: Vec<usize> = (0..req.texts.len()).filter(|&i| known[i].is_none()).collect();
        if missing.is_empty() {
            self.bump(|s| s.cached += 1);
            return known.into_iter().map(|s| s.unwrap_or_default()).collect();
        }
        let ctx = self.vocab.encode_context(req, &self.limits);
        let texts: Vec<Vec<i64>> = missing
            .iter()
            .map(|&i| self.vocab.encode_text(req.texts[i], &self.limits))
            .collect();
        let Some(scores) = self.run(&ctx, &texts) else {
            self.breaker
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .miss(Instant::now());
            self.bump(|s| s.missed += 1);
            return Vec::new();
        };
        self.breaker.lock().unwrap_or_else(|p| p.into_inner()).hit();
        let mut out = known;
        {
            let mut cache = self.cache.lock().unwrap_or_else(|p| p.into_inner());
            if cache.len() + missing.len() > CACHE_CAPACITY {
                cache.clear();
            }
            for (&i, s) in missing.iter().zip(scores) {
                cache.insert((key, req.texts[i].to_string()), s);
                out[i] = Some(s);
            }
        }
        out.into_iter().map(|s| s.unwrap_or_default()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vocab::testutil::VOCAB_JSON;
    use meridian_ime_engine::InputScheme;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    fn limits() -> Limits {
        Limits {
            max_hints: 8,
            max_left: 8,
            max_right: 8,
            max_keys: 8,
            max_text: 4,
        }
    }

    /// `logp` for each token is minus (its id + 1) over 100, so padding would
    /// count if the mask were ignored; waits `delay`
    /// first, in small steps, and stops early when cancelled.
    struct Fake {
        delay: Duration,
        runs: Arc<AtomicUsize>,
        stopped: Arc<AtomicBool>,
        wrong_shape: bool,
    }

    impl Backend for Fake {
        fn run(&mut self, batch: &Batch, ctl: &RunCtl) -> Result<Vec<f32>, String> {
            self.runs.fetch_add(1, Ordering::SeqCst);
            let stopped = self.stopped.clone();
            ctl.on_cancel(Box::new(move || stopped.store(true, Ordering::SeqCst)));
            let until = Instant::now() + self.delay;
            while Instant::now() < until {
                if ctl.is_cancelled() {
                    return Err("terminated".into());
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            if self.wrong_shape {
                return Ok(vec![0.0]);
            }
            Ok(batch.text_ids.iter().map(|&id| -((id + 1) as f32) / 100.0).collect())
        }
    }

    struct Rig {
        scorer: LmScorer,
        runs: Arc<AtomicUsize>,
        stopped: Arc<AtomicBool>,
    }

    fn rig(delay: Duration, budget: Duration, wrong_shape: bool) -> Rig {
        let runs = Arc::new(AtomicUsize::new(0));
        let stopped = Arc::new(AtomicBool::new(false));
        let (r, s) = (runs.clone(), stopped.clone());
        let scorer = LmScorer::spawn(
            move || {
                Ok(Fake {
                    delay,
                    runs: r,
                    stopped: s,
                    wrong_shape,
                })
            },
            Vocab::parse(VOCAB_JSON).unwrap(),
            limits(),
            2.0,
            budget,
        )
        .unwrap();
        Rig { scorer, runs, stopped }
    }

    fn ask<'a>(texts: &'a [&'a str], left: &'a str) -> ScoreRequest<'a> {
        ScoreRequest {
            scheme: InputScheme::Pinyin,
            keys: "ni",
            left,
            right: "",
            hints: &[],
            texts,
        }
    }

    #[test]
    fn sums_masked_tokens_and_applies_the_scale() {
        let r = rig(Duration::ZERO, Duration::from_secs(5), false);
        // 你 = 10, 好 = 11, 泥 = 12 score -0.11, -0.12, -0.13: 你好 sums -0.23,
        // 泥 -0.13 (its padding, -0.01, is masked out); both doubled by the scale.
        let s = r.scorer.score(&ask(&["你好", "泥"], ""));
        assert_eq!(s.len(), 2);
        assert!((s[0] - (-0.46)).abs() < 1e-6, "{s:?}");
        assert!((s[1] - (-0.26)).abs() < 1e-6, "{s:?}");
    }

    #[test]
    fn a_second_ask_in_the_same_context_is_cached() {
        let r = rig(Duration::ZERO, Duration::from_secs(5), false);
        let first = r.scorer.score(&ask(&["你好", "泥"], "我"));
        let again = r.scorer.score(&ask(&["泥", "你好"], "我"));
        assert_eq!(first, vec![again[1], again[0]]);
        assert_eq!(r.runs.load(Ordering::SeqCst), 1);
        assert_eq!(r.scorer.stats().cached, 1);
        // Another context is another question.
        r.scorer.score(&ask(&["你好"], "说"));
        assert_eq!(r.runs.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_slow_model_is_abandoned_and_stopped() {
        let r = rig(Duration::from_millis(500), Duration::from_millis(20), false);
        let started = Instant::now();
        let s = r.scorer.score(&ask(&["你好"], ""));
        assert!(s.is_empty(), "no answer in time is no opinion");
        assert!(
            started.elapsed() < Duration::from_millis(300),
            "the query did not wait for the model"
        );
        let deadline = Instant::now() + Duration::from_secs(2);
        while !r.stopped.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(r.stopped.load(Ordering::SeqCst), "the run in flight was told to stop");
        assert_eq!(r.scorer.stats().missed, 1);
    }

    #[test]
    fn the_breaker_opens_after_repeated_misses() {
        let r = rig(Duration::from_millis(200), Duration::from_millis(5), false);
        for i in 0..BREAKER_MISSES {
            assert!(r.scorer.score(&ask(&["你好"], &"我".repeat(i as usize + 1))).is_empty());
        }
        // A job the worker had already picked up when it was cancelled may
        // still count its run; let that settle before reading.
        std::thread::sleep(Duration::from_millis(50));
        let runs = r.runs.load(Ordering::SeqCst);
        assert!(r.scorer.score(&ask(&["你好"], "说说说说说说")).is_empty());
        // Give a run that was wrongly sent time to reach the worker.
        std::thread::sleep(Duration::from_millis(50));
        assert!(r.runs.load(Ordering::SeqCst) <= runs, "an open breaker sends nothing");
        assert_eq!(r.scorer.stats().missed, u64::from(BREAKER_MISSES) + 1);
    }

    #[test]
    fn a_wrong_shape_is_no_answer() {
        let r = rig(Duration::ZERO, Duration::from_secs(5), true);
        assert!(r.scorer.score(&ask(&["你好", "泥"], "")).is_empty());
    }

    #[test]
    fn a_backend_that_cannot_start_is_an_error() {
        let err = LmScorer::spawn(
            || Err::<Fake, _>("no runtime".to_string()),
            Vocab::parse(VOCAB_JSON).unwrap(),
            limits(),
            1.0,
            Duration::from_millis(10),
        )
        .err()
        .unwrap();
        assert_eq!(err, "no runtime");
    }
}
