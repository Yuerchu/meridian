//! The personal n-gram: online counts of which word followed which.
//!
//! Bigram and trigram counts, nothing trained and nothing smoothed by a
//! parameter that needs tuning. Blended into a static score by
//! [`UserNgram::blend`] with a confidence that grows with how often the
//! context was seen — `μ = c(prev) / (c(prev) + CONFIDENCE_K)`, capped at
//! [`MAX_CONFIDENCE`] so the person's history can tip a near-tie but never
//! drown the dictionary. Trigrams use absolute discounting (`D = 0.75`) and
//! back off to the bigram, and exist only to tell apart continuations the
//! bigram cannot: after 我 the bigram sees 想 and 相 as the same, after 我 也
//! they are not.

use std::collections::HashMap;

use super::Context;

pub const CONFIDENCE_K: f64 = 8.0;
pub const MAX_CONFIDENCE: f64 = 0.5;
pub const TRIGRAM_DISCOUNT: f64 = 0.75;
/// Ceiling on stored transitions; past it everything is halved.
pub const MAX_TRANSITIONS: usize = 200_000;

#[derive(Debug, Default, Clone)]
pub struct UserNgram {
    /// (prev, word) → count
    bigram: HashMap<(String, String), u32>,
    /// prev → Σ counts
    prev_total: HashMap<String, u32>,
    /// (prev2, prev, word) → count
    trigram: HashMap<(String, String, String), u32>,
    /// (prev2, prev) → Σ counts and distinct continuations
    trigram_ctx: HashMap<(String, String), (u32, u32)>,
    /// word → Σ counts as a continuation
    word_total: HashMap<String, u32>,
    total: u64,
}

impl UserNgram {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.bigram.is_empty()
    }

    /// Distinct bigram and trigram rows.
    pub fn len(&self) -> usize {
        self.bigram.len() + self.trigram.len()
    }

    pub fn record(&mut self, ctx: Context<'_>, word: &str, times: u32) {
        if times == 0 {
            return;
        }
        *self.bigram.entry((ctx.prev.to_string(), word.to_string())).or_default() += times;
        *self.prev_total.entry(ctx.prev.to_string()).or_default() += times;
        *self.word_total.entry(word.to_string()).or_default() += times;
        self.total += times as u64;
        if let Some(p2) = ctx.prev2 {
            let key = (p2.to_string(), ctx.prev.to_string(), word.to_string());
            let entry = self.trigram.entry(key).or_default();
            let was_new = *entry == 0;
            *entry += times;
            let c = self
                .trigram_ctx
                .entry((p2.to_string(), ctx.prev.to_string()))
                .or_default();
            c.0 += times;
            if was_new {
                c.1 += 1;
            }
        }
        // Each halving drops every row whose count reaches zero, so the loop
        // ends; usually after one pass.
        while self.len() > MAX_TRANSITIONS {
            self.halve();
        }
    }

    pub fn unrecord(&mut self, ctx: Context<'_>, word: &str, times: u32) {
        let bk = (ctx.prev.to_string(), word.to_string());
        let Some(c) = self.bigram.get_mut(&bk) else { return };
        let taken = times.min(*c);
        *c -= taken;
        if *c == 0 {
            self.bigram.remove(&bk);
        }
        dec(&mut self.prev_total, ctx.prev, taken);
        dec(&mut self.word_total, word, taken);
        self.total = self.total.saturating_sub(taken as u64);
        if let Some(p2) = ctx.prev2 {
            let tk = (p2.to_string(), ctx.prev.to_string(), word.to_string());
            if let Some(t) = self.trigram.get_mut(&tk) {
                let t_taken = taken.min(*t);
                *t -= t_taken;
                let removed = *t == 0;
                if removed {
                    self.trigram.remove(&tk);
                }
                if let Some(c) = self.trigram_ctx.get_mut(&(p2.to_string(), ctx.prev.to_string())) {
                    c.0 = c.0.saturating_sub(t_taken);
                    if removed {
                        c.1 = c.1.saturating_sub(1);
                    }
                    if c.0 == 0 {
                        self.trigram_ctx.remove(&(p2.to_string(), ctx.prev.to_string()));
                    }
                }
            }
        }
    }

    pub fn bigram_count(&self, prev: &str, word: &str) -> u32 {
        self.bigram
            .get(&(prev.to_string(), word.to_string()))
            .copied()
            .unwrap_or(0)
    }

    pub fn context_count(&self, prev: &str) -> u32 {
        self.prev_total.get(prev).copied().unwrap_or(0)
    }

    pub fn trigram_count(&self, prev2: &str, prev: &str, word: &str) -> u32 {
        self.trigram
            .get(&(prev2.to_string(), prev.to_string(), word.to_string()))
            .copied()
            .unwrap_or(0)
    }

    /// Personal probability of `word` after `ctx`, with the trigram backed
    /// off to the bigram and the bigram to the word's own share. `None` when
    /// the context was never seen, so the caller keeps the static score.
    pub fn probability(&self, ctx: Context<'_>, word: &str) -> Option<f64> {
        let c_prev = self.context_count(ctx.prev);
        if c_prev == 0 {
            return None;
        }
        let uni = self.word_total.get(word).copied().unwrap_or(0) as f64 / (self.total.max(1) as f64);
        let bi = (self.bigram_count(ctx.prev, word) as f64 + 0.5 * uni) / (c_prev as f64 + 0.5);
        let Some(p2) = ctx.prev2 else { return Some(bi) };
        let Some(&(ctx_total, distinct)) = self.trigram_ctx.get(&(p2.to_string(), ctx.prev.to_string())) else {
            return Some(bi);
        };
        if ctx_total == 0 {
            return Some(bi);
        }
        let c_tri = self.trigram_count(p2, ctx.prev, word) as f64;
        let total = ctx_total as f64;
        let discounted = (c_tri - TRIGRAM_DISCOUNT).max(0.0) / total;
        let backoff = TRIGRAM_DISCOUNT * distinct as f64 / total;
        Some(discounted + backoff * bi)
    }

    /// Blends a static log-probability with the personal one. Returns the
    /// static value unchanged when there is no personal evidence.
    pub fn blend(&self, ctx: Context<'_>, word: &str, static_log_prob: f64) -> f64 {
        let Some(personal) = self.probability(ctx, word) else {
            return static_log_prob;
        };
        let c_prev = self.context_count(ctx.prev) as f64;
        let mu = (c_prev / (c_prev + CONFIDENCE_K)).min(MAX_CONFIDENCE);
        let mixed = (1.0 - mu) * static_log_prob.exp() + mu * personal;
        if mixed > 0.0 { mixed.ln() } else { static_log_prob }
    }

    /// Every bigram row as `(prev, word, count)`, for the file store.
    pub fn bigrams(&self) -> impl Iterator<Item = (&str, &str, u32)> + '_ {
        self.bigram.iter().map(|((p, w), c)| (p.as_str(), w.as_str(), *c))
    }

    /// Every trigram row as `(prev2, prev, word, count)`.
    pub fn trigrams(&self) -> impl Iterator<Item = (&str, &str, &str, u32)> + '_ {
        self.trigram
            .iter()
            .map(|((p2, p, w), c)| (p2.as_str(), p.as_str(), w.as_str(), *c))
    }

    fn halve(&mut self) {
        let mut fresh = UserNgram::default();
        for ((p, w), c) in &self.bigram {
            let half = c / 2;
            if half > 0 {
                fresh.record(Context::after(p), w, half);
            }
        }
        for ((p2, p, w), c) in &self.trigram {
            let half = c / 2;
            if half > 0 {
                // Trigram rows re-add their bigram share; take it back so the
                // bigram counts are not doubled.
                fresh.record(Context::of(Some(p2), p), w, half);
                fresh.unrecord_bigram_only(p, w, half);
            }
        }
        *self = fresh;
    }

    fn unrecord_bigram_only(&mut self, prev: &str, word: &str, times: u32) {
        let bk = (prev.to_string(), word.to_string());
        if let Some(c) = self.bigram.get_mut(&bk) {
            let taken = times.min(*c);
            *c -= taken;
            if *c == 0 {
                self.bigram.remove(&bk);
            }
            dec(&mut self.prev_total, prev, taken);
            dec(&mut self.word_total, word, taken);
            self.total = self.total.saturating_sub(taken as u64);
        }
    }
}

