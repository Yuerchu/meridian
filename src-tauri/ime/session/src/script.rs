//! Key scripts: a compact way to write a key sequence for tests and the CLI.
//!
//! Plain characters are printable keys (`nihao`, `,`, `3`); angle-bracket
//! tokens are function keys: `<space>`, `<enter>`, `<bs>`, `<esc>`, `<tab>`,
//! `<shift>` (a bare Shift tap), `<up>`, `<down>`, `<left>`, `<right>`,
//! `<home>`, `<end>`, `<pgup>`, `<pgdn>`, `<del>`. `<caps>` toggles the Caps
//! Lock state carried by the following keys. A literal `<` is `<lt>`.
//!
//! Grid keys go by their names: `<ai>` `<ao>` `<ei>` `<ou>` `<er>` `<ng>`, and the
//! tone keys `<t1>`…`<t5>` (ˉ ˊ ˇ ˋ ˙). `ny<t3>h<ao><t3>` is 你好 in the grid.

use meridian_ime_engine::grid_token_by_name;
use meridian_ime_proto::KeyEvent;

use crate::keys::*;

/// Parses a script into events. Unknown tokens are an error naming them.
pub fn parse_script(script: &str) -> Result<Vec<KeyEvent>, String> {
    let mut out = Vec::new();
    let mut caps = false;
    let mut chars = script.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '<' {
            let mut ev = printable(c);
            ev.caps_lock = caps;
            out.push(ev);
            continue;
        }
        let mut name = String::new();
        loop {
            match chars.next() {
                Some('>') => break,
                Some(ch) => name.push(ch),
                None => return Err(format!("unterminated <{name}")),
            }
        }
        let ev = match name.as_str() {
            "space" => printable(' '),
            "enter" => function(VK_RETURN),
            "bs" | "backspace" => function(VK_BACK),
            "esc" => function(VK_ESCAPE),
            "tab" => function(VK_TAB),
            "shift" => function(VK_SHIFT),
            "up" => function(VK_UP),
            "down" => function(VK_DOWN),
            "left" => function(VK_LEFT),
            "right" => function(VK_RIGHT),
            "home" => function(VK_HOME),
            "end" => function(VK_END),
            "pgup" => function(VK_PRIOR),
            "pgdn" => function(VK_NEXT),
            "del" => function(VK_DELETE),
            "lt" => printable('<'),
            "caps" => {
                caps = !caps;
                continue;
            }
            // Grid keys by name: `<ai>`, `<ng>`, `<t3>`. The multi-letter keys
            // are private-use characters, which nobody should have to type.
            other => match grid_token_by_name(other) {
                Some(t) => printable(t.key),
                None => return Err(format!("unknown key token <{other}>")),
            },
        };
        let mut ev = ev;
        ev.caps_lock = caps;
        out.push(ev);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tokens_and_printables() {
        let evs = parse_script("ni<space>A,<shift><lt><caps>x").unwrap();
        assert_eq!(evs.len(), 8);
        assert_eq!(evs[0].ch, Some('n'));
        assert_eq!(evs[2].vk, VK_SPACE);
        assert_eq!(evs[2].ch, Some(' '));
        assert!(evs[3].mods.shift);
        assert_eq!(evs[5].vk, VK_SHIFT);
        assert_eq!(evs[5].ch, None);
        assert_eq!(evs[6].ch, Some('<'));
        assert!(evs[7].caps_lock);
        assert!(parse_script("<nope>").is_err());
        assert!(parse_script("<space").is_err());
    }
}
