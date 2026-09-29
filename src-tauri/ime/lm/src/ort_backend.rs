//! The ONNX Runtime backend.
//!
//! The runtime is opened by path once per process (`ort::init_from`) and
//! never linked: the host finds the copy sherpa-onnx already installed beside
//! Meridian, the Android library the one in the APK's `jniLibs`. A process
//! that cannot find one has no scorer, and types with the dictionary alone.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use ort::session::{RunOptions, Session};
use ort::value::Tensor;

use crate::backend::{Backend, Batch, RunCtl};

static RUNTIME: OnceLock<Result<PathBuf, String>> = OnceLock::new();

/// Opens the runtime at `lib`, once. A second call with another path is
/// answered with the first result: one process has one runtime.
pub fn init_runtime(lib: &Path) -> Result<(), String> {
    let result = RUNTIME.get_or_init(|| {
        ort::init_from(lib)
            .map_err(|e| format!("cannot load ONNX Runtime from {}: {e}", lib.display()))?
            .commit();
        Ok(lib.to_path_buf())
    });
    match result {
        Ok(first) if first != lib => {
            tracing::debug!(first = %first.display(), asked = %lib.display(), "ONNX Runtime is already loaded");
            Ok(())
        }
        Ok(_) => Ok(()),
        Err(e) => Err(e.clone()),
    }
}

pub struct OrtBackend {
    session: Session,
}

impl OrtBackend {
    /// Loads `model` on the runtime at `lib`. `threads` bounds the intra-op
    /// pool: the scorer shares the machine with whatever the person is
    /// typing into.
    pub fn load(lib: &Path, model: &Path, threads: usize) -> Result<OrtBackend, String> {
        init_runtime(lib)?;
        let session = Session::builder()
            .map_err(|e| e.to_string())?
            .with_intra_threads(threads.max(1))
            .map_err(|e| e.to_string())?
            .with_inter_threads(1)
            .map_err(|e| e.to_string())?
            .commit_from_file(model)
            .map_err(|e| format!("cannot load {}: {e}", model.display()))?;
        Ok(OrtBackend { session })
    }

    /// Loads a model held in memory, for tests.
    pub fn load_bytes(lib: &Path, model: &[u8]) -> Result<OrtBackend, String> {
        init_runtime(lib)?;
        let session = Session::builder()
            .map_err(|e| e.to_string())?
            .with_intra_threads(1)
            .map_err(|e| e.to_string())?
            .commit_from_memory(model)
            .map_err(|e| format!("cannot load the model: {e}"))?;
        Ok(OrtBackend { session })
    }
}

fn tensor(rows: usize, cols: usize, data: &[i64]) -> Result<Tensor<i64>, String> {
    Tensor::from_array(([rows, cols], data.to_vec())).map_err(|e| e.to_string())
}

impl Backend for OrtBackend {
    fn run(&mut self, batch: &Batch, ctl: &RunCtl) -> Result<Vec<f32>, String> {
        let options = Arc::new(RunOptions::new().map_err(|e| e.to_string())?);
        let stop = options.clone();
        ctl.on_cancel(Box::new(move || {
            let _ = stop.terminate();
        }));
        if ctl.is_cancelled() {
            return Err("cancelled before it started".into());
        }
        let inputs = ort::inputs![
            "ctx_ids" => tensor(batch.rows, batch.ctx_len, &batch.ctx_ids)?,
            "ctx_mask" => tensor(batch.rows, batch.ctx_len, &batch.ctx_mask)?,
            "text_ids" => tensor(batch.rows, batch.text_len, &batch.text_ids)?,
            "text_mask" => tensor(batch.rows, batch.text_len, &batch.text_mask)?,
        ];
        let outputs = self
            .session
            .run_with_options(inputs, &*options)
            .map_err(|e| e.to_string())?;
        let logp = outputs
            .get("logp")
            .ok_or_else(|| "the model has no `logp` output".to_string())?;
        let (shape, data) = logp.try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
        let dims: Vec<i64> = shape.iter().copied().collect();
        if dims != [batch.rows as i64, batch.text_len as i64] {
            return Err(format!(
                "`logp` is {dims:?}, expected [{}, {}]",
                batch.rows, batch.text_len
            ));
        }
        Ok(data.to_vec())
    }
}
