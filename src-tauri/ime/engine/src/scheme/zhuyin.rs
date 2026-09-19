//! Zhuyin: the standard (大千) layout's keys become bopomofo symbols, and runs
//! of symbols become the same pinyin syllables the pinyin scheme produces.
//!
//! A syllable is at most three symbols (initial, medial, final — the roles
//! are disjoint, which is what makes an unspaced run cuttable) plus an
//! optional tone. A tone never starts an edge and never sits inside one, so
//! it is a boundary as firm as pinyin's apostrophe: a syllable followed by a
//! tone key is one edge ending *after* the tone (the tone's value is ignored
//! for the MVP), and an edge that would end on a tone without absorbing it
//! is not emitted at all, because nothing could continue from there.
//!
//! Toneless input parses too (`sucl` is ㄋㄧㄏㄠ, `ni hao`), so a symbol run
//! at the tail that is a proper prefix of some syllable's spelling is also an
//! incomplete edge. Its pinyin text is the longest common prefix of every
//! syllable that spelling could still become: `ㄋ` → `n`, `ㄓ` → `zh`, `ㄧ` →
//! `y`, `ㄩ` → `y` (`yu`, `yue`, `yong`…), `ㄓㄨ` → `zh` (it may still become
//! ㄓㄨㄥ, `zhong`), `ㄋㄧ` → `ni`. A single symbol that
//! is both a syllable and a prefix (`ㄓ` is `zhi` and the start of `zhong`)
//! gets both edges: without a tone typed, the person has not said which.

use super::pinyin::{raw_preedit, segment_dag};
use super::{SchemeParser, Segmentation, SyllableDag, SyllableEdge};
use meridian_ime_dict::SyllableTable;
use meridian_ime_dict::syllable::{ZhuyinRole, ZhuyinSymbol, zhuyin_role, zhuyin_symbol_for_key};
use meridian_ime_proto::{PreeditKind, PreeditSegment};

/// Most symbols in one syllable before its tone.
const MAX_SYMBOLS: usize = 3;

/// The first tone is on the space key; it is spelled by nothing.
const FIRST_TONE: ZhuyinSymbol = ' ';

pub struct ZhuyinScheme<'t> {
    table: &'t SyllableTable,
}

impl<'t> ZhuyinScheme<'t> {
    pub fn new(table: &'t SyllableTable) -> Self {
        Self { table }
    }

    /// The pinyin an unfinished zhuyin spelling stands for: the longest
    /// common prefix of the pinyin of every syllable it may still become.
    fn prefix_text(&self, zhuyin: &str) -> Option<String> {
        let mut lcp: Option<&str> = None;
        for s in self.table.syllables() {
            let z = self.table.zhuyin_of(s).unwrap_or("");
            if !z.starts_with(zhuyin) {
                continue;
            }
            lcp = Some(match lcp {
                None => s,
                Some(l) => common_prefix(l, s),
            });
        }
        lcp.filter(|l| !l.is_empty()).map(str::to_string)
    }
}

fn common_prefix<'a>(a: &'a str, b: &str) -> &'a str {
    let n = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();
    &a[..n]
}

/// The symbol and role each key stands for; `None` for a key outside the
/// layout, which starts nothing and ends nothing.
fn symbols_of(keys: &str) -> Vec<Option<(ZhuyinSymbol, ZhuyinRole)>> {
    keys.chars()
        .map(|k| zhuyin_symbol_for_key(k).and_then(|s| zhuyin_role(s).map(|r| (s, r))))
        .collect()
}

fn is_tone(sym: Option<(ZhuyinSymbol, ZhuyinRole)>) -> bool {
    matches!(sym, Some((_, ZhuyinRole::Tone)))
}

