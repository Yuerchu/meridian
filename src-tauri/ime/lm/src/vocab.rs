//! Token ids, and the one layout of the model's context.
//!
//! ```text
//! ctx  = <hint> h… <sep> <left> l… <sep> <right> r… <sep> <keys> k…
//! text = t…
//! ```
//!
//! Hints are joined by `<sep>` inside their section. Every section is present
//! even when empty, so the model never sees a shape it was not trained on.
//! Each is cut to the manifest's limit from the side that matters least:
//! the far end of the left context, the far end of the right, the start of
//! the keys. Characters and keys not in the vocabulary are `<unk>`.

use std::collections::HashMap;
use std::path::Path;

use meridian_ime_engine::{InputScheme, ScoreRequest};
use serde::Deserialize;

use crate::bundle::Limits;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct VocabFile {
    specials: HashMap<String, i64>,
    chars: HashMap<String, i64>,
    keys: HashMap<String, HashMap<String, i64>>,
}

#[derive(Debug, Clone)]
pub struct Vocab {
    pad: i64,
    unk: i64,
    sep: i64,
    hint: i64,
    left: i64,
    right: i64,
    keys_marker: i64,
    chars: HashMap<char, i64>,
    keys: HashMap<&'static str, HashMap<char, i64>>,
}

fn scheme_name(s: InputScheme) -> &'static str {
    match s {
        InputScheme::Pinyin => "pinyin",
        InputScheme::Zhuyin => "zhuyin",
        InputScheme::Grid => "grid",
    }
}

fn single_char(s: &str) -> Result<char, String> {
    let mut it = s.chars();
    match (it.next(), it.next()) {
        (Some(c), None) => Ok(c),
        _ => Err(format!("{s:?} is not one character")),
    }
}

impl Vocab {
    pub fn load(path: &Path) -> Result<Vocab, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        Vocab::parse(&text)
    }

    pub fn parse(text: &str) -> Result<Vocab, String> {
        let file: VocabFile = serde_json::from_str(text).map_err(|e| format!("vocab.json: {e}"))?;
        let special = |name: &str| {
            file.specials
                .get(name)
                .copied()
                .ok_or_else(|| format!("vocab.json has no {name}"))
        };
        let mut chars = HashMap::with_capacity(file.chars.len());
        for (s, id) in &file.chars {
            chars.insert(single_char(s)?, *id);
        }
        let mut keys = HashMap::new();
        for scheme in [InputScheme::Pinyin, InputScheme::Zhuyin, InputScheme::Grid] {
            let name = scheme_name(scheme);
            if let Some(table) = file.keys.get(name) {
                let mut m = HashMap::with_capacity(table.len());
                for (s, id) in table {
                    m.insert(single_char(s)?, *id);
                }
                keys.insert(name, m);
            }
        }
        if let Some(other) = file
            .keys
            .keys()
            .find(|k| !["pinyin", "zhuyin", "grid"].contains(&k.as_str()))
        {
            return Err(format!("vocab.json names an unknown scheme {other:?}"));
        }
        Ok(Vocab {
            pad: special("<pad>")?,
            unk: special("<unk>")?,
            sep: special("<sep>")?,
            hint: special("<hint>")?,
            left: special("<left>")?,
            right: special("<right>")?,
            keys_marker: special("<keys>")?,
            chars,
            keys,
        })
    }

    pub fn pad(&self) -> i64 {
        self.pad
    }

    /// `true` when the model was trained on this scheme's keys.
    pub fn knows(&self, scheme: InputScheme) -> bool {
        self.keys.contains_key(scheme_name(scheme))
    }

    fn char_id(&self, c: char) -> i64 {
        self.chars.get(&c).copied().unwrap_or(self.unk)
    }

    /// The context ids for a request.
    pub fn encode_context(&self, req: &ScoreRequest<'_>, limits: &Limits) -> Vec<i64> {
        let mut out = Vec::with_capacity(limits.max_hints + limits.max_left + limits.max_right + limits.max_keys + 8);
        out.push(self.hint);
        let mut hint_ids = Vec::new();
        for (i, h) in req.hints.iter().enumerate() {
            if i > 0 {
                hint_ids.push(self.sep);
            }
            hint_ids.extend(h.chars().map(|c| self.char_id(c)));
        }
        hint_ids.truncate(limits.max_hints);
        out.extend(hint_ids);
        out.push(self.sep);

        out.push(self.left);
        let left: Vec<char> = req.left.chars().collect();
        let from = left.len().saturating_sub(limits.max_left);
        out.extend(left[from..].iter().map(|&c| self.char_id(c)));
        out.push(self.sep);

        out.push(self.right);
        out.extend(req.right.chars().take(limits.max_right).map(|c| self.char_id(c)));
        out.push(self.sep);

        out.push(self.keys_marker);
        let table = self.keys.get(scheme_name(req.scheme));
        let keys: Vec<char> = req.keys.chars().collect();
        let from = keys.len().saturating_sub(limits.max_keys);
        out.extend(
            keys[from..]
                .iter()
                .map(|c| table.and_then(|t| t.get(c)).copied().unwrap_or(self.unk)),
        );
        out
    }

    /// The ids of one candidate, cut to `max_text`.
    pub fn encode_text(&self, text: &str, limits: &Limits) -> Vec<i64> {
        text.chars().take(limits.max_text).map(|c| self.char_id(c)).collect()
    }
}

