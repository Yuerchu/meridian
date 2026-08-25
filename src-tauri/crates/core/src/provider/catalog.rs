//! The vendor catalog: what a provider looks like, and what to prefill when
//! creating one.
//!
//! This is the display half of a deliberate split. `capabilities.rs` reads
//! `model_catalog.json` to answer *how do I send a request* — by longest-prefix
//! match, where one `gpt-5` catch-all covers every model nobody has listed yet.
//! This file answers *what do I show the user*, where a model id has to be
//! exact because it becomes a row they can click. Merging the two would sooner
//! or later render a catch-all prefix as a model that does not exist.
//!
//! Nothing here decides behaviour. `registry::create_provider`,
//! `capabilities::resolve` and `balance::supports_balance` remain the
//! authorities; [`CatalogEntry::balance`] exists only to keep a "check balance"
//! button off panels where it could never do anything, which is the same reason
//! the frontend's `BALANCE_TYPES` gave for existing. A drift between the two is
//! meant to be visible rather than silent.
//!
//! An entry is a **creation preset**. It is not consulted again once a provider
//! row exists: a relay URL the user typed is theirs to keep, and a catalog
//! update must never turn an existing configuration into an illegal one.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
struct Catalog {
    providers: Vec<CatalogEntry>,
}

/// One vendor.
#[derive(Debug, Deserialize)]
pub struct CatalogEntry {
    /// Stable identity, and what a provider row's `catalog_id` points at.
    ///
    /// Distinct from `provider_type` on purpose: several vendors share one
    /// adapter (they are all OpenAI-compatible) while each keeps its own name,
    /// icon and key-issuing page. That separation is what lets a vendor be
    /// added without adding a match arm.
    pub id: String,
    /// Which family of adapter this vendor is served by. Must be a value
    /// `registry::create_provider` accepts.
    pub provider_type: String,
    pub name: String,
    pub icon: String,
    /// Whether this vendor publishes an account balance at all.
    #[serde(default)]
    pub balance: bool,
    #[serde(default)]
    pub websites: Websites,
    /// The ways of signing in, each carrying the endpoint and dialect that come
    /// with it. See [`AuthOption`].
    pub auth: Vec<AuthOption>,
    /// Preset model list, grouped for display. Empty means "ask the provider",
    /// which is what every vendor with a working `/models` does.
    #[serde(default)]
    pub models: Vec<ModelGroup>,
}

#[derive(Debug, Default, Deserialize)]
pub struct Websites {
    pub official: Option<String>,
    /// Where the user goes to obtain a key — the one link a settings panel
    /// actually needs.
    pub api_key: Option<String>,
    pub docs: Option<String>,
    pub models: Option<String>,
}

/// One way of signing in to a vendor.
///
/// The endpoint and the dialect live **here** rather than on the entry, because
/// they belong to the login method: OpenAI's API and ChatGPT's Codex backend are
/// both `responses`, yet differ in base URL and in what the wire supports. A
/// flat `default_base_url` keyed by format cannot hold both, and the fallback —
/// hardcoding "when Codex is chosen, switch the URL" into the settings panel —
/// is exactly the vendor-specific branching this catalog exists to delete.
#[derive(Debug, Deserialize)]
pub struct AuthOption {
    pub id: String,
    /// Where the credential comes from. Deliberately *not* an input to adapter
    /// selection: two ways of signing in to ChatGPT yield the same token on the
    /// same wire, so they must not produce two adapters.
    pub credential_kind: String,
    /// How requests are shaped and what the model can be asked to do. This is
    /// what picks the adapter, alongside `provider_type` and the format.
    pub transport_profile: String,
    /// Dialects available under this login. A single element means the dialect
    /// is not a choice, which is what a settings panel reads to omit the
    /// selector.
    pub api_formats: Vec<String>,
    /// Prefilled base URL per dialect. Every key must appear in `api_formats`.
    #[serde(default)]
    pub default_base_url: HashMap<String, String>,
}

/// A display grouping of model ids, e.g. everything in the `gpt-5.1` family.
///
/// Written down rather than derived from the id. Splitting ids on punctuation
/// is how `gpt-5` and `gpt-5.1` end up in two groups while `gpt-5-mini` joins
/// the first — an artefact of the separator, not a statement about the models.
#[derive(Debug, Deserialize)]
pub struct ModelGroup {
    pub family: String,
    pub ids: Vec<String>,
}

