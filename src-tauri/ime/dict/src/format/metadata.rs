//! The `META` section: what a dictionary is, where it came from and under what
//! licence. It travels with the file because a dictionary is data somebody
//! else owns — an imported Rime table carries its own SPDX identifier, and a
//! third-party `.mdict` can say what it is without any code change.

use serde::{Deserialize, Serialize};

/// Written by the importer, read back by `catalog` and the settings page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    /// Display name: the Rime header's `name`, else the source file stem.
    pub name: String,
    /// SPDX identifier, or `UNKNOWN` when the source did not say.
    pub license: String,
    /// Free-form attribution line.
    pub attribution: String,
    /// The root source file as given to the importer.
    pub source: String,
    /// The importer's cache key over every file that went into this dictionary.
    pub cache_key: String,
    /// The Rime header's `version`, if any.
    pub version: String,
    pub entries: u64,
    pub codes: u64,
    /// Sum of all entry frequencies, for cross-dictionary normalisation.
    pub total_frequency: u64,
    /// Seconds since the Unix epoch.
    pub created_unix: u64,
    pub generator: String,
    pub format_version: u16,
    pub importer_version: u16,
    /// SHA-256 of the syllable table the codes were validated against.
    pub syllable_table_sha256: String,
}

impl Metadata {
    pub fn to_toml(&self) -> Result<String, toml::ser::Error> {
        toml::to_string(self)
    }

    pub fn from_toml(s: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_toml() {
        let m = Metadata {
            name: "rime_ice".into(),
            license: "GPL-3.0-only".into(),
            attribution: "".into(),
            source: "C:\\x\\rime_ice.dict.yaml".into(),
            cache_key: "abc".into(),
            version: "2026-01-26".into(),
            entries: 3,
            codes: 2,
            total_frequency: 300,
            created_unix: 1,
            generator: "meridian-ime-dict 0.1.0".into(),
            format_version: 1,
            importer_version: 1,
            syllable_table_sha256: "ff".into(),
        };
        assert_eq!(Metadata::from_toml(&m.to_toml().unwrap()).unwrap(), m);
        assert!(Metadata::from_toml("name = 1").is_err());
    }
}
