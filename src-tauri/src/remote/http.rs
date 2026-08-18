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

/// The wire protocol's version. Bumped when a client that predates a change
/// would misread what this sends -- not for additions a client can ignore.
pub(crate) const API_REV: u32 = 1;

/// The oldest client this server will talk to. Kept equal to `API_REV` until
/// there is a released client worth staying compatible with.
pub(crate) const MIN_CLIENT_REV: u32 = 1;

pub(crate) fn router(state: Arc<SharedState>) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/events", get(super::ws::handler))
        .route("/rpc/invoke", post(invoke))
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
struct Invoke {
    cmd: String,
    #[serde(default)]
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
}
