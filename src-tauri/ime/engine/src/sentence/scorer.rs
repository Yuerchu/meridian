//! The reranking hook.
//!
//! The beam search produces a handful of complete readings scored by the
//! static unigram and the personal n-gram. A [`SentenceScorer`] may re-score
//! them against a language model; the engine mixes its score in as
//! `path_score + λ · (scorer_score − static_score)` so the personal n-gram
//! and the user's own weights survive the rerank. The MVP ships [`NoScorer`];
//! a local model plugs in here later, on a background thread, and answers
//! with an empty vector when it cannot keep up.

/// Scores readings of one input.
pub trait SentenceScorer: Send + Sync {
    /// Log-probability of each `texts[i]` as a continuation of `context`, in
    /// the same order, or an empty vector when no score is available.
    fn score(&self, context: &str, texts: &[&str]) -> Vec<f64>;
}

/// Never answers.
pub struct NoScorer;

impl SentenceScorer for NoScorer {
    fn score(&self, _context: &str, _texts: &[&str]) -> Vec<f64> {
        Vec::new()
    }
}
