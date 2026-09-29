//! Grid: the nine-column phone layout. Its keys carry pinyin letters, but the
//! structure is zhuyin's — an initial, an optional medial (`y` `w` `v` for
//! ㄧㄨㄩ), a final, and an optional tone key — so a syllable is spelled by
//! mapping its bopomofo spelling onto keys (`grid_initials.txt`,
//! `grid_rimes.txt`) rather than by reading pinyin.
//!
//! The layout is fuzzy by design. `z` `c` `s` each stand for both the dental
//! and the retroflex initial, and `ng` is the only nasal key, so `z w ng` reads
//! zong, zhong, zun and zhun alike. Every syllable a key sequence can mean
//! becomes its own complete edge from the same start to the same end; the
//! lattice looks each one up and the candidates sort it out. That is the whole
//! cost of the fuzziness: more edges, no change to the dictionary.
//!
//! Tones are optional. A tone key right after a syllable is absorbed into it
//! (the edge ends after the tone) and is a firm boundary; without one the
//! boundary is inferred, as in pinyin. The tone's value is not used yet — the
//! dictionary has none — which is what the tone-aware scorer is for.
//!
//! One key is one `char`, so the session's key string, `Candidate::consumed`
//! and backspace all keep counting characters. Single-letter keys are the
//! letters themselves; the multi-letter ones (`ai` `ao` `ei` `ou` `er` `ng`)
//! are private-use code points and the tone keys are the tone marks. The
//! preedit shows labels, never a private-use character.

use std::collections::HashMap;
use std::sync::OnceLock;

use super::pinyin::{raw_preedit, segment_dag};
use super::{SchemeParser, Segmentation, SyllableDag, SyllableEdge};
use meridian_ime_dict::SyllableTable;
use meridian_ime_dict::syllable::{ZhuyinRole, zhuyin_role};
use meridian_ime_proto::{PreeditKind, PreeditSegment};
use sha2::{Digest, Sha256};

/// What position a key takes in a syllable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GridRole {
    Initial,
    Medial,
    Final,
    /// `ng`: the nasal tail, after a final or a medial.
    Nasal,
    Tone,
}

/// One key of the grid layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GridToken {
    /// The `char` the key puts in the key string.
    pub key: char,
    /// The name used in the data files and in test scripts (`ai`, `ng`, `t3`).
    pub name: &'static str,
    /// What the preedit shows for it.
    pub label: &'static str,
    pub role: GridRole,
    /// What a long press offers instead, by name: the precise keys behind a
    /// fuzzy one. The keyboard draws its long-press menu from this, so the
    /// engine and the layout cannot disagree about what a key can mean.
    pub variants: &'static [&'static str],
}

const fn tok(key: char, name: &'static str, label: &'static str, role: GridRole) -> GridToken {
    GridToken {
        key,
        name,
        label,
        role,
        variants: &[],
    }
}

const fn fuzzy(
    key: char,
    name: &'static str,
    label: &'static str,
    role: GridRole,
    variants: &'static [&'static str],
) -> GridToken {
    GridToken {
        key,
        name,
        label,
        role,
        variants,
    }
}

