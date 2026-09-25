//! From toned pinyin to the keys each scheme would type for it.
//!
//! The evaluation set stores what a sentence *says* (`ni3 hao3`), not what
//! somebody typed, so the same sentence can be scored under every scheme and
//! every tone habit. This is the one place that turns one into the other; the
//! training repository derives the same strings and its CI compares the two
//! byte for byte, which is what pins the grid tables on both sides.

use meridian_ime_dict::SyllableTable;
use meridian_ime_dict::normalize_syllable;
use meridian_ime_dict::syllable::zhuyin_key_layout;

use super::InputScheme;
use super::grid::{GridIndex, SpellingHabit, grid_token_by_name};

/// Which syllables get their tone typed. Pinyin never types tones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TonePolicy {
    /// Every syllable whose tone is known.
    All,
    None,
    /// Each known tone with probability one half, from a seed, so a run is
    /// repeatable.
    Random(u64),
}

/// One syllable of toned pinyin: `ni3` → (`ni`, Some(3)). A syllable with no
/// digit has an unknown tone and is never given a tone key. `5` is the
/// neutral tone.
fn split_tone(token: &str) -> Result<(String, Option<u8>), String> {
    let (body, tone) = match token.chars().last() {
        Some(d @ '1'..='5') => (&token[..token.len() - 1], Some(d as u8 - b'0')),
        _ => (token, None),
    };
    let body = normalize_syllable(body);
    if body.is_empty() {
        return Err(format!("empty syllable in {token:?}"));
    }
    Ok((body, tone))
}

fn keep_tone(policy: TonePolicy, rng: &mut u64) -> bool {
    match policy {
        TonePolicy::All => true,
        TonePolicy::None => false,
        TonePolicy::Random(_) => {
            // xorshift64: small, deterministic, and good enough for a coin.
            *rng ^= *rng << 13;
            *rng ^= *rng >> 7;
            *rng ^= *rng << 17;
            *rng & 1 == 1
        }
    }
}

/// The keys `scheme` types for space-separated toned pinyin
/// (`"ni3 hao3"`). Errors name the first token that is not a syllable.
pub fn keys_for(scheme: InputScheme, toned: &str, policy: TonePolicy, table: &SyllableTable) -> Result<String, String> {
    keys_for_habit(scheme, toned, policy, SpellingHabit::Pinyin, table)
}

/// [`keys_for`] with a spelling habit for the grid's rimes; the other schemes
/// have only one way to spell anything and ignore it.
pub fn keys_for_habit(
    scheme: InputScheme,
    toned: &str,
    policy: TonePolicy,
    habit: SpellingHabit,
    table: &SyllableTable,
) -> Result<String, String> {
    let mut rng = match policy {
        TonePolicy::Random(seed) => seed | 1,
        _ => 0,
    };
    let mut out = String::new();
    for (i, token) in toned.split_whitespace().enumerate() {
        let (syllable, tone) = split_tone(token)?;
        if !table.contains(&syllable) {
            return Err(format!("{token:?} is not a syllable"));
        }
        let typed_tone = tone.filter(|_| keep_tone(policy, &mut rng));
        match scheme {
            InputScheme::Pinyin => {
                // xi'an: a syllable starting on a vowel needs the apostrophe
                // or it is read as part of the one before.
                if i > 0 && syllable.starts_with(['a', 'o', 'e']) {
                    out.push('\'');
                }
                out.push_str(&syllable);
            }
            InputScheme::Zhuyin => {
                let zhuyin = table.zhuyin_of(&syllable).expect("checked above");
                for sym in zhuyin.chars() {
                    out.push(key_for_symbol(sym));
                }
                if let Some(t) = typed_tone {
                    out.push(key_for_symbol(zhuyin_tone(t)));
                }
            }
            InputScheme::Grid => {
                let spelling = GridIndex::get(table)
                    .spelling_for(&syllable, habit)
                    .ok_or_else(|| format!("{syllable} has no grid spelling"))?;
                out.extend(spelling.iter());
                if let Some(t) = typed_tone {
                    let name = format!("t{t}");
                    out.push(grid_token_by_name(&name).expect("t1..t5 exist").key);
                }
            }
        }
    }
    Ok(out)
}

fn zhuyin_tone(t: u8) -> char {
    match t {
        1 => ' ',
        2 => 'ˊ',
        3 => 'ˇ',
        4 => 'ˋ',
        _ => '˙',
    }
}

