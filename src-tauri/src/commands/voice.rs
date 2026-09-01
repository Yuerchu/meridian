//! Voice input commands: recording session lifecycle, transcription, and
//! model management.
//!
//! Model management and transcription are shared. Capture is not: the desktop
//! records here through cpal, while Android records in the WebView and posts
//! the finished samples over, so the four session commands below are
//! desktop-only and Android calls `voice_transcribe_pcm` instead. Both ends
//! meet again at `transcribe_samples`, which is what keeps the duration floor,
//! the filter level and the status vocabulary from drifting apart.

use std::path::PathBuf;
use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use crate::ServicesExt;
use meridian_core::db;
use meridian_core::state::VoiceState;
use meridian_core::voice;

/// Recordings shorter than this are almost certainly accidental taps.
const MIN_DURATION_MS: u64 = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceTranscriptStatus {
    Ok,
    TooShort,
    Empty,
}

#[derive(serde::Serialize)]
pub struct VoiceTranscriptResponse {
    pub status: VoiceTranscriptStatus,
    pub text: String,
    pub duration_ms: u64,
}

#[cfg(any(target_os = "android", test))]
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoicePcmTranscriptionRequest {
    pub sample_rate: u32,
    pub pcm: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceModelDownloadRequest {
    #[serde(deserialize_with = "meridian_core::events::deserialize_required_nullable")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceModelImportRequest {
    pub archive_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct VoiceModelStatusInfoResponse {
    pub installed: bool,
    pub path: Option<String>,
    pub size_bytes: u64,
    pub downloading: bool,
}

impl From<voice::model::ModelStatus> for VoiceModelStatusInfoResponse {
    fn from(status: voice::model::ModelStatus) -> Self {
        Self {
            installed: status.installed,
            path: status.path,
            size_bytes: status.size_bytes,
            downloading: status.downloading,
        }
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let services = app.services();
    Ok(services.paths.data_dir.clone())
}

/// Fetch the cached engine or load it. The engine lock is held across the
/// load, so concurrent callers wait instead of loading twice.
async fn get_or_load_engine(state: &VoiceState, app_data_dir: PathBuf) -> Result<Arc<voice::engine::Engine>, String> {
    let mut slot = state.engine.lock().await;
    if let Some(engine) = slot.as_ref() {
        return Ok(engine.clone());
    }
    let engine = tokio::task::spawn_blocking(move || voice::engine::Engine::load(&voice::model_dir(&app_data_dir)))
        .await
        .map_err(|e| e.to_string())??;
    let engine = Arc::new(engine);
    *slot = Some(engine.clone());
    Ok(engine)
}

/// Run the filter and package the result. The tail both platforms share.
///
/// `duration_ms` is passed in rather than measured: the desktop knows it from
/// the session clock, Android derives it from the sample count, and the sample
/// count is the more honest of the two.
async fn transcribe_samples(
    app: &tauri::AppHandle,
    samples: Vec<f32>,
    sample_rate: u32,
    duration_ms: u64,
) -> Result<VoiceTranscriptResponse, String> {
    if duration_ms < MIN_DURATION_MS {
        return Ok(VoiceTranscriptResponse {
            status: VoiceTranscriptStatus::TooShort,
            text: String::new(),
            duration_ms,
        });
    }

    let dir = data_dir(app)?;
    let services = app.services();
    let engine = get_or_load_engine(&services.voice, dir).await?;

    let pool = services.db.clone();
    let text = tokio::task::spawn_blocking(move || {
        let level = {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let pref =
                db::ops::preference::get_preference(&mut conn, "voice.filter_level").map_err(|e| e.to_string())?;
            voice::filter::FilterLevel::from_preference(pref.as_deref())?
        };
        let raw = engine.transcribe(&samples, sample_rate);
        Ok::<_, String>(voice::filter::clean(&raw, level))
    })
    .await
    .map_err(|e| e.to_string())??;

    if text.is_empty() {
        return Ok(VoiceTranscriptResponse {
            status: VoiceTranscriptStatus::Empty,
            text,
            duration_ms,
        });
    }
    Ok(VoiceTranscriptResponse {
        status: VoiceTranscriptStatus::Ok,
        text,
        duration_ms,
    })
}

/// Warm what the next recording will need, before it is asked for.
///
/// The desktop opens the input device here, because opening one takes long
/// enough that a user who clicks and talks immediately loses their first word,
/// and no amount of UI feedback fixes that — they are looking at the keyboard,
/// not the button. Android has no device to open from this side, so only the
/// model is loaded.
///
/// Failures are silent either way: this is called on approach, not on a request
/// to record, so a missing microphone is only worth reporting once one is
/// actually needed.
#[tauri::command]
pub async fn voice_prewarm(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let services = app.services();
    let state = &services.voice;
    if !voice::model::status(&dir).installed {
        return Ok(());
    }

    #[cfg(not(target_os = "android"))]
    {
        {
            let inner = state.inner.lock().await;
            if inner.session.is_some() {
                return Ok(());
            }
        }
        if let Ok(Ok(session)) = tokio::task::spawn_blocking(voice::capture::RecordingSession::open).await {
            let mut inner = state.inner.lock().await;
            // A real recording may have started while the device was opening.
            if inner.session.is_some() {
                session.cancel();
            } else {
                inner.session = Some(session);
            }
        }
    }

    // Load the model too, so the pause after release is not the first one.
    let warm = VoiceState {
        inner: state.inner.clone(),
        engine: state.engine.clone(),
    };
    tokio::spawn(async move {
        let _ = get_or_load_engine(&warm, dir).await;
    });
    Ok(())
}

/// Transcribe PCM captured outside Rust. Android's entry point.
///
/// The payload is base64 rather than a raw body because Android has no raw IPC:
/// `InvokeBody::Raw` is unsupported there and an `ArrayBuffer` would arrive
/// expanded into a JSON number array, an order of magnitude worse. i16 rather
/// than f32 halves it again, at no cost the recogniser can hear.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn voice_transcribe_pcm(
    app: tauri::AppHandle,
    request: VoicePcmTranscriptionRequest,
) -> Result<VoiceTranscriptResponse, String> {
    use base64::Engine as _;

    let VoicePcmTranscriptionRequest { sample_rate, pcm } = request;

    if !(8_000..=192_000).contains(&sample_rate) {
        return Err(format!("implausible sample rate: {sample_rate}"));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pcm.as_bytes())
        .map_err(|e| format!("payload is not valid base64: {e}"))?;
    if bytes.len() % 2 != 0 {
        return Err("payload is not 16-bit PCM: odd byte count".to_string());
    }

    // Well past the 60s recording cap, so only a bug on the other side can
    // reach it — but decoding is where an unbounded payload would land.
    let max_samples = sample_rate as usize * 90;
    let sample_count = bytes.len() / 2;
    if sample_count > max_samples {
        return Err(format!("recording too long: {sample_count} samples"));
    }

    let samples: Vec<f32> = bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect();
    let duration_ms = (sample_count as u64 * 1000) / sample_rate as u64;

    transcribe_samples(&app, samples, sample_rate, duration_ms).await
}

/// Release a prewarmed device. Only ever drops an idle session — if recording
/// has begun, the pointer leaving the button is not a reason to stop.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn voice_release_prewarm(app: tauri::AppHandle) -> Result<(), String> {
    let services = app.services();
    let state = &services.voice;
    let mut inner = state.inner.lock().await;
    if inner.session.as_ref().is_some_and(|s| s.is_idle())
        && let Some(session) = inner.session.take()
    {
        session.cancel();
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn voice_start_recording(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    if !voice::model::status(&dir).installed {
        return Err("model_not_installed".into());
    }

    let services = app.services();
    let state = &services.voice;
    let mut inner = state.inner.lock().await;
    match inner.session.as_mut() {
        // Prewarmed: the device is already running, so this is instant and the
        // first syllable survives.
        Some(session) if session.is_idle() => session.begin_collecting()?,
        Some(_) => return Err("Already recording".into()),
        None => {
            // No hover happened (touch, or a very fast click). Open now and
            // accept the latency rather than refusing to record.
            let mut session = tokio::task::spawn_blocking(voice::capture::RecordingSession::open)
                .await
                .map_err(|e| e.to_string())??;
            session.begin_collecting()?;
            inner.session = Some(session);
        }
    }
    drop(inner);

    // Warm the model while the user is talking so the stop feels instant.
    // Failures are ignored here; stop reports them properly.
    let engine = VoiceState {
        inner: state.inner.clone(),
        engine: state.engine.clone(),
    };
    tokio::spawn(async move {
        let _ = get_or_load_engine(&engine, dir).await;
    });
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn voice_stop_and_transcribe(app: tauri::AppHandle) -> Result<VoiceTranscriptResponse, String> {
    let services = app.services();
    let state = &services.voice;
    let session = state.inner.lock().await.session.take().ok_or("Not recording")?;

    let duration_ms = session.started_at.elapsed().as_millis() as u64;
    let captured = session.stop().await?;
    transcribe_samples(&app, captured.samples, captured.sample_rate, duration_ms).await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn voice_cancel_recording(app: tauri::AppHandle) -> Result<(), String> {
    let services = app.services();
    let state = &services.voice;
    if let Some(session) = state.inner.lock().await.session.take() {
        session.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_model_status(app: tauri::AppHandle) -> Result<VoiceModelStatusInfoResponse, String> {
    let dir = data_dir(&app)?;
    let services = app.services();
    let downloading = services.voice.inner.lock().await.download.is_some();
    let mut status = tokio::task::spawn_blocking(move || voice::model::status(&dir))
        .await
        .map_err(|e| e.to_string())?;
    status.downloading = downloading;
    Ok(status.into())
}

#[tauri::command]
pub async fn voice_download_model(app: tauri::AppHandle, request: VoiceModelDownloadRequest) -> Result<(), String> {
    let VoiceModelDownloadRequest { url } = request;
    let dir = data_dir(&app)?;
    let services = app.services();
    let state = &services.voice;
    let mut inner = state.inner.lock().await;
    if inner.download.is_some() {
        return Err("Download already in progress".into());
    }
    let token = CancellationToken::new();
    inner.download = Some(token.clone());
    drop(inner);

    let inner_ref = state.inner.clone();
    let engine_ref = state.engine.clone();
    let events = services.events.clone();
    tokio::spawn(async move {
        voice::download::run(events, dir, url, token).await;
        // Fresh files on disk: drop any engine built from the old ones.
        *engine_ref.lock().await = None;
        inner_ref.lock().await.download = None;
    });
    Ok(())
}

#[tauri::command]
pub async fn voice_cancel_download(app: tauri::AppHandle) -> Result<(), String> {
    let services = app.services();
    let state = &services.voice;
    if let Some(token) = state.inner.lock().await.download.take() {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_import_model(
    app: tauri::AppHandle,
    request: VoiceModelImportRequest,
) -> Result<VoiceModelStatusInfoResponse, String> {
    let VoiceModelImportRequest { archive_path } = request;
    let dir = data_dir(&app)?;
    let services = app.services();
    let state = &services.voice;

    let import_dir = dir.clone();
    tokio::task::spawn_blocking(move || voice::model::import_archive(&import_dir, std::path::Path::new(&archive_path)))
        .await
        .map_err(|e| e.to_string())??;

    *state.engine.lock().await = None;
    Ok(voice::model::status(&dir).into())
}

#[tauri::command]
pub async fn voice_delete_model(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let services = app.services();
    let state = &services.voice;
    if state.inner.lock().await.download.is_some() {
        return Err("Cannot delete while a download is in progress".into());
    }
    tokio::task::spawn_blocking(move || voice::model::delete(&dir))
        .await
        .map_err(|e| e.to_string())??;
    *state.engine.lock().await = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        VoiceModelDownloadRequest, VoiceModelImportRequest, VoiceModelStatusInfoResponse, VoicePcmTranscriptionRequest,
        VoiceTranscriptStatus,
    };

    #[test]
    fn transcript_status_uses_closed_snake_case_contract() {
        assert_eq!(serde_json::to_value(VoiceTranscriptStatus::Ok).unwrap(), "ok");
        assert_eq!(
            serde_json::to_value(VoiceTranscriptStatus::TooShort).unwrap(),
            "too_short"
        );
        assert_eq!(serde_json::to_value(VoiceTranscriptStatus::Empty).unwrap(), "empty");
        assert!(serde_json::from_value::<VoiceTranscriptStatus>(serde_json::json!("future_status")).is_err());
    }

    #[test]
    fn voice_requests_are_strict_named_contracts() {
        let download: VoiceModelDownloadRequest = serde_json::from_value(serde_json::json!({ "url": null })).unwrap();
        assert!(download.url.is_none());
        assert!(serde_json::from_value::<VoiceModelDownloadRequest>(serde_json::json!({})).is_err());
        assert!(
            serde_json::from_value::<VoiceModelImportRequest>(serde_json::json!({
                "archivePath": "model.tar.bz2",
                "legacyPath": "model.zip",
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<VoicePcmTranscriptionRequest>(serde_json::json!({
                "sampleRate": 16_000,
                "pcm": "AA==",
                "format": "pcm16",
            }))
            .is_err()
        );

        let pcm: VoicePcmTranscriptionRequest = serde_json::from_value(serde_json::json!({
            "sampleRate": 16_000,
            "pcm": "AA==",
        }))
        .expect("valid PCM request");
        assert_eq!(pcm.sample_rate, 16_000);
        assert_eq!(pcm.pcm, "AA==");
    }

    #[test]
    fn voice_model_status_is_explicitly_mapped() {
        let response = VoiceModelStatusInfoResponse::from(meridian_core::voice::model::ModelStatus {
            installed: true,
            path: Some("models/sense-voice".to_string()),
            size_bytes: 42,
            downloading: false,
        });
        assert_eq!(
            response,
            VoiceModelStatusInfoResponse {
                installed: true,
                path: Some("models/sense-voice".to_string()),
                size_bytes: 42,
                downloading: false,
            }
        );
    }
}
