//! Pinyin ↔ zhuyin by rule, and the standard (大千) key layout.
//!
//! The conversion is the textbook one: peel the initial, then spell the final,
//! with the four places pinyin abbreviates or respells what zhuyin writes out —
//! `iu`/`ui`/`un` stand for `iou`/`uei`/`uen`; `y`/`w` are medials written as
//! consonants; `u` after `j`/`q`/`x`/`y` is `ü`; and `zhi`/`chi`/`shi`/`ri`/
//! `zi`/`ci`/`si` have an initial and no final at all. Deriving it keeps the
//! table honest: a syllable that fails to convert is a test failure, not a
//! silently missing row.

/// One bopomofo symbol.
pub type ZhuyinSymbol = char;

/// What position a symbol takes in a syllable. The classes are disjoint, which
/// is what lets a sequence of symbols be cut into syllables without spaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZhuyinRole {
    Initial,
    Medial,
    Final,
    Tone,
}

const INITIAL_PAIRS: [(&str, char); 21] = [
    ("b", 'ㄅ'),
    ("p", 'ㄆ'),
    ("m", 'ㄇ'),
    ("f", 'ㄈ'),
    ("d", 'ㄉ'),
    ("t", 'ㄊ'),
    ("n", 'ㄋ'),
    ("l", 'ㄌ'),
    ("g", 'ㄍ'),
    ("k", 'ㄎ'),
    ("h", 'ㄏ'),
    ("j", 'ㄐ'),
    ("q", 'ㄑ'),
    ("x", 'ㄒ'),
    ("zh", 'ㄓ'),
    ("ch", 'ㄔ'),
    ("sh", 'ㄕ'),
    ("r", 'ㄖ'),
    ("z", 'ㄗ'),
    ("c", 'ㄘ'),
    ("s", 'ㄙ'),
];

/// Finals as written after an initial, longest spelling first so `iang` wins
/// over `ia`. `v` is `ü`.
const FINAL_PAIRS: [(&str, &str); 39] = [
    ("iang", "ㄧㄤ"),
    ("iong", "ㄩㄥ"),
    ("uang", "ㄨㄤ"),
    ("ang", "ㄤ"),
    ("eng", "ㄥ"),
    ("ong", "ㄨㄥ"),
    ("iao", "ㄧㄠ"),
    ("ian", "ㄧㄢ"),
    ("ing", "ㄧㄥ"),
    ("uai", "ㄨㄞ"),
    ("uan", "ㄨㄢ"),
    ("van", "ㄩㄢ"),
    ("ai", "ㄞ"),
    ("ei", "ㄟ"),
    ("ao", "ㄠ"),
    ("ou", "ㄡ"),
    ("an", "ㄢ"),
    ("en", "ㄣ"),
    ("er", "ㄦ"),
    ("ia", "ㄧㄚ"),
    ("ie", "ㄧㄝ"),
    ("iu", "ㄧㄡ"),
    ("in", "ㄧㄣ"),
    ("ua", "ㄨㄚ"),
    ("uo", "ㄨㄛ"),
    ("ui", "ㄨㄟ"),
    ("un", "ㄨㄣ"),
    ("ve", "ㄩㄝ"),
    ("vn", "ㄩㄣ"),
    ("a", "ㄚ"),
    ("o", "ㄛ"),
    ("e", "ㄜ"),
    ("i", "ㄧ"),
    ("u", "ㄨ"),
    ("v", "ㄩ"),
    // Only reachable through the standalone spellings below.
    ("io", "ㄧㄛ"),
    ("ueng", "ㄨㄥ"),
    ("iou", "ㄧㄡ"),
    ("uei", "ㄨㄟ"),
];

/// Converts a canonical toneless pinyin syllable to zhuyin. Panics on a string
/// that is not a syllable — the table test is what guards the inventory.
pub fn pinyin_to_zhuyin(syllable: &str) -> String {
    let (initial, rest) = split_initial(syllable);
    let mut out = String::new();
    if let Some((_, sym)) = INITIAL_PAIRS.iter().find(|(p, _)| *p == initial) {
        out.push(*sym);
    }
    // The seven "empty rime" syllables: the initial alone.
    if matches!(syllable, "zhi" | "chi" | "shi" | "ri" | "zi" | "ci" | "si") {
        return out;
    }
    let final_spelling = standalone_final(initial, rest);
    let final_spelling = umlaut_after_palatal(initial, &final_spelling);
    match FINAL_PAIRS.iter().find(|(p, _)| *p == final_spelling) {
        Some((_, z)) => out.push_str(z),
        None => panic!("no zhuyin final for {syllable} (final spelling {final_spelling})"),
    }
    out
}

fn split_initial(syllable: &str) -> (&str, &str) {
    if syllable.len() >= 2 && matches!(&syllable[..2], "zh" | "ch" | "sh") {
        return (&syllable[..2], &syllable[2..]);
    }
    let first = &syllable[..1];
    if INITIAL_PAIRS.iter().any(|(p, _)| *p == first) {
        return (first, &syllable[1..]);
    }
    ("", syllable)
}

