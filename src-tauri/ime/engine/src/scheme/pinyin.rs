//! Pinyin: letters become syllables by table lookup, with three kinds of edge.
//!
//! At every key position the DAG carries every table syllable the next
//! letters spell (`complete`), every initial they spell (`incomplete`, the
//! 简拼 case — `n` for 你 sits beside `ni` at the same position with a
//! different end), and, only at the tail of the input, a syllable still being
//! typed (`zho`). An apostrophe is a forced boundary: no edge starts on it and
//! none crosses it, so an edge ending just before one absorbs it and
//! `xi'an` has no `xian`. A trailing letter run that is a whole syllable
//! (`xi`) is *not* also offered as a prefix of `xian`: the prefix scan would
//! put 先 in front of 西 for someone who has finished typing.
//!
//! The DP in [`segment_dag`] is shared with the zhuyin scheme: both produce
//! the same DAG shape, and "fewest edges, then fewest incomplete, then the
//! longer syllable earlier" is a fact about the DAG rather than the script.

use super::{SchemeParser, Segmentation, SyllableDag, SyllableEdge};
use meridian_ime_dict::SyllableTable;
use meridian_ime_dict::syllable::MAX_SYLLABLE_LEN;
use meridian_ime_proto::{PreeditKind, PreeditSegment};

/// The forced-boundary key.
pub const APOSTROPHE: char = '\'';

pub struct PinyinScheme<'t> {
    table: &'t SyllableTable,
}

impl<'t> PinyinScheme<'t> {
    pub fn new(table: &'t SyllableTable) -> Self {
        Self { table }
    }
}

impl SchemeParser for PinyinScheme<'_> {
    fn accepts_key(&self, ch: char) -> bool {
        ch.is_ascii_lowercase() || ch == APOSTROPHE
    }

    fn build_dag(&self, keys: &str) -> SyllableDag {
        let chars: Vec<char> = keys.chars().collect();
        let n = chars.len();
        let mut dag: SyllableDag = vec![Vec::new(); n];
        for start in 0..n {
            if !chars[start].is_ascii_lowercase() {
                continue;
            }
            // The run of letters from here: an edge never reaches past it.
            let mut run = String::new();
            let mut run_end = start;
            while run_end < n && chars[run_end].is_ascii_lowercase() {
                run.push(chars[run_end]);
                run_end += 1;
            }
            let max_len = run.len().min(MAX_SYLLABLE_LEN);
            for len in 1..=max_len {
                let s = &run[..len];
                let end = skip_apostrophes(&chars, start + len);
                if self.table.contains(s) {
                    dag[start].push(SyllableEdge {
                        end,
                        text: s.to_string(),
                        complete: true,
                    });
                }
                if self.table.is_initial(s) {
                    dag[start].push(SyllableEdge {
                        end,
                        text: s.to_string(),
                        complete: false,
                    });
                }
            }
            // The unfinished last syllable: only when the run reaches the end
            // of the input (apostrophes after it are allowed) and is neither
            // a syllable nor an initial, both of which were emitted above.
            let reaches_end = chars[run_end..].iter().all(|&c| c == APOSTROPHE);
            if reaches_end
                && run.len() <= MAX_SYLLABLE_LEN
                && !self.table.contains(&run)
                && !self.table.is_initial(&run)
                && self.table.is_prefix(&run)
            {
                dag[start].push(SyllableEdge {
                    end: n,
                    text: run,
                    complete: false,
                });
            }
        }
        dag
    }

    fn segment(&self, keys: &str) -> Segmentation {
        segment_dag(&self.build_dag(keys))
    }

    fn preedit(&self, keys: &str, seg: &Segmentation) -> Vec<PreeditSegment> {
        if seg.is_empty() {
            return raw_preedit(keys);
        }
        let mut out = Vec::with_capacity(seg.edges.len() * 2);
        for (i, edge) in seg.edges.iter().enumerate() {
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
                text: edge.text.clone(),
                kind,
            });
        }
        out
    }
}

/// Index past any apostrophes at `pos`, so an edge ending before a boundary
/// absorbs it.
fn skip_apostrophes(chars: &[char], mut pos: usize) -> usize {
    while pos < chars.len() && chars[pos] == APOSTROPHE {
        pos += 1;
    }
    pos
}