fn key_for_symbol(sym: char) -> char {
    zhuyin_key_layout()
        .iter()
        .find(|(_, s)| *s == sym)
        .map(|(k, _)| *k)
        .unwrap_or_else(|| panic!("{sym} is not on the layout"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheme::grid::grid_keys;

    #[test]
    fn each_scheme_spells_ni_hao() {
        let t = SyllableTable::new();
        assert_eq!(
            keys_for(InputScheme::Pinyin, "ni3 hao3", TonePolicy::All, &t).unwrap(),
            "nihao"
        );
        assert_eq!(
            keys_for(InputScheme::Zhuyin, "ni3 hao3", TonePolicy::All, &t).unwrap(),
            "su3cl3"
        );
        assert_eq!(
            keys_for(InputScheme::Zhuyin, "ni3 hao3", TonePolicy::None, &t).unwrap(),
            "sucl"
        );
        assert_eq!(
            keys_for(InputScheme::Grid, "ni3 hao3", TonePolicy::All, &t).unwrap(),
            grid_keys("n y t3 h ao t3")
        );
        assert_eq!(
            keys_for(InputScheme::Grid, "ni3 hao3", TonePolicy::None, &t).unwrap(),
            grid_keys("n y h ao")
        );
    }

    #[test]
    fn tones_apostrophes_and_unknowns() {
        let t = SyllableTable::new();
        assert_eq!(
            keys_for(InputScheme::Pinyin, "xi1 an1", TonePolicy::All, &t).unwrap(),
            "xi'an"
        );
        // First tone is space in zhuyin and its own key in the grid; neutral is ˙.
        assert_eq!(
            keys_for(InputScheme::Zhuyin, "ma1 ma5", TonePolicy::All, &t).unwrap(),
            "a8 a87"
        );
        assert_eq!(
            keys_for(InputScheme::Grid, "ma1 ma5", TonePolicy::All, &t).unwrap(),
            grid_keys("m a t1 m a t5")
        );
        // No digit: the tone is not known and nothing is typed for it.
        assert_eq!(
            keys_for(InputScheme::Grid, "ma", TonePolicy::All, &t).unwrap(),
            grid_keys("m a")
        );
        assert_eq!(
            keys_for(InputScheme::Grid, "lü4", TonePolicy::All, &t).unwrap(),
            grid_keys("l v t4")
        );
        assert!(keys_for(InputScheme::Grid, "xx3", TonePolicy::All, &t).is_err());
    }

    #[test]
    fn random_tones_are_repeatable_and_mixed() {
        let t = SyllableTable::new();
        let text = "wo3 men5 ming2 tian1 qu4 bei3 jing1 kan4 kan4 ba5";
        let a = keys_for(InputScheme::Grid, text, TonePolicy::Random(7), &t).unwrap();
        assert_eq!(a, keys_for(InputScheme::Grid, text, TonePolicy::Random(7), &t).unwrap());
        let all = keys_for(InputScheme::Grid, text, TonePolicy::All, &t).unwrap();
        let none = keys_for(InputScheme::Grid, text, TonePolicy::None, &t).unwrap();
        assert!(none.chars().count() < a.chars().count() && a.chars().count() < all.chars().count());
    }

    /// Every syllable, typed with a tone, is read back as itself.
    #[test]
    fn every_syllable_round_trips_through_its_scheme() {
        let t = SyllableTable::new();
        for scheme in [InputScheme::Zhuyin, InputScheme::Grid] {
            let parser = scheme.parser(&t);
            for &s in t.syllables() {
                let keys = keys_for(scheme, &format!("{s}4"), TonePolicy::All, &t).unwrap();
                let dag = parser.build_dag(&keys);
                let n = keys.chars().count();
                assert!(
                    dag[0].iter().any(|e| e.complete && e.text == s && e.end == n),
                    "{scheme:?} does not read {s} back from {keys:?}"
                );
            }
        }
    }
}

#[cfg(test)]
mod habit_tests {
    use super::*;
    use crate::scheme::grid::grid_keys;

    #[test]
    fn a_zhuyin_typist_keeps_the_e() {
        let t = SyllableTable::new();
        let z = |toned: &str| {
            keys_for_habit(InputScheme::Grid, toned, TonePolicy::None, SpellingHabit::Zhuyin, &t).unwrap()
        };
        let p = |toned: &str| {
            keys_for_habit(InputScheme::Grid, toned, TonePolicy::None, SpellingHabit::Pinyin, &t).unwrap()
        };
        assert_eq!(z("dun"), grid_keys("d w e ng"));
        assert_eq!(z("dong"), grid_keys("d w e ng"));
        assert_eq!(z("bin"), grid_keys("b y e ng"));
        assert_eq!(z("jun"), grid_keys("j v e ng"));
        assert_eq!(p("dun"), grid_keys("d w ng"));
        // Where the traditions agree, so do the habits.
        assert_eq!(z("hao"), p("hao"));
        assert_eq!(z("ren"), grid_keys("r e ng"));
    }

    /// Every syllable typed the zhuyin way reads back as itself.
    #[test]
    fn every_syllable_round_trips_in_the_zhuyin_habit() {
        let t = SyllableTable::new();
        let parser = InputScheme::Grid.parser(&t);
        for &s in t.syllables() {
            let keys = keys_for_habit(
                InputScheme::Grid,
                &format!("{s}4"),
                TonePolicy::All,
                SpellingHabit::Zhuyin,
                &t,
            )
            .unwrap();
            let n = keys.chars().count();
            assert!(
                parser.build_dag(&keys)[0]
                    .iter()
                    .any(|e| e.complete && e.text == s && e.end == n),
                "{s} is not read back from {keys:?}"
            );
        }
    }
}