static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
    // Parsed once at first use. A malformed catalog is an authoring error the
    // checker should have caught, not something to degrade around at runtime —
    // same stance as `model_catalog.json`.
    serde_json::from_str(include_str!("provider_catalog.json")).expect("provider_catalog.json is malformed")
});

/// Every vendor, in the order the file lists them (which is the order a picker
/// shows them in).
pub fn entries() -> &'static [CatalogEntry] {
    &CATALOG.providers
}

/// Look up one vendor by catalog id.
///
/// A miss is ordinary: a provider row may carry a `catalog_id` from a build
/// that knew a vendor this one does not, and a row with no `catalog_id` at all
/// is the common case for anything hand-made.
pub fn find(id: &str) -> Option<&'static CatalogEntry> {
    CATALOG.providers.iter().find(|entry| entry.id == id)
}

impl CatalogEntry {
    /// The login method a fresh row should start from: the first listed. Order
    /// in the file is editorial.
    pub fn default_auth(&self) -> Option<&AuthOption> {
        self.auth.first()
    }

    pub fn auth_option(&self, id: &str) -> Option<&AuthOption> {
        self.auth.iter().find(|option| option.id == id)
    }
}

impl AuthOption {
    /// The dialect a fresh row should start from, or `None` if this login
    /// offers none (which the checker rejects, so it cannot happen in practice).
    pub fn default_api_format(&self) -> Option<&str> {
        self.api_formats.first().map(String::as_str)
    }

    /// Whether the user gets to pick a dialect under this login at all.
    pub fn format_is_a_choice(&self) -> bool {
        self.api_formats.len() > 1
    }

    pub fn base_url_for(&self, api_format: &str) -> Option<&str> {
        self.default_base_url.get(api_format).map(String::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shipped file parses, and every vendor is reachable by its own id.
    #[test]
    fn catalog_parses_and_is_addressable() {
        let all = entries();
        assert!(!all.is_empty(), "catalog is empty");
        for entry in all {
            assert!(find(&entry.id).is_some(), "{} is not findable by its own id", entry.id);
        }
    }

    /// The five vendors the settings panel hardcoded before this file existed.
    /// They are what PR2a-2 will read instead, so losing one is a regression in
    /// the UI rather than in the data.
    #[test]
    fn the_original_five_are_present() {
        for id in ["openai", "anthropic", "deepseek", "xai", "google"] {
            assert!(find(id).is_some(), "{id} missing from catalog");
        }
    }

    /// `balance` mirrors the frontend's old `BALANCE_TYPES`, which listed
    /// DeepSeek alone: Anthropic and xAI publish nothing and OpenAI withdrew the
    /// endpoint. `provider::balance` stays the authority — this only decides
    /// whether a button is drawn.
    #[test]
    fn only_deepseek_advertises_a_balance() {
        for entry in entries() {
            assert_eq!(
                entry.balance,
                entry.id == "deepseek",
                "{} disagrees with supports_balance",
                entry.id
            );
        }
    }

    /// A single dialect means the selector is omitted; this is what
    /// `SINGLE_FORMAT_TYPES` said about Anthropic and `DUAL_FORMAT_TYPES` about
    /// xAI and DeepSeek.
    #[test]
    fn dialect_is_a_choice_only_where_it_used_to_be() {
        let choice = |id: &str| {
            find(id)
                .and_then(CatalogEntry::default_auth)
                .expect("entry with a default login")
                .format_is_a_choice()
        };
        assert!(!choice("anthropic"), "Anthropic's adapter ignores the format");
        assert!(choice("xai"), "xAI speaks both dialects");
        assert!(choice("deepseek"), "DeepSeek speaks both dialects");
    }

    /// Prefills are addressable by the dialect they belong to — the property
    /// PR2a-2 depends on when it fills the base-URL field.
    #[test]
    fn every_declared_dialect_has_a_prefilled_url() {
        for entry in entries() {
            for option in &entry.auth {
                for format in &option.api_formats {
                    assert!(
                        option.base_url_for(format).is_some(),
                        "{}/{} declares {format} without a URL",
                        entry.id,
                        option.id
                    );
                }
            }
        }
    }
}
