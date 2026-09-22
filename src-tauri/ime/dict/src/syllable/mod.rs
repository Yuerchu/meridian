//! The syllable inventory both the dictionary and the engine agree on.
//!
//! A dictionary code is a sequence of toneless pinyin syllables joined by
//! single spaces (`"ni hao"`), and every syllable must be one of the 457 in
//! `pinyin_table.txt`. The table also fixes the *spelling* of the awkward ones:
//! `ü` is written `v` (`lv`, `nve`), never `u:` or `lue`. `normalize_syllable`
//! folds the other spellings into that one so an imported dictionary and a
//! typed key agree.
//!
//! Zhuyin (bopomofo) shares this inventory: a zhuyin syllable is the same
//! toneless syllable written with different symbols, so the table also carries
//! the pinyin ↔ zhuyin correspondence and the standard (大千) keyboard layout.
//! The correspondence is derived by rule from the pinyin spelling rather than
//! typed out, and a test proves every one of the 457 syllables round-trips.

mod zhuyin;

use std::collections::HashMap;

pub use zhuyin::{ZhuyinRole, ZhuyinSymbol, zhuyin_key_layout, zhuyin_role, zhuyin_symbol_for_key};

/// The raw table, one syllable per line.
pub const PINYIN_TABLE: &str = include_str!("pinyin_table.txt");

/// Longest syllable in the table, in bytes (`zhuang`, `chuang`, `shuang`).
pub const MAX_SYLLABLE_LEN: usize = 6;

/// The 23 initials a syllable may start with. `y` and `w` are included because a
/// typist abbreviating `yi` or `wo` types those letters, whatever phonology says.
pub const INITIALS: [&str; 23] = [
    "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "zh", "ch", "sh", "r", "z", "c", "s", "y",
    "w",
];

/// The syllable inventory with the lookups the parser and the importer need.
#[derive(Debug)]
pub struct SyllableTable {
    syllables: Vec<&'static str>,
    index: HashMap<&'static str, u16>,
    /// Every proper prefix of a syllable, so the parser can tell `zho` (a
    /// syllable still being typed) from `zx` (nothing).
    prefixes: HashMap<&'static str, ()>,
    zhuyin_of: Vec<String>,
    pinyin_of_zhuyin: HashMap<String, u16>,
    sha256: String,
}

impl SyllableTable {
    /// Builds the table from the embedded list. Cheap; callers keep one and share it.
    pub fn new() -> Self {
        let syllables: Vec<&'static str> = PINYIN_TABLE.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
        let mut index = HashMap::with_capacity(syllables.len());
        let mut prefixes = HashMap::new();
        for (i, s) in syllables.iter().enumerate() {
            index.insert(*s, i as u16);
            for end in 1..s.len() {
                prefixes.insert(&s[..end], ());
            }
        }
        let zhuyin_of: Vec<String> = syllables.iter().map(|s| zhuyin::pinyin_to_zhuyin(s)).collect();
        let mut pinyin_of_zhuyin = HashMap::with_capacity(syllables.len());
        for (i, z) in zhuyin_of.iter().enumerate() {
            let previous = pinyin_of_zhuyin.insert(z.clone(), i as u16);
            debug_assert!(previous.is_none(), "two syllables map to the same zhuyin: {z}");
        }
        let sha256 = {
            use sha2::Digest;
            let mut h = sha2::Sha256::new();
            h.update(PINYIN_TABLE.as_bytes());
            hex(&h.finalize())
        };
        Self {
            syllables,
            index,
            prefixes,
            zhuyin_of,
            pinyin_of_zhuyin,
            sha256,
        }
    }

    /// Number of syllables in the table.
    pub fn len(&self) -> usize {
        self.syllables.len()
    }

    /// The table is never empty; this exists for clippy's `len_without_is_empty`.
    pub fn is_empty(&self) -> bool {
        self.syllables.is_empty()
    }

    /// Every syllable, in table order.
    pub fn syllables(&self) -> &[&'static str] {
        &self.syllables
    }

    /// SHA-256 of the embedded table, mixed into dictionary cache keys so a
    /// table change invalidates every `.mdict` built against the old one.
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    /// `true` when `s` is exactly one syllable in the canonical spelling.
    pub fn contains(&self, s: &str) -> bool {
        self.index.contains_key(s)
    }

    /// Index of a syllable in table order, if it is one.
    pub fn id(&self, s: &str) -> Option<u16> {
        self.index.get(s).copied()
    }

