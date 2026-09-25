//! Whole-input readings by beam search, and the hook a model reranker plugs
//! into.

pub mod compose;
mod scorer;

pub use scorer::{NoScorer, ScoreRequest, SentenceScorer};
