//! Voice input commands: recording session lifecycle, transcription, and
//! model management. Desktop only; Android will get its own capture path.

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

/// Open the microphone ahead of time, discarding audio until recording starts.
///
/// Called when the pointer reaches the button. Opening a device takes long
/// enough that a user who clicks and talks immediately loses their first word,
/// and no amount of UI feedback fixes that — they are looking at the keyboard,
/// not the button. Failures are silent: hovering is not a request to record, so
/// a missing microphone is only worth reporting once one is actually needed.
#[tauri::command]
pub async fn voice_prewarm(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let state = app.state::<VoiceState>();
    {
        let inner = state.inner.lock().await;
        if inner.session.is_some() {
            return Ok(());
        }
    }
    if !voice::model::status(&dir).installed {
        return Ok(());
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

    // Load the model too, so the pause after release is not the first one.
    let warm = VoiceState { inner: state.inner.clone(), engine: state.engine.clone() };
    tokio::spawn(async move {
        let _ = get_or_load_engine(&warm, dir).await;
    });
    Ok(())
}

/// Release a prewarmed device. Only ever drops an idle session — if recording
/// has begun, the pointer leaving the button is not a reason to stop.
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
    if duration_ms < MIN_DURATION_MS {
        return Ok(VoiceTranscript { status: "too_short", text: String::new(), duration_ms });
    }

    let dir = data_dir(&app)?;
    let engine = get_or_load_engine(&state, dir).await?;

    let pool = app.state::<AppDb>().0.clone();
    let text = tokio::task::spawn_blocking(move || {
        let level = {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let pref = db::ops::preference::get_preference(&mut conn, "voice.filter_level")
                .map_err(|e| e.to_string())?;
            voice::filter::FilterLevel::from_preference(pref.as_deref())
        };
        let raw = engine.transcribe(&captured.samples, captured.sample_rate);
        Ok::<_, String>(voice::filter::clean(&raw, level))
    })
    .await
    .map_err(|e| e.to_string())??;

    if text.is_empty() {
        return Ok(VoiceTranscript { status: "empty", text, duration_ms });
    }
    Ok(VoiceTranscript { status: "ok", text, duration_ms })
}

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