    /// `true` when `s` is a proper prefix of at least one syllable — the state
    /// of a syllable the typist has not finished. A complete syllable that is
    /// also a prefix of a longer one (`zh` of `zhi`) counts as a prefix too.
    pub fn is_prefix(&self, s: &str) -> bool {
        self.prefixes.contains_key(s)
    }

    /// `true` when `s` is one of the 23 initials.
    pub fn is_initial(&self, s: &str) -> bool {
        INITIALS.contains(&s)
    }

    /// The initial of a syllable: `zh` for `zhong`, `n` for `ni`, and the
    /// first letter for a syllable with none (`a` for `an`), since that is the
    /// key a typist abbreviating it would press.
    pub fn initial_of<'a>(&self, syllable: &'a str) -> &'a str {
        if syllable.len() >= 2 && matches!(&syllable[..2], "zh" | "ch" | "sh") {
            &syllable[..2]
        } else {
            &syllable[..1]
        }
    }

    /// The abbreviation key of a code: the initial of each syllable, joined by
    /// spaces. `"ni hao"` → `"n h"`, `"zhong guo"` → `"zh g"`. `None` when any
    /// token is not a syllable.
    pub fn abbr_key(&self, code: &str) -> Option<String> {
        let mut out = String::with_capacity(code.len());
        for (i, token) in code.split(' ').enumerate() {
            if !self.contains(token) {
                return None;
            }
            if i > 0 {
                out.push(' ');
            }
            out.push_str(self.initial_of(token));
        }
        Some(out)
    }

    /// `true` when every space-separated token of `code` is a syllable.
    pub fn is_valid_code(&self, code: &str) -> bool {
        !code.is_empty() && code.split(' ').all(|t| self.contains(t))
    }

    /// `true` when an unspaced string can be cut entirely into syllables (any
    /// cut, not a particular one) — what tells `nihao` from `hello`.
    pub fn is_fully_segmentable(&self, s: &str) -> bool {
        if s.is_empty() || !s.is_ascii() {
            return false;
        }
        let bytes = s.as_bytes();
        let mut reachable = vec![false; bytes.len() + 1];
        reachable[0] = true;
        for start in 0..bytes.len() {
            if !reachable[start] {
                continue;
            }
            let max_end = (start + MAX_SYLLABLE_LEN).min(bytes.len());
            for end in start + 1..=max_end {
                if self.contains(&s[start..end]) {
                    reachable[end] = true;
                }
            }
        }
        reachable[bytes.len()]
    }

    /// The zhuyin spelling of a syllable given by table index.
    pub fn zhuyin_of_id(&self, id: u16) -> &str {
        &self.zhuyin_of[id as usize]
    }

    /// The zhuyin spelling of a canonical pinyin syllable.
    pub fn zhuyin_of(&self, syllable: &str) -> Option<&str> {
        self.id(syllable).map(|id| self.zhuyin_of_id(id))
    }

    /// The pinyin syllable a complete toneless zhuyin spelling stands for.
    pub fn pinyin_of_zhuyin(&self, zhuyin: &str) -> Option<&'static str> {
        self.pinyin_of_zhuyin.get(zhuyin).map(|&id| self.syllables[id as usize])
    }

    /// `true` when `zhuyin` is a proper prefix of some syllable's zhuyin
    /// spelling — a zhuyin syllable still being typed.
    pub fn is_zhuyin_prefix(&self, zhuyin: &str) -> bool {
        if zhuyin.is_empty() {
            return false;
        }
        self.zhuyin_of
            .iter()
            .any(|z| z.len() > zhuyin.len() && z.starts_with(zhuyin))
    }
}

impl Default for SyllableTable {
    fn default() -> Self {
        Self::new()
    }
}

/// Folds the spellings of `ü` into the table's `v`: `lü`/`lu:`/`lue` → `lv`/`lve`,
/// `nue` → `nve`, `ju`… untouched (after j/q/x/y the `u` already is `ü`). Also
/// lowercases. Returns the input unchanged when nothing applies.
pub fn normalize_syllable(s: &str) -> String {
    let mut out = s.to_lowercase();
    if out.contains('ü') {
        out = out.replace('ü', "v");
    }
    if out.contains("u:") {
        out = out.replace("u:", "v");
    }
    match out.as_str() {
        "lue" => "lve".to_string(),
        "nue" => "nve".to_string(),
        _ => out,
    }
}

