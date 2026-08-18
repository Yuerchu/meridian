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
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
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
