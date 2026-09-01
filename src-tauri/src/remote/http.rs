//! The routes, and who is allowed to reach them.
//!
//! ## Why this is the opposite of the hook endpoint's guard
//!
//! `hooks/http.rs` refuses any request carrying an `Origin` header and any
//! cross-site `Sec-Fetch-Site`. That is right for it: its only legitimate
//! caller is a local process, so a request from a page is a request from a page
//! that should not have found it.
//!
//! Here the legitimate caller *is* a page — the client is a webview on another
//! device, and its `fetch` to a LAN address is cross-origin by construction. So
//! preflights are answered and any origin is allowed, and the bearer token is
//! the whole of the boundary. That is not a weakening: nothing is reachable
//! without the token, and a page that does not have it gets nothing by being
//! allowed to ask. What it does mean is that the token has to be worth
//! something, which is what `listen_guard` enforces at configuration time.

use std::sync::Arc;

use axum::Router;
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use meridian_core::listen_guard::constant_time_eq;
use tower_http::cors::{Any, CorsLayer};

use super::SharedState;

/// The wire protocol's version. Bump this for every change to the first-party
/// client/server contract. The wire DTOs are closed, so version skew is
/// rejected rather than interpreted through ignored fields or defaults.
///
/// 2: the voice corpus commands. An addition from the *server's* side, and the
/// reason it still counts is that the direction that breaks is the other one --
/// a client carrying the corpus panel against a server that predates it reaches
/// `unknown command` on a page the user already opened, with nothing to say
/// which half is old. The client compares `apiRev` against its own and calls it
/// `server-too-old` before it gets there.
pub(crate) const API_REV: u32 = 3;

/// The oldest client this server will talk to.
///
/// Revision 3 changed existing DTO names, fields, and monetary encodings.  Old
/// clients are rejected at the handshake instead of being interpreted through
/// aliases or defaults.
pub(crate) const MIN_CLIENT_REV: u32 = 3;

pub(crate) fn router(state: Arc<SharedState>) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/events", get(super::ws::handler))
        .route("/rpc/invoke", post(invoke))
        .route("/upload", post(upload))
        .route("/assets", get(assets))
        .layer(
            // No credentials: the token travels in a header the client sets by
            // hand, never in a cookie, so there is nothing for a browser to
            // attach automatically and nothing CSRF can borrow.
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        )
        .with_state(state)
}

/// What a client asks before it commits to anything.
///
/// Deliberately unauthenticated: a client that cannot reach this cannot tell a
/// wrong address from a wrong token, and "is anything there" is not worth
/// guarding. It says nothing about the user -- no conversation, no name, not
/// whether a token has even been set.
async fn healthz() -> Response {
    axum::Json(serde_json::json!({
        "app": "meridian",
        "version": env!("CARGO_PKG_VERSION"),
        "apiRev": API_REV,
        "minClientRev": MIN_CLIENT_REV,
    }))
    .into_response()
}

/// One command, named and with its arguments, exactly as `invoke()` would have
/// sent it to Tauri.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Invoke {
    cmd: String,
    args: serde_json::Value,
}

/// Run a command and answer with what it returned.
///
/// The two shapes are `{"ok": <value>}` and `{"err": "<message>"}`, mirroring
/// the `Result<T, String>` every command returns, so the client has one thing
/// to look at rather than a status code *and* a body. The HTTP status stays 200
/// for a command that ran and failed: that is not a transport error, and
/// treating it as one would make a refused tool call indistinguishable from a
/// dropped connection.
async fn invoke(State(state): State<Arc<SharedState>>, headers: axum::http::HeaderMap, body: String) -> Response {
    if let Some(refusal) = authorize(&state.config, &headers) {
        return refusal;
    }
    let Ok(call) = serde_json::from_str::<Invoke>(&body) else {
        return refuse(StatusCode::BAD_REQUEST, "malformed invoke payload");
    };

    match super::dispatch::dispatch(&state.app, &call.cmd, &call.args).await {
        Ok(value) => axum::Json(serde_json::json!({ "ok": value })).into_response(),
        Err(message) => axum::Json(serde_json::json!({ "err": message })).into_response(),
    }
}

