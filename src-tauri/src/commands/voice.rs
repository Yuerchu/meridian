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

use tauri::Manager;
use tokio_util::sync::CancellationToken;

use crate::db;
use crate::state::{AppDb, VoiceState};
use crate::voice;

/// Recordings shorter than this are almost certainly accidental taps.
const MIN_DURATION_MS: u64 = 1000;

#[derive(serde::Serialize)]
pub struct VoiceTranscript {
    /// "ok" | "too_short" | "empty"
    pub status: &'static str,
    pub text: String,
    pub duration_ms: u64,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Fetch the cached engine or load it. The engine lock is held across the
/// load, so concurrent callers wait instead of loading twice.
async fn get_or_load_engine(
    state: &VoiceState,
    app_data_dir: PathBuf,
) -> Result<Arc<voice::engine::Engine>, String> {
    let mut slot = state.engine.lock().await;
    if let Some(engine) = slot.as_ref() {
        return Ok(engine.clone());
    }
    let engine = tokio::task::spawn_blocking(move || {
        voice::engine::Engine::load(&voice::model_dir(&app_data_dir))
    })
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
) -> Result<VoiceTranscript, String> {
    if duration_ms < MIN_DURATION_MS {
        return Ok(VoiceTranscript { status: "too_short", text: String::new(), duration_ms });
    }

    let dir = data_dir(app)?;
    let state = app.state::<VoiceState>();
    let engine = get_or_load_engine(&state, dir).await?;

    let pool = app.state::<AppDb>().0.clone();
    let text = tokio::task::spawn_blocking(move || {
        let level = {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let pref = db::ops::preference::get_preference(&mut conn, "voice.filter_level")
                .map_err(|e| e.to_string())?;
            voice::filter::FilterLevel::from_preference(pref.as_deref())
        };
        let raw = engine.transcribe(&samples, sample_rate);
        Ok::<_, String>(voice::filter::clean(&raw, level))
    })
    .await
    .map_err(|e| e.to_string())??;

    if text.is_empty() {
        return Ok(VoiceTranscript { status: "empty", text, duration_ms });
    }
    Ok(VoiceTranscript { status: "ok", text, duration_ms })
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
    let state = app.state::<VoiceState>();
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
        if let Ok(Ok(session)) =
            tokio::task::spawn_blocking(voice::capture::RecordingSession::open).await
        {
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
    let warm = VoiceState { inner: state.inner.clone(), engine: state.engine.clone() };
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
    sample_rate: u32,
    pcm: String,
) -> Result<VoiceTranscript, String> {
    use base64::Engine as _;

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
    let state = app.state::<VoiceState>();
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

    let state = app.state::<VoiceState>();
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
    let engine = VoiceState { inner: state.inner.clone(), engine: state.engine.clone() };
    tokio::spawn(async move {
        let _ = get_or_load_engine(&engine, dir).await;
    });
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn voice_stop_and_transcribe(app: tauri::AppHandle) -> Result<VoiceTranscript, String> {
    let state = app.state::<VoiceState>();
    let session = state
        .inner
        .lock()
        .await
        .session
        .take()
        .ok_or("Not recording")?;

    let duration_ms = session.started_at.elapsed().as_millis() as u64;
    let captured = session.stop().await?;
    transcribe_samples(&app, captured.samples, captured.sample_rate, duration_ms).await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn voice_cancel_recording(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<VoiceState>();
    if let Some(session) = state.inner.lock().await.session.take() {
        session.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_model_status(app: tauri::AppHandle) -> Result<voice::model::ModelStatus, String> {
    let dir = data_dir(&app)?;
    let downloading = app.state::<VoiceState>().inner.lock().await.download.is_some();
    let mut status = tokio::task::spawn_blocking(move || voice::model::status(&dir))
        .await
        .map_err(|e| e.to_string())?;
    status.downloading = downloading;
    Ok(status)
}

#[tauri::command]
pub async fn voice_download_model(app: tauri::AppHandle, url: Option<String>) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let state = app.state::<VoiceState>();
    let mut inner = state.inner.lock().await;
    if inner.download.is_some() {
        return Err("Download already in progress".into());
    }
    let token = CancellationToken::new();
    inner.download = Some(token.clone());
    drop(inner);

    let inner_ref = state.inner.clone();
    let engine_ref = state.engine.clone();
    tokio::spawn(async move {
        voice::download::run(app.clone(), dir, url, token).await;
        // Fresh files on disk: drop any engine built from the old ones.
        *engine_ref.lock().await = None;
        inner_ref.lock().await.download = None;
    });
    Ok(())
}

#[tauri::command]
pub async fn voice_cancel_download(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<VoiceState>();
    if let Some(token) = state.inner.lock().await.download.take() {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_import_model(
    app: tauri::AppHandle,
    archive_path: String,
) -> Result<voice::model::ModelStatus, String> {
    let dir = data_dir(&app)?;
    let state = app.state::<VoiceState>();

    let import_dir = dir.clone();
    tokio::task::spawn_blocking(move || {
        voice::model::import_archive(&import_dir, std::path::Path::new(&archive_path))
    })
    .await
    .map_err(|e| e.to_string())??;

    *state.engine.lock().await = None;
    Ok(voice::model::status(&dir))
}

#[tauri::command]
pub async fn voice_delete_model(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let state = app.state::<VoiceState>();
    if state.inner.lock().await.download.is_some() {
        return Err("Cannot delete while a download is in progress".into());
    }
    tokio::task::spawn_blocking(move || voice::model::delete(&dir))
        .await
        .map_err(|e| e.to_string())??;
    *state.engine.lock().await = None;
    Ok(())
}