#[cfg(test)]
pub(crate) mod testutil {
    /// A vocabulary with `<pad>`=0 … `<keys>`=8, a few characters from 10 and
    /// each scheme's keys from 100.
    pub const VOCAB_JSON: &str = r#"{
        "specials": {"<pad>":0,"<unk>":1,"<sep>":2,"<bos>":3,"<eos>":4,"<hint>":5,"<left>":6,"<right>":7,"<keys>":8},
        "chars": {"你":10,"好":11,"泥":12,"我":13,"说":14,"。":15},
        "keys": {
            "pinyin": {"n":100,"i":101,"h":102,"a":103,"o":104},
            "grid": {"n":200,"y":201,"":202,"ˇ":203}
        }
    }"#;
}

#[cfg(test)]
mod tests {
    use super::testutil::VOCAB_JSON;
    use super::*;

    fn limits() -> Limits {
        Limits {
            max_hints: 3,
            max_left: 2,
            max_right: 1,
            max_keys: 3,
            max_text: 2,
        }
    }

    fn req<'a>(
        scheme: InputScheme,
        keys: &'a str,
        left: &'a str,
        right: &'a str,
        hints: &'a [String],
    ) -> ScoreRequest<'a> {
        ScoreRequest {
            scheme,
            keys,
            left,
            right,
            hints,
            texts: &[],
        }
    }

    #[test]
    fn context_has_every_section_in_order() {
        let v = Vocab::parse(VOCAB_JSON).unwrap();
        let ids = v.encode_context(&req(InputScheme::Pinyin, "nihao", "", "", &[]), &limits());
        // <hint> <sep> <left> <sep> <right> <sep> <keys> + the last three keys
        assert_eq!(ids, vec![5, 2, 6, 2, 7, 2, 8, 102, 103, 104]);
    }

    #[test]
    fn each_section_is_cut_from_its_far_side() {
        let v = Vocab::parse(VOCAB_JSON).unwrap();
        let hints = vec!["你好".to_string(), "我".to_string()];
        let ids = v.encode_context(&req(InputScheme::Pinyin, "ni", "我说你", "。好", &hints), &limits());
        assert_eq!(
            ids,
            vec![
                5, 10, 11, 2, 2, // hints: 你 好 <sep>(between) — cut to 3 — then the section's <sep>
                6, 14, 10, 2, // left: the nearest two, 说你
                7, 15, 2, // right: the nearest one, 。
                8, 100, 101, // keys
            ]
        );
    }

    #[test]
    fn unknowns_and_grid_keys() {
        let v = Vocab::parse(VOCAB_JSON).unwrap();
        assert!(v.knows(InputScheme::Grid) && !v.knows(InputScheme::Zhuyin));
        let ids = v.encode_context(&req(InputScheme::Grid, "ny\u{E001}", "猫", "", &[]), &limits());
        assert_eq!(&ids[..4], &[5, 2, 6, 1], "an unknown character is <unk>");
        assert_eq!(&ids[ids.len() - 3..], &[200, 201, 202]);
        // A scheme the model has no keys for reads its keys as <unk>.
        let ids = v.encode_context(&req(InputScheme::Zhuyin, "su", "", "", &[]), &limits());
        assert_eq!(&ids[ids.len() - 2..], &[1, 1]);
        assert_eq!(v.encode_text("你好泥", &limits()), vec![10, 11], "cut to max_text");
    }

    #[test]
    fn a_broken_vocabulary_is_an_error() {
        assert!(Vocab::parse(r#"{"specials":{},"chars":{},"keys":{}}"#).is_err());
        let two_chars = VOCAB_JSON.replace(r#""你":10"#, r#""你好":10"#);
        assert!(Vocab::parse(&two_chars).is_err());
        let other_scheme = VOCAB_JSON.replace(r#""grid":"#, r#""wubi":"#);
        assert!(Vocab::parse(&other_scheme).is_err());
    }
}