/// The preedit for keys that do not parse: the raw string, marked partial.
pub(crate) fn raw_preedit(keys: &str) -> Vec<PreeditSegment> {
    if keys.is_empty() {
        return Vec::new();
    }
    vec![PreeditSegment {
        text: keys.to_string(),
        kind: PreeditKind::Partial,
    }]
}

/// The best reading of a DAG, or an empty segmentation when the end of the
/// input is unreachable. Fewest edges first, then fewest incomplete edges,
/// then the longer edge earlier (edge lengths compared left to right).
///
/// A plain DP over positions is sound because the order is compatible with
/// appending: two readings of the same prefix keep their order whatever is
/// appended to both.
pub(crate) fn segment_dag(dag: &SyllableDag) -> Segmentation {
    #[derive(Clone)]
    struct Reading {
        edges: Vec<SyllableEdge>,
        starts: Vec<usize>,
        incomplete: usize,
    }
    fn better(a: &Reading, b: &Reading) -> bool {
        if a.edges.len() != b.edges.len() {
            return a.edges.len() < b.edges.len();
        }
        if a.incomplete != b.incomplete {
            return a.incomplete < b.incomplete;
        }
        for ((ea, sa), (eb, sb)) in a.edges.iter().zip(&a.starts).zip(b.edges.iter().zip(&b.starts)) {
            let (la, lb) = (ea.end - sa, eb.end - sb);
            if la != lb {
                return la > lb;
            }
        }
        false
    }

    let n = dag.len();
    let mut best: Vec<Option<Reading>> = vec![None; n + 1];
    best[0] = Some(Reading {
        edges: Vec::new(),
        starts: Vec::new(),
        incomplete: 0,
    });
    for start in 0..n {
        let Some(reading) = best[start].clone() else { continue };
        for edge in &dag[start] {
            let mut next = reading.clone();
            next.edges.push(edge.clone());
            next.starts.push(start);
            next.incomplete += usize::from(!edge.complete);
            let slot = &mut best[edge.end];
            if slot.as_ref().is_none_or(|cur| better(&next, cur)) {
                *slot = Some(next);
            }
        }
    }
    match best[n].take() {
        Some(r) if n > 0 => Segmentation {
            edges: r.edges,
            starts: r.starts,
        },
        _ => Segmentation::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edges_at(dag: &SyllableDag, at: usize) -> Vec<(String, usize, bool)> {
        dag[at].iter().map(|e| (e.text.clone(), e.end, e.complete)).collect()
    }

    fn reading(table: &SyllableTable, keys: &str) -> Vec<(String, bool)> {
        let p = PinyinScheme::new(table);
        p.segment(keys)
            .edges
            .into_iter()
            .map(|e| (e.text, e.complete))
            .collect()
    }

    fn e(text: &str, end: usize, complete: bool) -> (String, usize, bool) {
        (text.to_string(), end, complete)
    }

    #[test]
    fn greedy_first() {
        let t = SyllableTable::new();
        assert_eq!(reading(&t, "kaifa"), vec![("kai".into(), true), ("fa".into(), true)]);
        assert_eq!(reading(&t, "nihao"), vec![("ni".into(), true), ("hao".into(), true)]);
        assert_eq!(
            reading(&t, "zhongguo"),
            vec![("zhong".into(), true), ("guo".into(), true)]
        );
    }

    #[test]
    fn ambiguity() {
        let t = SyllableTable::new();
        let dag = PinyinScheme::new(&t).build_dag("xian");
        let at0 = edges_at(&dag, 0);
        assert!(at0.contains(&e("xi", 2, true)));
        assert!(at0.contains(&e("xian", 4, true)));
        assert!(at0.contains(&e("x", 1, false)));
        assert!(edges_at(&dag, 2).contains(&e("an", 4, true)));
        // One syllable beats two for display.
        assert_eq!(reading(&t, "xian"), vec![("xian".into(), true)]);
    }

    #[test]
    fn apostrophe() {
        let t = SyllableTable::new();
        let dag = PinyinScheme::new(&t).build_dag("xi'an");
        let at0 = edges_at(&dag, 0);
        assert!(
            at0.contains(&e("xi", 3, true)),
            "the edge absorbs the boundary: {at0:?}"
        );
        assert!(!at0.iter().any(|(s, _, _)| s == "xian"));
        assert!(dag[2].is_empty(), "nothing starts on the apostrophe");
        assert_eq!(reading(&t, "xi'an"), vec![("xi".into(), true), ("an".into(), true)]);
        let p = PinyinScheme::new(&t);
        let seg = p.segment("xi'an");
        assert_eq!(seg.starts, vec![0, 3]);
        assert_eq!(reading(&t, "n'hao"), vec![("n".into(), false), ("hao".into(), true)]);
        assert_eq!(reading(&t, "xi'"), vec![("xi".into(), true)]);
        assert!(reading(&t, "'xi").is_empty(), "a leading boundary parses nothing");
    }

    #[test]
    fn trailing_partial() {
        let t = SyllableTable::new();
        assert_eq!(reading(&t, "nih"), vec![("ni".into(), true), ("h".into(), false)]);
        assert_eq!(reading(&t, "zho"), vec![("zho".into(), false)]);
        assert_eq!(reading(&t, "nizho"), vec![("ni".into(), true), ("zho".into(), false)]);
        let dag = PinyinScheme::new(&t).build_dag("zho");
        assert_eq!(
            edges_at(&dag, 0),
            vec![e("z", 1, false), e("zh", 2, false), e("zho", 3, false)]
        );
        // A whole syllable at the tail is not doubled as a prefix.
        let dag = PinyinScheme::new(&t).build_dag("xi");
        assert_eq!(edges_at(&dag, 0), vec![e("x", 1, false), e("xi", 2, true)]);
        // A prefix that is not at the tail is not an edge.
        let dag = PinyinScheme::new(&t).build_dag("zhoni");
        assert!(!edges_at(&dag, 0).iter().any(|(s, _, _)| s == "zho"));
    }

    #[test]
    fn initials_only() {
        let t = SyllableTable::new();
        assert_eq!(reading(&t, "nh"), vec![("n".into(), false), ("h".into(), false)]);
        assert_eq!(reading(&t, "zhg"), vec![("zh".into(), false), ("g".into(), false)]);
        assert_eq!(reading(&t, "n"), vec![("n".into(), false)]);
    }

    #[test]
    fn mixed() {
        let t = SyllableTable::new();
        assert_eq!(reading(&t, "nhao"), vec![("n".into(), false), ("hao".into(), true)]);
        assert_eq!(
            reading(&t, "nihaom"),
            vec![("ni".into(), true), ("hao".into(), true), ("m".into(), false)]
        );
    }

    #[test]
    fn rejects_invalid() {
        let t = SyllableTable::new();
        let p = PinyinScheme::new(&t);
        assert!(p.build_dag("v")[0].is_empty());
        assert!(p.segment("v").is_empty());
        let dag = p.build_dag("kai1");
        assert!(!dag[0].is_empty());
        assert!(dag[3].is_empty());
        assert!(p.segment("kai1").is_empty(), "the end is unreachable");
        assert!(p.segment("Ni").is_empty(), "uppercase is not a key");
        // `hello` parses as 简拼 `he l lo`; `i` and `u` are neither syllables nor initials.
        assert!(!p.segment("hello").is_empty());
        assert!(p.segment("iu").is_empty());
        assert!(p.segment("").is_empty());
        assert!(p.accepts_key('n') && p.accepts_key('\''));
        assert!(!p.accepts_key('N') && !p.accepts_key('1') && !p.accepts_key(' '));
    }

    #[test]
    fn preedit_shapes() {
        let t = SyllableTable::new();
        let p = PinyinScheme::new(&t);
        let seg = p.segment("nih");
        let pre = p.preedit("nih", &seg);
        let shape: Vec<(&str, PreeditKind)> = pre.iter().map(|s| (s.text.as_str(), s.kind)).collect();
        assert_eq!(
            shape,
            vec![
                ("ni", PreeditKind::Syllable),
                (" ", PreeditKind::Separator),
                ("h", PreeditKind::Partial)
            ]
        );
        let seg = p.segment("kai1");
        let pre = p.preedit("kai1", &seg);
        assert_eq!(
            pre,
            vec![PreeditSegment {
                text: "kai1".into(),
                kind: PreeditKind::Partial
            }]
        );
        assert!(p.preedit("", &p.segment("")).is_empty());
    }
}
