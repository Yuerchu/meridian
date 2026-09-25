//! Meridian 输入法's language model scorer.
//!
//! A [`meridian_ime_engine::SentenceScorer`] that runs a model bundle (see
//! [`bundle`]) on ONNX Runtime, loaded at run time from whatever copy is at
//! hand. Everything here fails soft: no bundle, no runtime, a bundle that
//! does not check out, a model too slow for the machine — each leaves the
//! engine with its dictionary, and each says why in the log.
//!
//! The public model is static and published whole. Nothing the person types
//! changes it; a personal model is a separate bundle (`personal: true`) built
//! from their own exported data and preferred when present.

pub mod backend;
pub mod bundle;
#[cfg(feature = "runtime")]
pub mod ort_backend;
pub mod scorer;
pub mod vocab;

use std::path::PathBuf;
use std::time::Duration;

pub use bundle::{Bundle, BundleError, Manifest};
pub use scorer::{LmScorer, ScorerStats};

/// Which budget from the manifest applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Desktop,
    Mobile,
}

#[derive(Debug, Clone)]
pub struct LmOptions {
    /// The ONNX Runtime library; see [`find_onnxruntime`].
    pub runtime: Option<PathBuf>,
    pub platform: Platform,
    /// Intra-op threads for the model.
    pub threads: usize,
    /// Overrides the manifest's budget (the bench measures with it).
    pub budget: Option<Duration>,
}

/// Environment variable naming the ONNX Runtime library, ahead of every
/// other place it is looked for.
pub const RUNTIME_ENV: &str = "MERIDIAN_ORT_LIB";

#[cfg(windows)]
const RUNTIME_FILE: &str = "onnxruntime.dll";
#[cfg(target_os = "macos")]
const RUNTIME_FILE: &str = "libonnxruntime.dylib";
#[cfg(all(unix, not(target_os = "macos")))]
const RUNTIME_FILE: &str = "libonnxruntime.so";

/// Where the ONNX Runtime library is: `$MERIDIAN_ORT_LIB`, then beside this
/// executable, then one directory up — the Windows host lives in
/// `$INSTDIR\ime\` and sherpa-onnx's copy in `$INSTDIR\`. On Android the
/// library is in the APK and the loader finds it by name.
pub fn find_onnxruntime() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os(RUNTIME_ENV).filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(p));
    }
    if cfg!(target_os = "android") {
        return Some(PathBuf::from("libonnxruntime.so"));
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    [dir.join(RUNTIME_FILE), dir.parent()?.join(RUNTIME_FILE)]
        .into_iter()
        .find(|p| p.exists())
}

#[derive(Debug, thiserror::Error)]
pub enum LmError {
    #[error(transparent)]
    Bundle(#[from] BundleError),
    #[error("no ONNX Runtime library was found (set {RUNTIME_ENV})")]
    NoRuntime,
    #[error("{0}")]
    Load(String),
}

#[cfg(feature = "runtime")]
/// Loads the preferred bundle under `models_dir`. `Ok(None)` when there is
/// none to load, which is the ordinary state before one is downloaded.
pub fn open(
    models_dir: &std::path::Path,
    options: &LmOptions,
    table: &meridian_ime_dict::SyllableTable,
) -> Result<Option<LmScorer>, LmError> {
    let Some(dir) = bundle::choose(models_dir) else {
        return Ok(None);
    };
    open_bundle(&dir, options, table).map(Some)
}

#[cfg(feature = "runtime")]
/// Loads the bundle in `dir`, whatever else is beside it.
pub fn open_bundle(
    dir: &std::path::Path,
    options: &LmOptions,
    table: &meridian_ime_dict::SyllableTable,
) -> Result<LmScorer, LmError> {
    let bundle = Bundle::open(dir, table)?;
    let runtime = options.runtime.clone().ok_or(LmError::NoRuntime)?;
    let vocab = vocab::Vocab::load(&bundle.path(bundle::VOCAB_FILE)).map_err(LmError::Load)?;
    let m = &bundle.manifest;
    let budget = options.budget.unwrap_or(Duration::from_millis(match options.platform {
        Platform::Desktop => m.budget_ms.desktop,
        Platform::Mobile => m.budget_ms.mobile,
    }));
    let model = bundle.path(bundle::MODEL_FILE);
    let threads = options.threads;
    let scorer = LmScorer::spawn(
        move || ort_backend::OrtBackend::load(&runtime, &model, threads),
        vocab,
        m.limits,
        m.scale,
        budget,
    )
    .map_err(LmError::Load)?;
    tracing::info!(id = %m.id, version = %m.version, personal = m.personal, ?budget, "language model loaded");
    Ok(scorer)
}

#[cfg(all(test, feature = "runtime"))]
mod onnx_fixture;

#[cfg(all(test, feature = "runtime"))]
mod tests {
    use super::*;
    use crate::backend::{Backend, Batch, RunCtl};
    use crate::bundle::testutil::write_bundle;
    use crate::vocab::testutil::VOCAB_JSON;
    use meridian_ime_dict::SyllableTable;
    use meridian_ime_engine::{InputScheme, ScoreRequest, SentenceScorer};
    use std::path::Path;