/// Every key of the layout. The Android keyboard sends exactly these `char`s.
pub const GRID_TOKENS: &[GridToken] = &[
    tok('b', "b", "b", GridRole::Initial),
    tok('p', "p", "p", GridRole::Initial),
    tok('m', "m", "m", GridRole::Initial),
    tok('f', "f", "f", GridRole::Initial),
    tok('d', "d", "d", GridRole::Initial),
    tok('t', "t", "t", GridRole::Initial),
    tok('n', "n", "n", GridRole::Initial),
    tok('l', "l", "l", GridRole::Initial),
    tok('g', "g", "g", GridRole::Initial),
    tok('k', "k", "k", GridRole::Initial),
    tok('h', "h", "h", GridRole::Initial),
    tok('j', "j", "j", GridRole::Initial),
    tok('q', "q", "q", GridRole::Initial),
    tok('x', "x", "x", GridRole::Initial),
    fuzzy('z', "z", "z", GridRole::Initial, &["z_", "zh"]),
    fuzzy('c', "c", "c", GridRole::Initial, &["c_", "ch"]),
    fuzzy('s', "s", "s", GridRole::Initial, &["s_", "sh"]),
    tok('r', "r", "r", GridRole::Initial),
    tok('y', "y", "y", GridRole::Medial),
    tok('w', "w", "w", GridRole::Medial),
    tok('v', "v", "v", GridRole::Medial),
    tok('a', "a", "a", GridRole::Final),
    tok('o', "o", "o", GridRole::Final),
    tok('e', "e", "e", GridRole::Final),
    tok('\u{E000}', "ai", "ai", GridRole::Final),
    tok('\u{E001}', "ao", "ao", GridRole::Final),
    tok('\u{E002}', "ei", "ei", GridRole::Final),
    tok('\u{E003}', "ou", "ou", GridRole::Final),
    tok('\u{E004}', "er", "er", GridRole::Final),
    fuzzy('\u{E005}', "ng", "ng", GridRole::Nasal, &["er", "-n", "-ng"]),
    // The precise keys behind the fuzzy ones, reached by a long press: each
    // spells exactly one of what its fuzzy key covers.
    tok('\u{E006}', "zh", "zh", GridRole::Initial),
    tok('\u{E007}', "ch", "ch", GridRole::Initial),
    tok('\u{E008}', "sh", "sh", GridRole::Initial),
    tok('\u{E009}', "z_", "z", GridRole::Initial),
    tok('\u{E00A}', "c_", "c", GridRole::Initial),
    tok('\u{E00B}', "s_", "s", GridRole::Initial),
    tok('\u{E00C}', "-n", "n", GridRole::Nasal),
    tok('\u{E00D}', "-ng", "ng", GridRole::Nasal),
    tok('\u{02C9}', "t1", "ˉ", GridRole::Tone),
    tok('\u{02CA}', "t2", "ˊ", GridRole::Tone),
    tok('\u{02C7}', "t3", "ˇ", GridRole::Tone),
    tok('\u{02CB}', "t4", "ˋ", GridRole::Tone),
    tok('\u{02D9}', "t5", "˙", GridRole::Tone),
];

/// The token a key stands for, or `None` for a key outside the layout.
pub fn grid_token(ch: char) -> Option<&'static GridToken> {
    GRID_TOKENS.iter().find(|t| t.key == ch)
}

/// The token with this name (`"ai"`, `"ng"`, `"t3"`, `"b"`).
pub fn grid_token_by_name(name: &str) -> Option<&'static GridToken> {
    GRID_TOKENS.iter().find(|t| t.name == name)
}

/// What the preedit shows for a key; a key outside the layout shows itself.
pub fn grid_label(ch: char) -> String {
    grid_token(ch)
        .map(|t| t.label.to_string())
        .unwrap_or_else(|| ch.to_string())
}

/// How a person spells the rimes the two traditions write differently: a
/// pinyin typist drops the `e` of ㄣ/ㄥ after a medial (`dun` → `d w ng`), a
/// zhuyin typist keeps it (ㄉㄨㄣ → `d w e ng`). The layout accepts both at
/// once; this only says which to type when keys are derived for evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SpellingHabit {
    #[default]
    Pinyin,
    Zhuyin,
}

/// Most keys in one syllable before its tone: `zhuang` is `z w a ng`.
pub const MAX_GRID_TOKENS: usize = 4;

const INITIALS_TABLE: &str = include_str!("grid_initials.txt");
const RIMES_TABLE: &str = include_str!("grid_rimes.txt");

/// SHA-256 over both spelling tables and the key table. A model trained on
/// one layout must not be used with another — a key added, renamed or moved
/// to another code point included — and this is what it is checked against.
pub fn grid_table_sha256() -> String {
    let mut h = Sha256::new();
    h.update(INITIALS_TABLE.as_bytes());
    h.update([0u8]);
    h.update(RIMES_TABLE.as_bytes());
    for t in GRID_TOKENS {
        h.update([0u8]);
        h.update(
            format!(
                "{}\t{}\t{:?}\t{}",
                u32::from(t.key),
                t.name,
                t.role,
                t.variants.join(",")
            )
            .as_bytes(),
        );
    }
    format!("{:x}", h.finalize())
}

