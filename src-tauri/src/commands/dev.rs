//! Commands behind Settings → Developer.
//!
//! Kept apart from `commands::voice` so the probes stay available on every
//! platform and carry no dependency on the speech engine — the Android
//! microphone question has to be answerable before the sherpa libraries are
//! wired into that build at all.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;

/// Decode a base64 PCM payload and report how many samples arrived.
///
/// Exists to measure the bridge, not to do anything with the audio. Android has
/// no raw IPC — `InvokeBody::Raw` is documented as unsupported there and an
/// `ArrayBuffer` is expanded into a JSON number array — so voice input has to
/// send base64, and this is what says whether that is affordable at the sizes
/// a real recording produces.
///
/// `sample_rate` is not needed for the count. It is here because the payload
/// and a scalar travelling together is itself part of what needs proving: with
/// a raw body they could not.
#[tauri::command]
pub async fn voice_probe_echo(sample_rate: u32, pcm: String) -> Result<usize, String> {
    if !(8_000..=192_000).contains(&sample_rate) {
        return Err(format!("implausible sample rate: {sample_rate}"));
    }
    let bytes = BASE64
        .decode(pcm.as_bytes())
        .map_err(|e| format!("payload is not valid base64: {e}"))?;
    if bytes.len() % 2 != 0 {
        return Err("payload is not 16-bit PCM: odd byte count".to_string());
    }
    Ok(bytes.len() / 2)
}