/// Applies `normalize_syllable` to every token of a spaced code and collapses
/// runs of whitespace to single spaces.
pub fn normalize_code(code: &str) -> String {
    let mut out = String::with_capacity(code.len());
    for (i, token) in code.split_whitespace().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(&normalize_syllable(token));
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 0xf) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_has_the_expected_shape() {
        let t = SyllableTable::new();
        assert_eq!(t.len(), 458);
        assert!(t.contains("zhuang"));
        assert!(t.contains("lve"));
        assert!(!t.contains("lue"));
        assert!(!t.contains("v"));
        assert_eq!(t.syllables().iter().map(|s| s.len()).max(), Some(MAX_SYLLABLE_LEN));
    }

    #[test]
    fn prefixes_and_initials() {
        let t = SyllableTable::new();
        assert!(t.is_prefix("zho"));
        assert!(t.is_prefix("zh"));
        assert!(t.is_prefix("n"));
        assert!(!t.is_prefix("zx"));
        assert!(!t.is_prefix("zhuang"));
        assert!(t.is_initial("zh"));
        assert!(t.is_initial("y"));
        assert!(!t.is_initial("i"));
        assert_eq!(t.initial_of("zhong"), "zh");
        assert_eq!(t.initial_of("ni"), "n");
        assert_eq!(t.initial_of("an"), "a");
    }

    #[test]
    fn abbreviation_keys() {
        let t = SyllableTable::new();
        assert_eq!(t.abbr_key("ni hao").as_deref(), Some("n h"));
        assert_eq!(t.abbr_key("zhong guo").as_deref(), Some("zh g"));
        assert_eq!(t.abbr_key("ni hello"), None);
    }

    #[test]
    fn validity_and_segmentability() {
        let t = SyllableTable::new();
        assert!(t.is_valid_code("ni hao"));
        assert!(!t.is_valid_code("nihao"));
        assert!(!t.is_valid_code(""));
        assert!(!t.is_valid_code("ni  hao"));
        assert!(t.is_fully_segmentable("nihao"));
        assert!(t.is_fully_segmentable("xian"));
        assert!(!t.is_fully_segmentable("hello"));
        assert!(!t.is_fully_segmentable("你好"));
    }

    #[test]
    fn normalisation_folds_umlaut_spellings() {
        assert_eq!(normalize_syllable("LÜ"), "lv");
        assert_eq!(normalize_syllable("lu:e"), "lve");
        assert_eq!(normalize_syllable("nue"), "nve");
        assert_eq!(normalize_syllable("ju"), "ju");
        assert_eq!(normalize_code("Ni   Hao"), "ni hao");
        assert_eq!(normalize_code(" lue "), "lve");
    }

    #[test]
    fn every_syllable_round_trips_through_zhuyin() {
        let t = SyllableTable::new();
        for s in t.syllables() {
            let z = t.zhuyin_of(s).unwrap();
            assert!(!z.is_empty(), "{s} has no zhuyin");
            assert_eq!(t.pinyin_of_zhuyin(z), Some(*s), "{s} → {z} does not come back");
        }
        assert_eq!(t.zhuyin_of("zhong"), Some("ㄓㄨㄥ"));
        assert_eq!(t.zhuyin_of("ni"), Some("ㄋㄧ"));
        assert_eq!(t.zhuyin_of("hao"), Some("ㄏㄠ"));
        assert_eq!(t.zhuyin_of("zhi"), Some("ㄓ"));
        assert_eq!(t.zhuyin_of("yi"), Some("ㄧ"));
        assert_eq!(t.zhuyin_of("wu"), Some("ㄨ"));
        assert_eq!(t.zhuyin_of("yu"), Some("ㄩ"));
        assert_eq!(t.zhuyin_of("ju"), Some("ㄐㄩ"));
        assert_eq!(t.zhuyin_of("jue"), Some("ㄐㄩㄝ"));
        assert_eq!(t.zhuyin_of("you"), Some("ㄧㄡ"));
        assert_eq!(t.zhuyin_of("liu"), Some("ㄌㄧㄡ"));
        assert_eq!(t.zhuyin_of("gui"), Some("ㄍㄨㄟ"));
        assert_eq!(t.zhuyin_of("lun"), Some("ㄌㄨㄣ"));
        assert_eq!(t.zhuyin_of("lve"), Some("ㄌㄩㄝ"));
        assert_eq!(t.zhuyin_of("er"), Some("ㄦ"));
        assert_eq!(t.zhuyin_of("weng"), Some("ㄨㄥ"));
        assert_eq!(t.zhuyin_of("yong"), Some("ㄩㄥ"));
        assert_eq!(t.zhuyin_of("xiong"), Some("ㄒㄩㄥ"));
        assert!(t.is_zhuyin_prefix("ㄓㄨ"));
        assert!(!t.is_zhuyin_prefix("ㄓㄨㄥ"));
    }
}
