//! `Engine::query`: keys in, ranked candidates out.

use std::sync::Arc;

use meridian_ime_dict::{DictSet, LookupLimits, SyllableTable};
use meridian_ime_proto::PreeditSegment;

use crate::lattice::SpanCache;
use crate::learn::Learner;
use crate::scheme::{InputScheme, Segmentation};
use crate::sentence::{NoScorer, SentenceScorer};

/// Where a candidate came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateSource {
    /// One dictionary word.
    Dict,
    /// One user word.
    User,
    /// Several words joined by the sentence search.
    Sentence,
}

impl From<CandidateSource> for meridian_ime_proto::CandidateSource {
    fn from(s: CandidateSource) -> Self {
        match s {
            CandidateSource::Dict => Self::Dict,
            CandidateSource::User => Self::User,
            CandidateSource::Sentence => Self::Sentence,
        }
    }
}

/// One thing the person may pick.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub text: String,
    /// Higher is better; only comparable within one query.
    pub score: f64,
    pub source: CandidateSource,
    /// The words this candidate is made of, each with its canonical spaced
    /// code: one for a dictionary word, several for a sentence. The session
    /// records transitions between them after a commit.
    pub words: Vec<(String, String)>,
    /// How many keys (chars of the key string) this candidate consumes. Less
    /// than the whole when it is a word for a prefix of the input.
    pub consumed: usize,
}

impl Candidate {
    /// Canonical spaced code of the whole candidate.
    pub fn code(&self) -> String {
        self.words.iter().map(|(_, c)| c.as_str()).collect::<Vec<_>>().join(" ")
    }
}

/// The answer to one key string.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Query {
    pub keys: String,
    pub segmentation: Segmentation,
    pub preedit: Vec<PreeditSegment>,
    /// Best first, deduplicated by text.
    pub candidates: Vec<Candidate>,
}

/// What surrounds the cursor. Only the scorer reads it; without one it changes
/// nothing.
#[derive(Debug, Clone, Copy, Default)]
pub struct QueryContext<'a> {
    /// Text before the cursor, nearest last.
    pub left: &'a str,
    /// Text after the cursor, nearest first.
    pub right: &'a str,
    /// Memory hints, where they are allowed.
    pub hints: &'a [String],
}

impl QueryContext<'_> {
    pub const EMPTY: QueryContext<'static> = QueryContext {
        left: "",
        right: "",
        hints: &[],
    };
}

/// The engine: dictionaries plus the scorer. Shared by every session; the
/// per-session state (cache, keys) is passed in.
pub struct Engine {
    dicts: Arc<DictSet>,
    scorer: Box<dyn SentenceScorer>,
    limits: LookupLimits,
}

impl Engine {
    pub fn new(dicts: Arc<DictSet>) -> Self {
        Self {
            dicts,
            scorer: Box::new(NoScorer),
            limits: LookupLimits::default(),
        }
    }

    pub fn with_scorer(mut self, scorer: Box<dyn SentenceScorer>) -> Self {
        self.scorer = scorer;
        self
    }

    pub fn with_limits(mut self, limits: LookupLimits) -> Self {
        self.limits = limits;
        self
    }

    pub fn dicts(&self) -> &Arc<DictSet> {
        &self.dicts
    }

    pub fn table(&self) -> &SyllableTable {
        self.dicts.table()
    }

    pub fn scorer(&self) -> &dyn SentenceScorer {
        self.scorer.as_ref()
    }

    pub fn limits(&self) -> &LookupLimits {
        &self.limits
    }

    /// `true` when no dictionary holds anything; the session shows a notice.
    pub fn is_empty(&self) -> bool {
        self.dicts.is_empty()
    }

    /// Ranks candidates for `keys` under `scheme`. `learner` is read for
    /// personal weights and transitions; `cache` is the session's span cache.
    pub fn query(&self, keys: &str, scheme: InputScheme, learner: &dyn Learner, cache: &mut SpanCache) -> Query {
        self.query_with(keys, scheme, learner, cache, &QueryContext::EMPTY)
    }

    /// [`Engine::query`] with what surrounds the cursor, for the scorer.
    pub fn query_with(
        &self,
        keys: &str,
        scheme: InputScheme,
        learner: &dyn Learner,
        cache: &mut SpanCache,
        context: &QueryContext<'_>,
    ) -> Query {
        crate::sentence::compose::query(self, keys, scheme, learner, cache, context)
    }
}
