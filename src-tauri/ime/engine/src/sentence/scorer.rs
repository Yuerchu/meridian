//! The reranking hook.
//!
//! The beam search produces a handful of complete readings, and the lattice
//! a list of words covering the whole input, all scored by the static unigram
//! and the personal n-gram. A [`SentenceScorer`] may re-score both against a
//! language model; the engine mixes its score in as
//! `path_score + λ · (scorer_score − static_score)` so the personal n-gram
//! and the user's own weights survive the rerank.
//!
//! A scorer is asked once per query, synchronously, on the keystroke path.
//! One that cannot answer in time returns an empty vector and costs nothing;
//! that is how a model on a slow phone degrades to the dictionary alone. Its
//! numbers must already be on the dictionary's scale — a model reports how
//! to convert in its own manifest, so the engine never needs to know which
//! model it is talking to.

use crate::scheme::InputScheme;

/// Everything a scorer may condition on for one query.
#[derive(Debug, Clone, Copy)]
pub struct ScoreRequest<'a> {
    pub scheme: InputScheme,
    /// The keys as typed, tone keys included: a tone-aware model uses them.
    pub keys: &'a str,
    /// Text before the cursor, nearest last.
    pub left: &'a str,
    /// Text after the cursor, nearest first.
    pub right: &'a str,
    /// Phrases the person's own context makes likely (their memory, inside
    /// Meridian only). Empty everywhere else.
    pub hints: &'a [String],
    /// The candidates to score.
    pub texts: &'a [&'a str],
}

/// Scores candidates for one input.
pub trait SentenceScorer: Send + Sync {
    /// Log-probability of each `texts[i]` at the cursor, in the same order,
    /// or an empty vector when no score is available.
    fn score(&self, req: &ScoreRequest<'_>) -> Vec<f64>;
}

/// Never answers.
pub struct NoScorer;

impl SentenceScorer for NoScorer {
    fn score(&self, _req: &ScoreRequest<'_>) -> Vec<f64> {
        Vec::new()
    }
}

/// One loaded model serves every engine built after it: rebuilding the
/// engine for a dictionary change must not reload the model.
impl<T: SentenceScorer + ?Sized> SentenceScorer for std::sync::Arc<T> {
    fn score(&self, req: &ScoreRequest<'_>) -> Vec<f64> {
        (**self).score(req)
    }
}