/// Take a file the user picked on *their* device and store it here.
///
/// `upload_file` is marked `local` because its argument is a path, and a path
/// means nothing when the person is somewhere else. This is the same operation
/// with the bytes carried instead, and it answers with the identical JSON so
/// the composer cannot tell which one ran.
async fn upload(
    State(state): State<Arc<SharedState>>,
    headers: axum::http::HeaderMap,
    mut form: axum::extract::Multipart,
) -> Response {
    if let Some(refusal) = authorize(&state.config, &headers) {
        return refusal;
    }

    let mut conversation_id: Option<String> = None;
    let mut file_name: Option<String> = None;
    let mut bytes: Option<axum::body::Bytes> = None;

    loop {
        match form.next_field().await {
            Ok(Some(field)) => match field.name() {
                Some("conversationId") => {
                    if conversation_id.is_some() {
                        return refuse(StatusCode::BAD_REQUEST, "duplicate conversationId field");
                    }
                    match field.text().await {
                        Ok(value) if !value.is_empty() => conversation_id = Some(value),
                        Ok(_) => return refuse(StatusCode::BAD_REQUEST, "empty conversationId field"),
                        Err(error) => return refuse(StatusCode::BAD_REQUEST, &error.to_string()),
                    }
                }
                Some("file") => {
                    if bytes.is_some() {
                        return refuse(StatusCode::BAD_REQUEST, "duplicate file field");
                    }
                    let Some(name) = field.file_name().filter(|name| !name.is_empty()).map(str::to_owned) else {
                        return refuse(StatusCode::BAD_REQUEST, "file field has no filename");
                    };
                    match field.bytes().await {
                        Ok(value) => {
                            file_name = Some(name);
                            bytes = Some(value);
                        }
                        Err(e) => return refuse(StatusCode::PAYLOAD_TOO_LARGE, &e.to_string()),
                    }
                }
                Some(name) => return refuse(StatusCode::BAD_REQUEST, &format!("unknown upload field: {name}")),
                None => return refuse(StatusCode::BAD_REQUEST, "unnamed upload field"),
            },
            Ok(None) => break,
            Err(e) => return refuse(StatusCode::BAD_REQUEST, &e.to_string()),
        }
    }

    let Some(bytes) = bytes else {
        return refuse(StatusCode::BAD_REQUEST, "no file in the upload");
    };
    let Some(conversation_id) = conversation_id else {
        return refuse(StatusCode::BAD_REQUEST, "no conversationId in the upload");
    };
    let Some(file_name) = file_name else {
        return refuse(StatusCode::BAD_REQUEST, "file field has no filename");
    };

    let ext = file_name
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 10 && !e.contains('/') && e.len() < file_name.len())
        .unwrap_or("bin")
        .to_string();

    let data_dir = state.services.paths.data_dir.clone();
    let stored = tokio::task::spawn_blocking(move || {
        let (dest, uri) = meridian_core::files::alloc_dest(&data_dir, &conversation_id, &ext)?;
        std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
        Ok::<_, String>(uri)
    })
    .await;

    let uri = match stored {
        Ok(Ok(uri)) => uri,
        Ok(Err(e)) => return refuse(StatusCode::INTERNAL_SERVER_ERROR, &e),
        Err(e) => return refuse(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    // The same two shapes `upload_file` produces, chosen the same way.
    let mime = mime_guess::from_path(&file_name).first_or_octet_stream().to_string();
    let part = crate::commands::message::UploadFileResponse::from_stored(uri, mime, file_name);
    axum::Json(serde_json::json!({ "ok": part })).into_response()
}

/// What an `<img src>` on another device points at.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetQuery {
    uri: String,
    ticket: String,
}