fn dec(map: &mut HashMap<String, u32>, key: &str, by: u32) {
    if let Some(v) = map.get_mut(key) {
        *v = v.saturating_sub(by);
        if *v == 0 {
            map.remove(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_undo() {
        let mut n = UserNgram::new();
        n.record(Context::after("我"), "想", 2);
        n.record(Context::of(Some("我"), "也"), "想", 1);
        assert_eq!(n.bigram_count("我", "想"), 2);
        assert_eq!(n.bigram_count("也", "想"), 1);
        assert_eq!(n.trigram_count("我", "也", "想"), 1);
        assert_eq!(n.context_count("我"), 2);
        n.unrecord(Context::after("我"), "想", 2);
        n.unrecord(Context::of(Some("我"), "也"), "想", 1);
        assert!(n.is_empty());
        assert_eq!(n.context_count("我"), 0);
        assert_eq!(n.len(), 0);
    }

    #[test]
    fn personal_bigram_flips_a_near_tie() {
        let mut n = UserNgram::new();
        let static_a = (0.010f64).ln();
        let static_b = (0.011f64).ln();
        assert_eq!(
            n.blend(Context::after("我"), "A", static_a),
            static_a,
            "no evidence, static unchanged"
        );
        for _ in 0..4 {
            n.record(Context::after("我"), "A", 1);
        }
        assert!(n.blend(Context::after("我"), "A", static_a) > n.blend(Context::after("我"), "B", static_b));
    }

    #[test]
    fn confidence_is_capped() {
        let mut n = UserNgram::new();
        n.record(Context::after("x"), "y", 1_000);
        let blended = n.blend(Context::after("x"), "y", (1e-9f64).ln());
        // μ ≤ 0.5 and personal p ≈ 1 → mixed ≈ 0.5
        assert!(blended < (0.51f64).ln() && blended > (0.49f64).ln(), "{blended}");
    }

    #[test]
    fn trigram_separates_what_bigram_cannot() {
        let mut n = UserNgram::new();
        n.record(Context::of(Some("我"), "也"), "想", 3);
        n.record(Context::of(Some("他"), "也"), "相", 3);
        let p_xiang1 = n.probability(Context::of(Some("我"), "也"), "想").unwrap();
        let p_xiang2 = n.probability(Context::of(Some("我"), "也"), "相").unwrap();
        assert!(p_xiang1 > p_xiang2);
        let bi_only = n.probability(Context::after("也"), "想").unwrap();
        let bi_only2 = n.probability(Context::after("也"), "相").unwrap();
        assert!(
            (bi_only - bi_only2).abs() < 1e-12,
            "bigram alone cannot tell them apart"
        );
    }

    #[test]
    fn halving_keeps_the_table_bounded() {
        let mut n = UserNgram::new();
        for i in 0..(MAX_TRANSITIONS + 10) {
            n.record(Context::after(&format!("p{i}")), "w", 4);
        }
        assert!(n.len() <= MAX_TRANSITIONS);
        assert!(n.bigram_count("p0", "w") < 4, "surviving rows were halved");
    }
}
