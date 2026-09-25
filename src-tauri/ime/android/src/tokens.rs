//! The grid's keys as the keyboard reads them.
//!
//! The layout in Kotlin places keys; what each key *is* — the `char` it
//! sends, what it is labelled, what a long press offers — comes from
//! [`GRID_TOKENS`] through here, so the keyboard cannot send a key the engine
//! does not know or offer a variant it would read differently.

use meridian_ime_engine::{GRID_TOKENS, GridRole};

fn role_name(role: GridRole) -> &'static str {
    match role {
        GridRole::Initial => "initial",
        GridRole::Medial => "medial",
        GridRole::Final => "final",
        GridRole::Nasal => "nasal",
        GridRole::Tone => "tone",
    }
}

/// `[{"key": "", "name": "ng", "label": "ng", "role": "nasal",
/// "variants": ["er", "-n", "-ng"]}, …]`, in table order. `variants` are
/// names of other entries in the same list.
pub fn grid_tokens_json() -> String {
    let tokens: Vec<serde_json::Value> = GRID_TOKENS
        .iter()
        .map(|t| {
            serde_json::json!({
                "key": t.key.to_string(),
                "name": t.name,
                "label": t.label,
                "role": role_name(t.role),
                "variants": t.variants,
            })
        })
        .collect();
    serde_json::Value::Array(tokens).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_names_a_key_in_the_same_list() {
        let v: serde_json::Value = serde_json::from_str(&grid_tokens_json()).unwrap();
        let list = v.as_array().unwrap();
        assert_eq!(list.len(), GRID_TOKENS.len());
        let names: Vec<&str> = list.iter().map(|t| t["name"].as_str().unwrap()).collect();
        for t in list {
            assert_eq!(t["key"].as_str().unwrap().chars().count(), 1, "one key is one char");
            for variant in t["variants"].as_array().unwrap() {
                assert!(names.contains(&variant.as_str().unwrap()), "{variant} is not a key");
            }
        }
        let ng = list.iter().find(|t| t["name"] == "ng").unwrap();
        assert_eq!(ng["key"], "\u{E005}");
        assert_eq!(ng["role"], "nasal");
        assert_eq!(ng["variants"], serde_json::json!(["er", "-n", "-ng"]));
    }
}