fn data_lines(table: &'static str) -> impl Iterator<Item = &'static str> {
    table
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
}

fn tokens_of(spec: &str) -> Vec<char> {
    spec.split_whitespace()
        .map(|name| {
            grid_token_by_name(name)
                .unwrap_or_else(|| panic!("grid table names an unknown key {name:?}"))
                .key
        })
        .collect()
}

/// Everything derived from the two tables, built once per process: the
/// tables are compiled in and so is the syllable inventory, so there is only
/// ever one answer.
#[derive(Debug)]
pub struct GridIndex {
    /// Every key sequence that spells a whole syllable, and the syllables it
    /// spells — more than one exactly where the layout is fuzzy.
    by_seq: HashMap<Vec<char>, Vec<&'static str>>,
    /// Every proper prefix of a spelling, and the pinyin it can stand for: one
    /// longest common prefix per initial, so `z` is both `z` and `zh`.
    prefixes: HashMap<Vec<char>, Vec<String>>,
    /// The spellings of each syllable, primary first.
    spellings: HashMap<&'static str, Vec<Vec<char>>>,
    /// The spelling a zhuyin typist uses (see [`SpellingHabit`]).
    zhuyin_spellings: HashMap<&'static str, Vec<char>>,
}

impl GridIndex {
    /// The shared index. Panics at first use if a table names a key or a
    /// bopomofo symbol that does not exist — a build-time mistake, which the
    /// tests exercise.
    pub fn get(table: &SyllableTable) -> &'static GridIndex {
        static INDEX: OnceLock<GridIndex> = OnceLock::new();
        INDEX.get_or_init(|| GridIndex::build(table))
    }

    fn build(table: &SyllableTable) -> GridIndex {
        // Bopomofo initial → (its key, the precise key a long press offers).
        let mut initials: HashMap<char, (char, Option<char>)> = HashMap::new();
        for line in data_lines(INITIALS_TABLE) {
            let fields: Vec<&str> = line.split('\t').map(str::trim).collect();
            assert!(fields.len() == 2 || fields.len() == 3, "bad initials line {line:?}");
            let sym = fields[0].chars().next().expect("empty bopomofo");
            let key = tokens_of(fields[1]);
            assert!(key.len() == 1, "an initial is one key: {line:?}");
            let precise = fields.get(2).map(|p| {
                let k = tokens_of(p);
                assert!(k.len() == 1, "a precise initial is one key: {line:?}");
                k[0]
            });
            initials.insert(sym, (key[0], precise));
        }
        let fuzzy_nasal = grid_token_by_name("ng").expect("ng exists").key;
        let exact_n = grid_token_by_name("-n").expect("-n exists").key;
        let exact_ng = grid_token_by_name("-ng").expect("-ng exists").key;
        // Rime → its spellings, and which one a zhuyin typist uses.
        let mut rimes: HashMap<String, (Vec<Vec<char>>, usize)> = HashMap::new();
        for line in data_lines(RIMES_TABLE) {
            let (rime, spec) = line
                .split_once('\t')
                .unwrap_or_else(|| panic!("bad rimes line {line:?}"));
            let mut zhuyin_at = 0;
            let mut spellings: Vec<Vec<char>> = Vec::new();
            for (i, alt) in spec.split('|').enumerate() {
                let alt = alt.trim();
                match alt.strip_prefix("zhuyin:") {
                    Some(z) => {
                        zhuyin_at = i;
                        spellings.push(tokens_of(z));
                    }
                    None => spellings.push(tokens_of(alt)),
                }
            }
            rimes.insert(rime.trim().to_string(), (spellings, zhuyin_at));
        }
        let mut zhuyin_spellings: HashMap<&'static str, Vec<char>> = HashMap::new();

        let mut spellings: HashMap<&'static str, Vec<Vec<char>>> = HashMap::new();
        for &syllable in table.syllables() {
            let zhuyin = table.zhuyin_of(syllable).expect("every syllable has a zhuyin spelling");
            let mut chars = zhuyin.chars().peekable();
            let (initial, precise_initial) = match chars.peek() {
                Some(&c) if zhuyin_role(c) == Some(ZhuyinRole::Initial) => {
                    chars.next();
                    let (key, precise) = *initials
                        .get(&c)
                        .unwrap_or_else(|| panic!("no grid key for initial {c}"));
                    (Some(key), precise)
                }
                _ => (None, None),
            };
            let rime: String = chars.collect();
            // Which precise nasal this syllable's `ng` stands for.
            let precise_nasal = if rime.contains(['ㄣ', 'ㄢ']) {
                Some(exact_n)
            } else if rime.contains(['ㄥ', 'ㄤ']) {
                Some(exact_ng)
            } else {
                None
            };
            let (rime_spellings, zhuyin_at): (Vec<Vec<char>>, usize) = if rime.is_empty() {
                (vec![Vec::new()], 0)
            } else {
                rimes
                    .get(&rime)
                    .unwrap_or_else(|| panic!("no grid spelling for rime {rime} ({syllable})"))
                    .clone()
            };
            let mut zhuyin_seq: Vec<char> = initial.into_iter().collect();
            zhuyin_seq.extend(&rime_spellings[zhuyin_at]);
            zhuyin_spellings.insert(syllable, zhuyin_seq);
            let mut out = Vec::new();
            for (i, r) in rime_spellings.into_iter().enumerate() {
                // An alternative that would leave a syllable with no initial
                // starting on a bare final reads as that final's own syllable.
                let starts_bare = initial.is_none()
                    && r.first()
                        .and_then(|&k| grid_token(k))
                        .is_some_and(|t| t.role == GridRole::Final);
                if i > 0 && starts_bare {
                    continue;
                }
                let mut seq: Vec<char> = initial.into_iter().collect();
                seq.extend(r);
                assert!(
                    seq.len() <= MAX_GRID_TOKENS,
                    "{syllable} is spelled with more than {MAX_GRID_TOKENS} keys"
                );
                out.push(seq);
            }
            // Every spelling again with its shared keys replaced by the
            // precise ones — the initial, the nasal, or both — after the
            // ordinary spellings, which stay first because they are what a
            // plain tap types.
            let ordinary = out.len();
            for i in 0..ordinary {
                let seq = out[i].clone();
                let swap_initial = |s: &mut Vec<char>| {
                    if let (Some(p), Some(first)) = (precise_initial, s.first_mut()) {
                        *first = p;
                    }
                };
                let swap_nasal = |s: &mut Vec<char>| {
                    if let Some(p) = precise_nasal {
                        for k in s.iter_mut().filter(|k| **k == fuzzy_nasal) {
                            *k = p;
                        }
                    }
                };
                let mut a = seq.clone();
                swap_initial(&mut a);
                let mut b = seq.clone();
                swap_nasal(&mut b);
                let mut c = seq.clone();
                swap_initial(&mut c);
                swap_nasal(&mut c);
                for v in [a, b, c] {
                    if !out.contains(&v) {
                        out.push(v);
                    }
                }
            }
            spellings.insert(syllable, out);
        }

        let mut by_seq: HashMap<Vec<char>, Vec<&'static str>> = HashMap::new();
        let mut members: HashMap<Vec<char>, Vec<&'static str>> = HashMap::new();
        for &syllable in table.syllables() {
            for seq in &spellings[syllable] {
                let list = by_seq.entry(seq.clone()).or_default();
                if !list.contains(&syllable) {
                    list.push(syllable);
                }
                for len in 1..seq.len() {
                    let list = members.entry(seq[..len].to_vec()).or_default();
                    if !list.contains(&syllable) {
                        list.push(syllable);
                    }
                }
            }
        }
        let all = table.syllables();
        let prefixes = members
            .into_iter()
            .map(|(seq, syllables)| {
                // One group per initial: the dictionary's abbreviation index is
                // keyed by initial, so `z` and `zh` must be separate edges.
                let mut groups: Vec<(&str, Vec<&str>)> = Vec::new();
                for &s in &syllables {
                    let initial = table.initial_of(s);
                    match groups.iter_mut().find(|(i, _)| *i == initial) {
                        Some((_, list)) => list.push(s),
                        None => groups.push((initial, vec![s])),
                    }
                }
                // What these keys may still become includes what they already
                // spell: `z` is the start of `zong` and all of `zi`.
                let mut allowed = syllables.clone();
                allowed.extend(by_seq.get(&seq).into_iter().flatten().copied());
                let mut texts: Vec<String> = Vec::new();
                for (_, group) in groups {
                    cover(&group, &allowed, all, &mut texts);
                }
                texts.retain(|t| !t.is_empty());
                texts.sort();
                texts.dedup();
                (seq, texts)
            })
            .collect();
        GridIndex {
            by_seq,
            prefixes,
            spellings,
            zhuyin_spellings,
        }
    }

    /// The syllables a whole key sequence spells.
    pub fn syllables_of(&self, seq: &[char]) -> &[&'static str] {
        self.by_seq.get(seq).map(Vec::as_slice).unwrap_or(&[])
    }

    /// The pinyin prefixes an unfinished key sequence stands for.
    pub fn prefix_texts(&self, seq: &[char]) -> &[String] {
        self.prefixes.get(seq).map(Vec::as_slice).unwrap_or(&[])
    }

    /// The key sequences that spell `syllable`, primary first.
    /// The ordinary spelling of `syllable` under a typing habit: what a plain
    /// tap on each key types, no long press.
    pub fn spelling_for(&self, syllable: &str, habit: SpellingHabit) -> Option<&[char]> {
        match habit {
            SpellingHabit::Pinyin => self.spellings.get(syllable).and_then(|s| s.first()).map(Vec::as_slice),
            SpellingHabit::Zhuyin => self.zhuyin_spellings.get(syllable).map(Vec::as_slice),
        }
    }

    pub fn spellings_of(&self, syllable: &str) -> &[Vec<char>] {
        self.spellings.get(syllable).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Every spelling that more than one syllable shares.
    pub fn shared_spellings(&self) -> impl Iterator<Item = (&Vec<char>, &Vec<&'static str>)> {
        self.by_seq.iter().filter(|(_, v)| v.len() > 1)
    }
}

fn common_prefix_len(a: &str, b: &str) -> usize {
    a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count()
}

/// Pinyin prefixes that between them reach every syllable in `group` and no
/// syllable outside `allowed`. An unfinished edge is looked up by prefix, so
/// its text must not reach what the keys exclude: the precise dental `z_` may
/// not become the prefix `z`, which is also the start of every `zh…`. The
/// common prefix is used when it is safe, and otherwise the group is split by
/// its next letter until it is. A syllable that is itself the only safe
/// prefix left is used as it is.
fn cover(group: &[&str], allowed: &[&str], all: &[&'static str], out: &mut Vec<String>) {
    let Some(first) = group.first() else { return };
    let mut lcp = first.len();
    for s in &group[1..] {
        lcp = lcp.min(common_prefix_len(first, s));
    }
    let prefix = &first[..lcp];
    let leaks = all.iter().any(|s| s.starts_with(prefix) && !allowed.contains(s));
    if !leaks {
        out.push(prefix.to_string());
        return;
    }
    let mut rest: Vec<&str> = Vec::new();
    for s in group {
        if s.len() == lcp {
            // Nothing longer is left to split on: the syllable itself.
            out.push(s.to_string());
        } else {
            rest.push(s);
        }
    }
    let mut by_next: Vec<(u8, Vec<&str>)> = Vec::new();
    for s in rest {
        let next = s.as_bytes()[lcp];
        match by_next.iter_mut().find(|(b, _)| *b == next) {
            Some((_, list)) => list.push(s),
            None => by_next.push((next, vec![s])),
        }
    }
    for (_, sub) in by_next {
        cover(&sub, allowed, all, out);
    }
}

pub struct GridScheme {
    index: &'static GridIndex,
}

impl GridScheme {
    pub fn new(table: &SyllableTable) -> Self {
        Self {
            index: GridIndex::get(table),
        }
    }
}

fn is_tone(t: Option<&GridToken>) -> bool {
    t.is_some_and(|t| t.role == GridRole::Tone)
}

impl SchemeParser for GridScheme {
    /// Every layout key, tone keys included. Digits, space and the
    /// apostrophe are not keys here: digits pick a candidate and space
    /// commits one.
    fn accepts_key(&self, ch: char) -> bool {
        grid_token(ch).is_some()
    }

    fn build_dag(&self, keys: &str) -> SyllableDag {
        let toks: Vec<Option<&GridToken>> = keys.chars().map(grid_token).collect();
        let n = toks.len();
        let mut dag: SyllableDag = vec![Vec::new(); n];
        for start in 0..n {
            let Some(first) = toks[start] else { continue };
            if first.role == GridRole::Tone {
                continue;
            }
            let mut seq: Vec<char> = Vec::with_capacity(MAX_GRID_TOKENS);
            for i in start..(start + MAX_GRID_TOKENS).min(n) {
                let Some(t) = toks[i] else { break };
                if t.role == GridRole::Tone {
                    break;
                }
                seq.push(t.key);
                let end = i + 1;
                let tone_next = end < n && is_tone(toks[end]);
                let edges = &mut dag[start];
                for &syllable in self.index.syllables_of(&seq) {
                    // A tone right after the syllable belongs to it.
                    let end = if tone_next { end + 1 } else { end };
                    edges.push(SyllableEdge {
                        end,
                        text: syllable.to_string(),
                        complete: true,
                    });
                }
                // Unfinished: at the tail of the input, or a lone initial
                // anywhere (the 简拼 case). Nothing continues from an
                // unfinished syllable that a tone closed.
                let abbreviation = seq.len() == 1 && first.role == GridRole::Initial;
                if !tone_next && (end == n || abbreviation) {
                    for text in self.index.prefix_texts(&seq) {
                        let edge = SyllableEdge {
                            end,
                            text: text.clone(),
                            complete: false,
                        };
                        if !edges.contains(&edge) {
                            edges.push(edge);
                        }
                    }
                }
            }
        }
        dag
    }

    fn segment(&self, keys: &str) -> Segmentation {
        segment_dag(&self.build_dag(keys))
    }

    /// Key labels of each edge, tone marks included.
    fn preedit(&self, keys: &str, seg: &Segmentation) -> Vec<PreeditSegment> {
        let chars: Vec<char> = keys.chars().collect();
        let labels = |from: usize, to: usize| -> String {
            chars[from..to.min(chars.len())]
                .iter()
                .map(|&k| grid_label(k))
                .collect()
        };
        if seg.is_empty() {
            if chars.is_empty() {
                return Vec::new();
            }
            return raw_preedit(&labels(0, chars.len()));
        }
        let mut out = Vec::with_capacity(seg.edges.len() * 2);
        for (i, (edge, &start)) in seg.edges.iter().zip(&seg.starts).enumerate() {
            if i > 0 {
                out.push(PreeditSegment {
                    text: " ".into(),
                    kind: PreeditKind::Separator,
                });
            }
            let kind = if edge.complete {
                PreeditKind::Syllable
            } else {
                PreeditKind::Partial
            };
            out.push(PreeditSegment {
                text: labels(start, edge.end),
                kind,
            });
        }
        out
    }
}

/// Keys for a name-based spelling, for tests and tools: `"n y t3 h ao t3"`.
pub fn grid_keys(names: &str) -> String {
    tokens_of(names).into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(names: &str) -> String {
        grid_keys(names)
    }

    fn edges_at(dag: &SyllableDag, at: usize) -> Vec<(String, usize, bool)> {
        dag[at].iter().map(|e| (e.text.clone(), e.end, e.complete)).collect()
    }

    fn e(text: &str, end: usize, complete: bool) -> (String, usize, bool) {
        (text.to_string(), end, complete)
    }

    /// Bopomofo with the layout's merges applied: retroflex → dental, ㄤ → ㄢ,
    /// ㄥ → ㄣ. Two syllables may share a spelling only if they fold equal.
    fn folded(table: &SyllableTable, syllable: &str) -> String {
        table
            .zhuyin_of(syllable)
            .unwrap()
            .chars()
            .map(|c| match c {
                'ㄓ' => 'ㄗ',
                'ㄔ' => 'ㄘ',
                'ㄕ' => 'ㄙ',
                'ㄤ' => 'ㄢ',
                'ㄥ' => 'ㄣ',
                other => other,
            })
            .collect()
    }

    #[test]
    fn tokens_are_unique_and_named() {
        let mut keys = std::collections::HashSet::new();
        let mut names = std::collections::HashSet::new();
        for t in GRID_TOKENS {
            assert!(keys.insert(t.key), "{} is used twice", t.key);
            assert!(names.insert(t.name), "{} is named twice", t.name);
            assert!(!('\u{E000}'..='\u{F8FF}').contains(&t.label.chars().next().unwrap()));
        }
        assert_eq!(
            GRID_TOKENS.len(),
            18 + 3 + 8 + 1 + 5 + 8,
            "the layout's keys and the eight precise ones"
        );
        for t in GRID_TOKENS {
            for v in t.variants {
                assert!(
                    grid_token_by_name(v).is_some(),
                    "{} offers {v}, which is no key",
                    t.name
                );
            }
        }
        let ng = grid_token_by_name("ng").unwrap();
        assert_eq!(ng.variants, &["er", "-n", "-ng"]);
        assert_eq!(grid_token_by_name("ng").unwrap().key, '\u{E005}');
        assert_eq!(grid_label('\u{E001}'), "ao");
        assert_eq!(grid_label('!'), "!");
    }

    #[test]
    fn every_syllable_has_a_spelling() {
        let t = SyllableTable::new();
        let idx = GridIndex::get(&t);
        for &s in t.syllables() {
            let sp = idx.spellings_of(s);
            assert!(!sp.is_empty(), "{s} has no grid spelling");
            for seq in sp {
                assert!(
                    idx.syllables_of(seq).contains(&s),
                    "{s} is not found by its own spelling"
                );
            }
        }
        let keys = |names: &str| -> Vec<char> { k(names).chars().collect() };
        assert_eq!(
            idx.spellings_of("zhuang")[0],
            keys("z w a ng"),
            "a plain tap's spelling first"
        );
        assert_eq!(
            idx.spellings_of("ni"),
            &[keys("n y")],
            "nothing shared, nothing precise"
        );
        assert_eq!(
            idx.spellings_of("zhi")[0],
            keys("z"),
            "an empty rime is the initial alone"
        );
        assert!(idx.spellings_of("zhi").contains(&keys("zh")));
    }

    /// The layout merges exactly what it says it merges. A table edit that
    /// puts, say, `an` and `en` on one spelling fails here.
    #[test]
    fn shared_spellings_are_only_the_designed_merges() {
        let t = SyllableTable::new();
        let idx = GridIndex::get(&t);
        let mut shared = 0;
        for (seq, members) in idx.shared_spellings() {
            shared += 1;
            let first = folded(&t, members[0]);
            for m in &members[1..] {
                assert_eq!(folded(&t, m), first, "{:?} merges {} and {m}", seq, members[0]);
            }
        }
        assert!(shared > 50, "the fuzzy classes exist ({shared})");
        let zwng: Vec<char> = k("z w ng").chars().collect();
        let mut class: Vec<&str> = idx.syllables_of(&zwng).to_vec();
        class.sort();
        assert_eq!(class, vec!["zhong", "zhun", "zong", "zun"]);
    }

    #[test]
    fn alternatives_add_and_never_remove() {
        let t = SyllableTable::new();
        let idx = GridIndex::get(&t);
        let dong: Vec<char> = k("d o ng").chars().collect();
        assert_eq!(idx.syllables_of(&dong), &["dong"], "o ng reads only ong");
        let dwng: Vec<char> = k("d w ng").chars().collect();
        assert!(idx.syllables_of(&dwng).contains(&"dong") && idx.syllables_of(&dwng).contains(&"dun"));
        // weng has no initial; `o ng` would read as the syllable `o`.
        assert!(!idx.spellings_of("weng").contains(&k("o ng").chars().collect()));
        assert!(
            idx.spellings_of("yong").contains(&k("y o ng").chars().collect()),
            "y o ng starts on a medial, so it is kept"
        );
    }

    /// A long press picks one of what a shared key covers, and only that.
    #[test]
    fn precise_keys_read_exactly_one_syllable() {
        let t = SyllableTable::new();
        let idx = GridIndex::get(&t);
        let one = |names: &str| -> Vec<&str> { idx.syllables_of(&k(names).chars().collect::<Vec<_>>()).to_vec() };
        assert_eq!(one("z_ w -ng"), vec!["zong"]);
        assert_eq!(one("zh w -ng"), vec!["zhong"]);
        assert_eq!(one("zh w -n"), vec!["zhun"]);
        assert_eq!(one("z_ w -n"), vec!["zun"]);
        // The fuzzy initial with a precise tail is half precise.
        let mut half = one("z w -ng");
        half.sort();
        assert_eq!(half, vec!["zhong", "zong"]);
        // The single nasal key also merged dun/dong and jun/jiong; the precise
        // tails pull those apart too.
        assert_eq!(one("d w -n"), vec!["dun"]);
        assert_eq!(one("d w -ng"), vec!["dong"]);
        assert_eq!(one("j v -n"), vec!["jun"]);
        assert_eq!(one("e -n"), vec!["en"]);
        assert_eq!(one("sh"), vec!["shi"]);
        assert_eq!(one("s_"), vec!["si"]);
        // A precise key never reads a syllable its fuzzy key would not.
        assert!(one("b -n").is_empty() && one("zh a").contains(&"zha") && !one("zh a").contains(&"za"));
    }

    #[test]
    fn a_lone_precise_initial_abbreviates_one_initial() {
        let t = SyllableTable::new();
        let p = GridScheme::new(&t);
        let dag = p.build_dag(&k("zh g"));
        let at0 = edges_at(&dag, 0);
        assert!(at0.contains(&e("zh", 1, false)));
        assert!(!at0.contains(&e("z", 1, false)), "the dental reading is gone");
    }

    #[test]
    fn fuzzy_edges_share_start_and_end() {
        let t = SyllableTable::new();
        let p = GridScheme::new(&t);
        let dag = p.build_dag(&k("z w ng"));
        let at0 = edges_at(&dag, 0);
        for s in ["zhong", "zong", "zun", "zhun"] {
            assert!(at0.contains(&e(s, 3, true)), "{s} missing from {at0:?}");
        }
        // A lone initial is both dental and retroflex.
        assert!(at0.contains(&e("z", 1, false)) && at0.contains(&e("zh", 1, false)));
        // `z w` at the tail: unfinished zhu…/zhong and zu…/zong — never the
        // bare `zh` or `z`, which would also reach zha, zhe, za and ze.
        let dag = p.build_dag(&k("z w"));
        let at0 = edges_at(&dag, 0);
        for s in ["zhu", "zhong", "zu", "zong"] {
            assert!(at0.contains(&e(s, 2, false)), "{s} missing from {at0:?}");
        }
        assert!(!at0.contains(&e("zh", 2, false)) && !at0.contains(&e("z", 2, false)));
        assert!(at0.contains(&e("zhu", 2, true)) && at0.contains(&e("zu", 2, true)));
    }

    #[test]
    fn tones_are_absorbed_and_optional() {
        let t = SyllableTable::new();
        let p = GridScheme::new(&t);
        let keys = k("n y t3 h ao t3");
        let dag = p.build_dag(&keys);
        assert!(edges_at(&dag, 0).contains(&e("ni", 3, true)));
        assert!(dag[2].is_empty(), "a tone starts nothing");
        assert!(edges_at(&dag, 3).contains(&e("hao", 6, true)));
        let seg = p.segment(&keys);
        let texts: Vec<&str> = seg.edges.iter().map(|e| e.text.as_str()).collect();
        assert_eq!(texts, vec!["ni", "hao"]);
        let toneless = p.segment(&k("n y h ao"));
        let texts: Vec<&str> = toneless.edges.iter().map(|e| e.text.as_str()).collect();
        assert_eq!(texts, vec!["ni", "hao"]);
        // A tone after an unfinished syllable leaves the end unreachable.
        assert!(p.segment(&k("n t3")).is_empty());
        assert!(p.build_dag(&k("t3 n y"))[0].is_empty(), "a tone first has no edges");
    }

    #[test]
    fn n_is_not_ng() {
        let t = SyllableTable::new();
        let idx = GridIndex::get(&t);
        let n: Vec<char> = k("n").chars().collect();
        assert!(idx.syllables_of(&n).is_empty(), "n alone is no syllable");
        let eng: Vec<char> = k("e ng").chars().collect();
        let mut class = idx.syllables_of(&eng).to_vec();
        class.sort();
        assert_eq!(class, vec!["en", "eng"]);
    }

    #[test]
    fn preedit_shows_labels_not_private_use() {
        let t = SyllableTable::new();
        let p = GridScheme::new(&t);
        for keys in [k("n y t3 h ao t3"), k("z w ng g w o"), k("n t3"), k("ng ng ai")] {
            let seg = p.segment(&keys);
            let text: String = p.preedit(&keys, &seg).into_iter().map(|s| s.text).collect();
            assert!(
                !text.chars().any(|c| ('\u{E000}'..='\u{F8FF}').contains(&c)),
                "{text:?} shows a private-use key"
            );
        }
        let keys = k("n y t3 h ao t3");
        let text: String = p
            .preedit(&keys, &p.segment(&keys))
            .into_iter()
            .map(|s| s.text)
            .collect();
        assert_eq!(text, "nyˇ haoˇ");
    }

    #[test]
    fn keys_outside_the_layout() {
        let t = SyllableTable::new();
        let p = GridScheme::new(&t);
        assert!(p.accepts_key('\u{E005}') && p.accepts_key('ˇ') && p.accepts_key('b'));
        for ch in ['1', ' ', '\'', 'i', 'u', ','] {
            assert!(!p.accepts_key(ch), "{ch:?} is not a grid key");
        }
        assert!(p.segment("").is_empty());
    }

    #[test]
    fn table_hash_is_stable_and_covers_both_tables() {
        let h = grid_table_sha256();
        assert_eq!(h.len(), 64);
        assert_eq!(h, grid_table_sha256());
    }
}