    /// The ONNX Runtime to test against: `$MERIDIAN_ORT_LIB`, else the copy
    /// the desktop build stages for sherpa-onnx. Tests that need it say so
    /// and pass when it is absent — CI on Linux has none.
    fn runtime() -> Option<PathBuf> {
        if let Some(p) = std::env::var_os(RUNTIME_ENV) {
            return Some(PathBuf::from(p));
        }
        let staged = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../resources")
            .join(RUNTIME_FILE);
        staged.exists().then_some(staged)
    }

    #[test]
    fn no_bundle_is_no_scorer() {
        let models = tempfile::tempdir().unwrap();
        let opts = LmOptions {
            runtime: None,
            platform: Platform::Desktop,
            threads: 1,
            budget: None,
        };
        assert!(open(models.path(), &opts, &SyllableTable::new()).unwrap().is_none());
        // A bundle without a runtime to run it is an error the host logs.
        write_bundle(
            &models.path().join("m"),
            &[(bundle::MODEL_FILE, b"x"), (bundle::VOCAB_FILE, VOCAB_JSON.as_bytes())],
            |_| {},
        );
        assert!(matches!(
            open(models.path(), &opts, &SyllableTable::new()),
            Err(LmError::NoRuntime)
        ));
    }

    #[test]
    fn the_runtime_runs_the_contract_graph() {
        let Some(lib) = runtime() else {
            eprintln!("skipped: no ONNX Runtime (set {RUNTIME_ENV})");
            return;
        };
        let mut backend = ort_backend::OrtBackend::load_bytes(&lib, &onnx_fixture::constant_model()).unwrap();
        let batch = Batch::new(&[5, 2, 6], &[vec![10, 11], vec![12]], 0);
        let logp = backend.run(&batch, &RunCtl::default()).unwrap();
        // The fixture's logp is -id / 100, padding included.
        assert_eq!(logp, vec![-0.10, -0.11, -0.12, 0.0]);
    }

    #[test]
    fn a_bundle_scores_through_the_engine_hook() {
        let Some(lib) = runtime() else {
            eprintln!("skipped: no ONNX Runtime (set {RUNTIME_ENV})");
            return;
        };
        let models = tempfile::tempdir().unwrap();
        let model = onnx_fixture::constant_model();
        write_bundle(
            &models.path().join("m"),
            &[
                (bundle::MODEL_FILE, &model),
                (bundle::VOCAB_FILE, VOCAB_JSON.as_bytes()),
            ],
            |m| m["budget_ms"]["desktop"] = 5000.into(),
        );
        let opts = LmOptions {
            runtime: Some(lib),
            platform: Platform::Desktop,
            threads: 1,
            budget: None,
        };
        let scorer = open(models.path(), &opts, &SyllableTable::new()).unwrap().unwrap();
        let texts = ["你好", "泥"];
        let scores = scorer.score(&ScoreRequest {
            scheme: InputScheme::Pinyin,
            keys: "ni",
            left: "",
            right: "",
            hints: &[],
            texts: &texts,
        });
        // scale 0.5: 你好 = (-0.10 - 0.11) / 2, 泥 = -0.12 / 2.
        assert_eq!(scores.len(), 2);
        assert!(
            (scores[0] + 0.105).abs() < 1e-6 && (scores[1] + 0.06).abs() < 1e-6,
            "{scores:?}"
        );
    }
}