impl SchemeParser for ZhuyinScheme<'_> {
    /// Every layout key, space included: whether space is the first tone or
    /// a commit is the session's decision, made before this is asked.
    fn accepts_key(&self, ch: char) -> bool {
        zhuyin_symbol_for_key(ch).is_some()
    }

    fn build_dag(&self, keys: &str) -> SyllableDag {
        let syms = symbols_of(keys);
        let n = syms.len();
        let mut dag: SyllableDag = vec![Vec::new(); n];
        for start in 0..n {
            let Some((_, role)) = syms[start] else { continue };
            if role == ZhuyinRole::Tone {
                continue;
            }
            let mut spelling = String::new();
            for i in start..(start + MAX_SYMBOLS).min(n) {
                let Some((sym, role)) = syms[i] else { break };
                if role == ZhuyinRole::Tone {
                    break;
                }
                spelling.push(sym);
                let end = i + 1;
                let tone_next = end < n && is_tone(syms[end]);
                if let Some(pinyin) = self.table.pinyin_of_zhuyin(&spelling) {
                    // A tone right after the syllable belongs to it; ending on
                    // the tone instead would be an edge nothing continues from.
                    let end = if tone_next { end + 1 } else { end };
                    dag[start].push(SyllableEdge {
                        end,
                        text: pinyin.to_string(),
                        complete: true,
                    });
                }
                if end == n
                    && self.table.is_zhuyin_prefix(&spelling)
                    && let Some(text) = self.prefix_text(&spelling)
                {
                    dag[start].push(SyllableEdge {
                        end,
                        text,
                        complete: false,
                    });
                }
            }
        }
        dag
    }

    fn segment(&self, keys: &str) -> Segmentation {
        segment_dag(&self.build_dag(keys))
    }

    /// Bopomofo symbols of each edge's keys, tone marks included except the
    /// first tone, which is spelled by nothing.
    fn preedit(&self, keys: &str, seg: &Segmentation) -> Vec<PreeditSegment> {
        let chars: Vec<char> = keys.chars().collect();
        let symbols = |from: usize, to: usize| -> String {
            chars[from..to.min(chars.len())]
                .iter()
                .map(|&k| zhuyin_symbol_for_key(k).unwrap_or(k))
                .filter(|&s| s != FIRST_TONE)
                .collect()
        };
        if seg.is_empty() {
            if chars.is_empty() {
                return Vec::new();
            }
            let text = symbols(0, chars.len());
            return if text.is_empty() {
                raw_preedit(keys)
            } else {
                raw_preedit(&text)
            };
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
                text: symbols(start, edge.end),
                kind,
            });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edges_at(dag: &SyllableDag, at: usize) -> Vec<(String, usize, bool)> {
        dag[at].iter().map(|e| (e.text.clone(), e.end, e.complete)).collect()
    }

    fn e(text: &str, end: usize, complete: bool) -> (String, usize, bool) {
        (text.to_string(), end, complete)
    }

    fn reading(table: &SyllableTable, keys: &str) -> Vec<(String, bool)> {
        ZhuyinScheme::new(table)
            .segment(keys)
            .edges
            .into_iter()
            .map(|e| (e.text, e.complete))
            .collect()
    }

    #[test]
    fn tones_end_the_syllable() {
        let t = SyllableTable::new();
        let p = ZhuyinScheme::new(&t);
        // ㄋㄧˇㄏㄠˇ
        let dag = p.build_dag("su3cl3");
        assert_eq!(edges_at(&dag, 0), vec![e("ni", 3, true)]);
        assert!(dag[2].is_empty(), "a tone starts nothing");
        assert_eq!(edges_at(&dag, 3), vec![e("hao", 6, true)]);
        assert_eq!(reading(&t, "su3cl3"), vec![("ni".into(), true), ("hao".into(), true)]);
        // First tone on space.
        assert_eq!(reading(&t, "su cl "), vec![("ni".into(), true), ("hao".into(), true)]);
    }

    #[test]
    fn toneless_still_parses() {
        let t = SyllableTable::new();
        assert_eq!(reading(&t, "sucl"), vec![("ni".into(), true), ("hao".into(), true)]);
        // ㄓㄨㄥㄍㄨㄛ
        assert_eq!(
            reading(&t, "5j/eji"),
            vec![("zhong".into(), true), ("guo".into(), true)]
        );
    }

    #[test]
    fn trailing_prefix_is_incomplete() {
        let t = SyllableTable::new();
        assert_eq!(reading(&t, "su3c"), vec![("ni".into(), true), ("h".into(), false)]);
        let p = ZhuyinScheme::new(&t);
        let dag = p.build_dag("5");
        assert_eq!(edges_at(&dag, 0), vec![e("zhi", 1, true), e("zh", 1, false)]);
        let dag = p.build_dag("u");
        assert_eq!(edges_at(&dag, 0), vec![e("yi", 1, true), e("y", 1, false)]);
        let dag = p.build_dag("m");
        assert_eq!(edges_at(&dag, 0), vec![e("yu", 1, true), e("y", 1, false)]);
        let dag = p.build_dag("5j");
        // ㄓㄨ may still become ㄓㄨㄥ (`zhong`), so the prefix is `zh`, not `zhu`.
        assert!(edges_at(&dag, 0).contains(&e("zhu", 2, true)));
        assert!(edges_at(&dag, 0).contains(&e("zh", 2, false)));
        // ㄋㄧ: ni, nie, niao … all keep `ni`.
        assert!(edges_at(&p.build_dag("su"), 0).contains(&e("ni", 2, false)));
        // A prefix that is not at the tail is not an edge, and a tone after
        // an unfinished syllable leaves the end unreachable.
        assert!(p.build_dag("s3")[0].is_empty());
        assert!(p.segment("s3").is_empty());
    }

    #[test]
    fn rejects_what_is_not_a_syllable() {
        let t = SyllableTable::new();
        let p = ZhuyinScheme::new(&t);
        assert!(p.build_dag("3su")[0].is_empty(), "a tone key first has no edges");
        assert!(p.segment("3su").is_empty());
        assert!(p.build_dag("!")[0].is_empty());
        assert!(p.segment("").is_empty());
        assert!(p.accepts_key(' ') && p.accepts_key('3') && p.accepts_key('s'));
        assert!(!p.accepts_key('!'));
    }

    #[test]
    fn preedit_shows_symbols() {
        let t = SyllableTable::new();
        let p = ZhuyinScheme::new(&t);
        let seg = p.segment("su3c");
        let shape: Vec<(String, PreeditKind)> = p.preedit("su3c", &seg).into_iter().map(|s| (s.text, s.kind)).collect();
        assert_eq!(
            shape,
            vec![
                ("ㄋㄧˇ".to_string(), PreeditKind::Syllable),
                (" ".to_string(), PreeditKind::Separator),
                ("ㄏ".to_string(), PreeditKind::Partial)
            ]
        );
        let seg = p.segment("su cl3");
        let text: String = p.preedit("su cl3", &seg).into_iter().map(|s| s.text).collect();
        assert_eq!(text, "ㄋㄧ ㄏㄠˇ", "the first tone is drawn as nothing");
        let seg = p.segment("3su");
        assert_eq!(
            p.preedit("3su", &seg),
            vec![PreeditSegment {
                text: "ˇㄋㄧ".into(),
                kind: PreeditKind::Partial
            }]
        );
    }
}
