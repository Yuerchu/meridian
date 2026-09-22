//! Chinese punctuation for the keys that carry it.
//!
//! The mapping is the usual one, with the two things a table cannot express
//! kept as state: quotes alternate between opening and closing, and a `.`
//! typed right after a digit stays a decimal point rather than becoming 。.

/// Quote pairing and "was the last thing a digit" memory.
#[derive(Debug, Default, Clone)]
pub struct PunctState {
    double_open: bool,
    single_open: bool,
    last_was_digit: bool,
}

impl PunctState {
    /// Something other than punctuation went through to the document.
    pub fn note_passthrough(&mut self, ch: char) {
        self.last_was_digit = ch.is_ascii_digit();
    }

    /// Chinese text was committed; a following `.` is a full stop.
    pub fn note_commit(&mut self) {
        self.last_was_digit = false;
    }

    /// The full-width replacement for `ch` in Chinese mode, or `None` when the
    /// key goes through unchanged (letters, digits, a decimal point, keys the
    /// table does not cover).
    pub fn map(&mut self, ch: char) -> Option<&'static str> {
        let out = match ch {
            '.' if self.last_was_digit => None,
            '"' => {
                self.double_open = !self.double_open;
                Some(if self.double_open { "\u{201C}" } else { "\u{201D}" })
            }
            '\'' => {
                self.single_open = !self.single_open;
                Some(if self.single_open { "\u{2018}" } else { "\u{2019}" })
            }
            c => full_width_of(c),
        };
        self.last_was_digit = false;
        out
    }
}

/// The stateless part of the table.
pub fn full_width_of(ch: char) -> Option<&'static str> {
    Some(match ch {
        ',' => "，",
        '.' => "。",
        '?' => "？",
        '!' => "！",
        ':' => "：",
        ';' => "；",
        '(' => "（",
        ')' => "）",
        '[' => "【",
        ']' => "】",
        '<' => "《",
        '>' => "》",
        '\\' => "、",
        '^' => "……",
        '_' => "——",
        '$' => "￥",
        '~' => "～",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_alternate_and_decimal_point_survives() {
        let mut p = PunctState::default();
        assert_eq!(p.map('"'), Some("\u{201C}"));
        assert_eq!(p.map('"'), Some("\u{201D}"));
        assert_eq!(p.map('\''), Some("\u{2018}"));
        assert_eq!(p.map(','), Some("，"));
        p.note_passthrough('3');
        assert_eq!(p.map('.'), None, "3. stays a decimal point");
        assert_eq!(p.map('.'), Some("。"), "but only once");
        p.note_passthrough('3');
        p.note_commit();
        assert_eq!(p.map('.'), Some("。"));
        assert_eq!(p.map('a'), None);
    }
}
