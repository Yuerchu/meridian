//! Input schemes: how a string of keys becomes syllables.
//!
//! The session keeps the keys exactly as typed (`nihao`, or `su3cl3` for
//! ㄋㄧˇㄏㄠˇ) and a scheme turns them into a [`SyllableDag`]: for every key
//! position, the syllables that could start there and where each ends. Edges
//! are canonical pinyin syllables whatever the scheme, which is why one
//! dictionary and one lattice serve both.
//!
//! An edge is `complete` when the keys spell a whole syllable, and incomplete
//! when they are the start of one — a bare initial anywhere (`n` for 你, the
//! 简拼 case) or an unfinished syllable at the end (`zho`). Incomplete edges
//! are what put candidates on screen from the first keystroke.

pub mod grid;
pub mod keys;
pub mod pinyin;
pub mod zhuyin;

pub use grid::GridScheme;
pub use pinyin::PinyinScheme;
pub use zhuyin::ZhuyinScheme;

use meridian_ime_dict::SyllableTable;
use meridian_ime_proto::PreeditSegment;

/// One way of reading some keys as a syllable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyllableEdge {
    /// Key index (in `char`s of the key string) just past this edge.
    pub end: usize,
    /// Canonical pinyin: a whole syllable when `complete`, else the typed
    /// prefix (for pinyin) or the pinyin the typed zhuyin prefix stands for.
    pub text: String,
    pub complete: bool,
}

/// `dag[i]` holds the edges starting at key index `i`; length is the key
/// count, so the end of input is index `len` and has no entry.
pub type SyllableDag = Vec<Vec<SyllableEdge>>;

/// One reading of the whole key string, for the preedit.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Segmentation {
    /// `(start, end)` key indices and the edge's text/completeness.
    pub edges: Vec<SyllableEdge>,
    /// Key index each edge starts at, parallel to `edges`.
    pub starts: Vec<usize>,
}

impl Segmentation {
    pub fn is_empty(&self) -> bool {
        self.edges.is_empty()
    }

    /// Key index the last edge ends at (0 when empty).
    pub fn end(&self) -> usize {
        self.edges.last().map(|e| e.end).unwrap_or(0)
    }
}

/// The schemes, chosen per session: pinyin and zhuyin from the desktop
/// profile, grid from the phone keyboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum InputScheme {
    #[default]
    Pinyin,
    Zhuyin,
    Grid,
}

impl InputScheme {
    pub fn parser(self, table: &SyllableTable) -> Box<dyn SchemeParser + '_> {
        match self {
            InputScheme::Pinyin => Box::new(PinyinScheme::new(table)),
            InputScheme::Zhuyin => Box::new(ZhuyinScheme::new(table)),
            InputScheme::Grid => Box::new(GridScheme::new(table)),
        }
    }
}

/// A scheme: keys in, DAG out, plus how to show the keys to the person.
pub trait SchemeParser {
    /// `true` when `ch` is a key this scheme spells syllables with (a letter
    /// for pinyin; a bopomofo key or tone key for zhuyin). The session uses
    /// it to decide whether a printable key starts or extends a composition.
    fn accepts_key(&self, ch: char) -> bool;

    /// Builds the DAG over `keys`. Positions that start no syllable get an
    /// empty vector; a key string that is not this scheme's at all gives a DAG
    /// with no path to the end, which the lattice reports as no candidates.
    fn build_dag(&self, keys: &str) -> SyllableDag;

    /// The best reading of `keys` for display: fewest syllables, then fewest
    /// incomplete, then longer syllables earlier. Empty when nothing parses.
    fn segment(&self, keys: &str) -> Segmentation;

    /// The preedit for a reading: pinyin shows `ni hao` with the unfinished
    /// syllable marked `Partial`; zhuyin shows bopomofo symbols.
    fn preedit(&self, keys: &str, seg: &Segmentation) -> Vec<PreeditSegment>;
}