/// Serve one stored attachment.
///
/// Two things guard it. The ticket, because an image URL cannot carry a header
/// and the bearer token must not be spent in a query string. And
/// `resolve_attachment_uri`, which canonicalises the path and refuses anything
/// outside the attachment root — the same function that stops a model-authored
/// `file://` from being inlined into a provider request, used here against a
/// client-authored one.
async fn assets(State(state): State<Arc<SharedState>>, query: axum::extract::Query<AssetQuery>) -> Response {
    let known = state
        .tickets
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(&query.ticket);
    if !known {
        return refuse(StatusCode::UNAUTHORIZED, "unknown or expired ticket");
    }

    let root = meridian_core::files::files_dir(&state.services.paths.data_dir);
    let Some(path) = meridian_core::files::resolve_attachment_uri(&query.uri, &root) else {
        return refuse(StatusCode::NOT_FOUND, "no such attachment");
    };

    let mime = mime_guess::from_path(&path).first_or_octet_stream().to_string();
    match tokio::fs::read(&path).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, mime),
                // Attachment bytes never change under their uuid, and a phone
                // re-rendering a transcript should not re-fetch every image.
                (header::CACHE_CONTROL, "private, max-age=31536000, immutable".into()),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => refuse(StatusCode::NOT_FOUND, &e.to_string()),
    }
}

/// Whether a request carries the configured token, as a refusal or nothing.
///
/// `Some` is the response to send back; `None` means carry on. Phrased that way
/// round rather than as a `Result` because the refusal is a whole HTTP
/// response, and a `Result` that large is one clippy objects to at every call
/// site that propagates it.
pub(crate) fn authorize(config: &super::ListenConfig, headers: &axum::http::HeaderMap) -> Option<Response> {
    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");

    if token_ok(config, presented) {
        None
    } else {
        Some(refuse(StatusCode::UNAUTHORIZED, "bad or missing token"))
    }
}

/// A refusal, in the shape the client already knows how to read.
pub(crate) fn refuse(status: StatusCode, message: &str) -> Response {
    tracing::debug!(%status, %message, "remote request refused");
    (status, axum::Json(serde_json::json!({ "err": message }))).into_response()
}

/// Whether a presented token is the configured one.
///
/// The two entry points disagree about where the token comes from — HTTP reads
/// a bearer header, the websocket reads its first frame, because a browser
/// cannot set a header on a `WebSocket` — so what they share is only this.
///
/// No token configured means nobody is let in. `start` refuses to bind off
/// loopback without one, so that should be unreachable; it is spelled out
/// because the failure mode if it ever is reachable is "everyone is allowed".
pub(crate) fn token_ok(config: &super::ListenConfig, presented: &str) -> bool {
    match config.token.as_deref().filter(|t| !t.is_empty()) {
        Some(expected) => constant_time_eq(presented.as_bytes(), expected.as_bytes()),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configured(token: Option<&str>) -> super::super::ListenConfig {
        super::super::ListenConfig {
            token: token.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn the_right_token_is_let_through() {
        assert!(token_ok(&configured(Some("0123456789abcdef")), "0123456789abcdef"));
    }

    #[test]
    fn a_wrong_or_empty_token_is_refused() {
        let config = configured(Some("0123456789abcdef"));
        assert!(!token_ok(&config, "0123456789abcdee"));
        assert!(!token_ok(&config, ""));
    }

    /// A prefix must not pass. `constant_time_eq` compares lengths first, but
    /// what this pins is that nothing here does a `starts_with`.
    #[test]
    fn a_prefix_of_the_token_is_not_the_token() {
        assert!(!token_ok(&configured(Some("0123456789abcdef")), "0123456789"));
    }

    /// Configuration should make this unreachable; it is here because the
    /// failure mode if it ever is reachable is "everything is allowed".
    #[test]
    fn no_token_configured_refuses_everyone() {
        assert!(!token_ok(&configured(None), "anything"));
        assert!(!token_ok(&configured(Some("")), ""));
    }

    #[test]
    fn invoke_and_asset_contracts_reject_unknown_or_missing_fields() {
        assert!(serde_json::from_str::<Invoke>(r#"{"cmd":"list_providers","args":{}}"#).is_ok());
        assert!(serde_json::from_str::<Invoke>(r#"{"cmd":"list_providers"}"#).is_err());
        assert!(serde_json::from_str::<Invoke>(r#"{"cmd":"list_providers","args":{},"future":true}"#).is_err());

        assert!(serde_json::from_str::<AssetQuery>(r#"{"uri":"file://x","ticket":"t"}"#).is_ok());
        assert!(serde_json::from_str::<AssetQuery>(r#"{"uri":"file://x","ticket":"t","future":1}"#).is_err());
    }
}
