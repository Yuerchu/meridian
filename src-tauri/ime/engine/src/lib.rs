//! Meridian 输入法引擎：从按键到候选。
//!
//! The pipeline is scheme → syllable DAG → word lattice → sentence search →
//! ranked candidates, with the learning layer read at scoring time and written
//! by the session after a commit.
//!
//! - [`scheme`]: how keys become syllables. Pinyin and zhuyin are two
//!   [`scheme::SchemeParser`]s producing the same [`scheme::SyllableDag`], so
//!   everything after the parser is scheme-agnostic.
//! - [`lattice`]: a span of DAG edges becomes a set of dictionary hits, through
//!   `DictSet::lookup_pattern`, memoised across keystrokes in a [`lattice::SpanCache`].
//! - [`sentence`]: beam search over the lattice for whole-input readings, and
//!   the [`sentence::SentenceScorer`] hook a future model reranker plugs into.
//! - [`learn`]: the [`learn::Learner`] the scorer reads and the session writes.
//! - [`Engine::query`] ties them together and returns a [`Query`].
//!
//! Nothing here knows about keys as *events* (paging, selection, punctuation):
//! that is `meridian-ime-session`. Nothing here touches a file except the
//! learning layer's own store and the dictionaries it is handed.

pub mod lattice;
pub mod learn;
pub mod query;
pub mod scheme;
pub mod sentence;
pub mod storage;

pub use lattice::SpanCache;
pub use learn::{Context, FileLearner, Learner, MemoryLearner, Muted};
pub use query::{Candidate, CandidateSource, Engine, Query};
pub use scheme::{InputScheme, Segmentation, SyllableDag, SyllableEdge};
pub use sentence::{NoScorer, SentenceScorer};