/// Rewrites the `y`/`w` spellings of a syllable with no initial into the final
/// they stand for: `yi` → `i`, `you` → `iou`, `wu` → `u`, `wei` → `uei`,
/// `yu` → `v`, `yue` → `ve`.
fn standalone_final(initial: &str, rest: &str) -> String {
    if !initial.is_empty() {
        return rest.to_string();
    }
    match rest {
        "yi" => "i".into(),
        "wu" => "u".into(),
        "yu" => "v".into(),
        "you" => "iou".into(),
        "wei" => "uei".into(),
        "wen" => "un".into(),
        "weng" => "ueng".into(),
        "yin" => "in".into(),
        "ying" => "ing".into(),
        "yong" => "iong".into(),
        "yue" => "ve".into(),
        "yuan" => "van".into(),
        "yun" => "vn".into(),
        r if r.starts_with('y') => format!("i{}", &r[1..]),
        r if r.starts_with('w') => format!("u{}", &r[1..]),
        r => r.to_string(),
    }
}

/// After `j`/`q`/`x` a written `u` is `ü`.
fn umlaut_after_palatal(initial: &str, final_spelling: &str) -> String {
    if matches!(initial, "j" | "q" | "x") && final_spelling.starts_with('u') {
        format!("v{}", &final_spelling[1..])
    } else {
        final_spelling.to_string()
    }
}

/// The role of a bopomofo symbol, or `None` for anything else.
pub fn zhuyin_role(sym: ZhuyinSymbol) -> Option<ZhuyinRole> {
    match sym {
        'ㄅ' | 'ㄆ' | 'ㄇ' | 'ㄈ' | 'ㄉ' | 'ㄊ' | 'ㄋ' | 'ㄌ' | 'ㄍ' | 'ㄎ' | 'ㄏ' | 'ㄐ' | 'ㄑ' | 'ㄒ' | 'ㄓ'
        | 'ㄔ' | 'ㄕ' | 'ㄖ' | 'ㄗ' | 'ㄘ' | 'ㄙ' => Some(ZhuyinRole::Initial),
        'ㄧ' | 'ㄨ' | 'ㄩ' => Some(ZhuyinRole::Medial),
        'ㄚ' | 'ㄛ' | 'ㄜ' | 'ㄝ' | 'ㄞ' | 'ㄟ' | 'ㄠ' | 'ㄡ' | 'ㄢ' | 'ㄣ' | 'ㄤ' | 'ㄥ' | 'ㄦ' => {
            Some(ZhuyinRole::Final)
        }
        'ˊ' | 'ˇ' | 'ˋ' | '˙' | ' ' => Some(ZhuyinRole::Tone),
        _ => None,
    }
}

/// The standard (大千) layout: the bopomofo symbol a key stands for. Tone keys
/// map to the tone marks, with the first tone on space (`' '`). Keys not in the
/// layout return `None`.
pub fn zhuyin_symbol_for_key(key: char) -> Option<ZhuyinSymbol> {
    zhuyin_key_layout().iter().find(|(k, _)| *k == key).map(|(_, s)| *s)
}

/// The whole layout as `(key, symbol)` pairs, in keyboard order.
pub fn zhuyin_key_layout() -> &'static [(char, ZhuyinSymbol)] {
    &[
        ('1', 'ㄅ'),
        ('2', 'ㄉ'),
        ('3', 'ˇ'),
        ('4', 'ˋ'),
        ('5', 'ㄓ'),
        ('6', 'ˊ'),
        ('7', '˙'),
        ('8', 'ㄚ'),
        ('9', 'ㄞ'),
        ('0', 'ㄢ'),
        ('-', 'ㄦ'),
        ('q', 'ㄆ'),
        ('w', 'ㄊ'),
        ('e', 'ㄍ'),
        ('r', 'ㄐ'),
        ('t', 'ㄔ'),
        ('y', 'ㄗ'),
        ('u', 'ㄧ'),
        ('i', 'ㄛ'),
        ('o', 'ㄟ'),
        ('p', 'ㄣ'),
        ('a', 'ㄇ'),
        ('s', 'ㄋ'),
        ('d', 'ㄎ'),
        ('f', 'ㄑ'),
        ('g', 'ㄕ'),
        ('h', 'ㄘ'),
        ('j', 'ㄨ'),
        ('k', 'ㄜ'),
        ('l', 'ㄠ'),
        (';', 'ㄤ'),
        ('z', 'ㄈ'),
        ('x', 'ㄌ'),
        ('c', 'ㄏ'),
        ('v', 'ㄒ'),
        ('b', 'ㄖ'),
        ('n', 'ㄙ'),
        ('m', 'ㄩ'),
        (',', 'ㄝ'),
        ('.', 'ㄡ'),
        ('/', 'ㄥ'),
        (' ', ' '),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_covers_every_symbol_once() {
        let layout = zhuyin_key_layout();
        let mut seen = std::collections::HashSet::new();
        for (_, sym) in layout {
            assert!(seen.insert(*sym), "{sym} appears twice");
            assert!(zhuyin_role(*sym).is_some(), "{sym} has no role");
        }
        assert_eq!(seen.len(), 21 + 3 + 13 + 5);
        assert_eq!(zhuyin_symbol_for_key('s'), Some('ㄋ'));
        assert_eq!(zhuyin_symbol_for_key('u'), Some('ㄧ'));
        assert_eq!(zhuyin_symbol_for_key('3'), Some('ˇ'));
        assert_eq!(zhuyin_symbol_for_key('!'), None);
    }
}
