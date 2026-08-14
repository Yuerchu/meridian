//! The socket half: one connection, two routes, and the checks that decide
//! whether a request is allowed to cost anything.
//!
//! Every rejection here is a non-2xx, and every non-2xx is fail-open on the
//! Claude Code side. So the status code is not a signal to the caller so much
//! as a note to whoever is reading `claude --debug` — which is why each one
//! carries a sentence rather than a code.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;
use hyper::header::{AUTHORIZATION, CONTENT_TYPE};
use hyper::http::request::Parts;
use hyper::{Method, Request, Response, StatusCode};

use super::protocol::{ErrorBody, ReviewRequest};
use super::{review, SharedState};

/// A plan is markdown a model wrote; a couple of megabytes is already far past
/// anything a reviewer could usefully read.
const MAX_BODY: usize = 2 * 1024 * 1024;
/// A whole request has this long to arrive. Separate from the review timeout:
/// this one is about a stalled socket, not a slow model.
const HEADER_TIMEOUT_SECS: u64 = 15;

/// The connection settings, in one function so the socket test at the bottom
/// exercises the same assembly `serve` runs.
///
/// It did not used to be, and that is exactly how this shipped broken: hyper
/// 1.x carries no default timer, so `header_read_timeout` without one is a
/// `panic!` on every connection rather than a timeout that never fires
/// (`hyper/src/common/time.rs`). The endpoint bound its port, wrote its
/// handshake file, and reset every connection that reached it. Nothing caught
/// it because every test here called `classify` directly and none opened a
/// socket.
fn connection_builder() -> hyper::server::conn::http1::Builder {
    let mut builder = hyper::server::conn::http1::Builder::new();
    builder
        .timer(hyper_util::rt::TokioTimer::new())
        .header_read_timeout(Duration::from_secs(HEADER_TIMEOUT_SECS));
    builder
}

pub(crate) fn serve(stream: tokio::net::TcpStream, peer: SocketAddr, state: Arc<SharedState>) {
    tokio::spawn(async move {
        let io = hyper_util::rt::TokioIo::new(stream);
        let service = hyper::service::service_fn(move |req| {
            let state = state.clone();
            async move { Ok::<_, Infallible>(route(req, state).await) }
        });
        if let Err(e) = connection_builder().serve_connection(io, service).await {
            tracing::debug!(error = %e, %peer, "hook connection ended");
        }
    });
}

fn json(status: StatusCode, body: &impl serde::Serialize) -> Response<Full<Bytes>> {
    let encoded = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(Full::new(Bytes::from(encoded)))
        .unwrap_or_else(|_| Response::new(Full::new(Bytes::from_static(b"{}"))))
}

fn fail(status: StatusCode, message: impl Into<String>) -> Response<Full<Bytes>> {
    let message = message.into();
    tracing::debug!(%status, %message, "hook request refused");
    json(status, &ErrorBody { error: message })
}

/// Takes no state, so the socket test can answer with the real thing rather
/// than with a stand-in that proves nothing about this file.
fn healthz() -> Response<Full<Bytes>> {
    json(
        StatusCode::OK,
        &serde_json::json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }),
    )
}

async fn route(req: Request<Incoming>, state: Arc<SharedState>) -> Response<Full<Bytes>> {
    let (parts, body) = req.into_parts();

    match (&parts.method, parts.uri.path()) {
        (&Method::GET, "/healthz") => return healthz(),
        (&Method::POST, "/hooks/exit-plan") => {}
        (&Method::GET, _) | (&Method::POST, _) => {
            return fail(StatusCode::NOT_FOUND, "no such hook endpoint");
        }
        _ => return fail(StatusCode::METHOD_NOT_ALLOWED, "method not allowed"),
    }

    let bytes = match Limited::new(body, MAX_BODY).collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(_) => return fail(StatusCode::PAYLOAD_TOO_LARGE, "request body too large"),
    };

    let request = match classify(&parts, &bytes, &state.config) {
        Ok(r) => r,
        Err((status, message)) => return fail(status, message),
    };

    // Spawned rather than awaited inline, so the review belongs to the app and
    // not to this socket. If the client gives up — Claude Code's own timeout, a
    // user interrupting the tool call — this handler's future is dropped, but
    // the task carries on, finishes the transcript the user reads and records
    // how the turn ended. The verdict simply has nowhere to go, and the client
    // was already failing open by then.
    let (tx, rx) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let _ = tx.send(review::run(state, request).await);
    });

    match rx.await {
        Ok(Ok(response)) => json(StatusCode::OK, &response),
        Ok(Err(review::Refused { status, message })) => fail(status, message),
        // The task died without answering — a panic, or the runtime going down.
        Err(_) => fail(StatusCode::INTERNAL_SERVER_ERROR, "the review ended without a verdict"),
    }
}

/// Everything that can be decided from the request alone.
///
/// Split out from [`route`] so it can be tested without a socket — the
/// interesting cases here are all about what gets turned away.
pub(crate) fn classify(
    parts: &Parts,
    body: &[u8],
    config: &super::HookConfig,
) -> Result<ReviewRequest, (StatusCode, String)> {
    // A page in the user's browser can POST to loopback. It cannot read the
    // reply, but it does not need to: getting here at all spends a model call
    // and puts attacker-chosen text in front of an agent that reads this
    // machine's files. Requiring application/json forces a preflight, which we
    // never answer, and refusing a cross-site fetch closes what is left.
    if parts.headers.contains_key("origin") {
        return Err((StatusCode::FORBIDDEN, "cross-origin request refused".into()));
    }
    if let Some(site) = parts.headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
        if site != "none" && site != "same-origin" {
            return Err((StatusCode::FORBIDDEN, "cross-site request refused".into()));
        }
    }
    let content_type = parts.headers.get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !content_type.starts_with("application/json") {
        return Err((StatusCode::FORBIDDEN, "expected application/json".into()));
    }

    if let Some(expected) = config.token.as_deref().filter(|t| !t.is_empty()) {
        let presented = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("");
        if !constant_time_eq(expected.as_bytes(), presented.as_bytes()) {
            return Err((StatusCode::UNAUTHORIZED, "bad or missing token".into()));
        }
    }

    let request: ReviewRequest = serde_json::from_slice(body)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("malformed request body: {e}")))?;

    if request.plan.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "the plan is empty".into()));
    }
    if request.session_id.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "sessionId is required".into()));
    }
    if request.cwd.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "cwd is required".into()));
    }

    Ok(request)
}

/// Comparison that does not return early on the first differing byte.
///
/// The token travels over loopback so this is not guarding much, but the
/// alternative is a naked `==` on a secret, which is the kind of thing that
/// stops being local the day someone binds to `0.0.0.0`.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::super::protocol::ReviewResponse;
    use super::*;

    /// Serialised here so `ReviewResponse`'s untagged shape is pinned by a test
    /// rather than by whatever serde happens to emit.
    fn encode(response: &ReviewResponse) -> String {
        serde_json::to_string(response).unwrap()
    }

    fn config() -> super::super::HookConfig {
        super::super::HookConfig { token: Some("t".repeat(32)), ..Default::default() }
    }

    fn parts(headers: &[(&str, &str)]) -> Parts {
        let mut builder = Request::builder().method(Method::POST).uri("/hooks/exit-plan");
        for (k, v) in headers {
            builder = builder.header(*k, *v);
        }
        builder.body(()).unwrap().into_parts().0
    }

    fn authed() -> Vec<(&'static str, &'static str)> {
        vec![("content-type", "application/json"), ("authorization", "Bearer tttttttttttttttttttttttttttttttt")]
    }

    fn body() -> Vec<u8> {
        br#"{"sessionId":"s","cwd":"C:/repo","plan":"do a thing","round":1}"#.to_vec()
    }

    #[test]
    fn a_well_formed_request_is_accepted() {
        let request = classify(&parts(&authed()), &body(), &config()).unwrap();
        assert_eq!(request.session_id, "s");
        assert_eq!(request.round, 1);
    }

    /// A plugin that predates the continuation field still has to work — it
    /// just gets a new conversation each round, which is what happened before.
    #[test]
    fn a_request_without_a_conversation_id_still_parses() {
        let request = classify(&parts(&authed()), &body(), &config()).unwrap();
        assert_eq!(request.conversation_id, None);
    }

    #[test]
    fn a_conversation_id_is_carried_through() {
        let with_id =
            br#"{"sessionId":"s","cwd":"C:/repo","plan":"p","conversationId":"c-1"}"#;
        let request = classify(&parts(&authed()), with_id, &config()).unwrap();
        assert_eq!(request.conversation_id.as_deref(), Some("c-1"));
    }

    #[test]
    fn a_browser_origin_is_refused() {
        let mut headers = authed();
        headers.push(("origin", "https://evil.example"));
        let err = classify(&parts(&headers), &body(), &config()).unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn a_cross_site_fetch_is_refused() {
        let mut headers = authed();
        headers.push(("sec-fetch-site", "cross-site"));
        let err = classify(&parts(&headers), &body(), &config()).unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    /// The address bar and curl both send `none`; a same-origin XHR from our
    /// own page sends `same-origin`. Neither is the attack.
    #[test]
    fn a_same_origin_or_direct_request_passes() {
        for site in ["none", "same-origin"] {
            let mut headers = authed();
            headers.push(("sec-fetch-site", site));
            assert!(classify(&parts(&headers), &body(), &config()).is_ok(), "{site}");
        }
    }

    #[test]
    fn a_form_post_is_refused_before_the_token_is_even_checked() {
        let headers = vec![("content-type", "text/plain")];
        let err = classify(&parts(&headers), &body(), &config()).unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn a_wrong_or_missing_token_is_unauthorized() {
        let wrong = vec![("content-type", "application/json"), ("authorization", "Bearer nope")];
        assert_eq!(
            classify(&parts(&wrong), &body(), &config()).unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
        let none = vec![("content-type", "application/json")];
        assert_eq!(
            classify(&parts(&none), &body(), &config()).unwrap_err().0,
            StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn an_empty_plan_is_nothing_to_review() {
        let empty = br#"{"sessionId":"s","cwd":"C:/repo","plan":"   "}"#;
        assert_eq!(
            classify(&parts(&authed()), empty, &config()).unwrap_err().0,
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn a_missing_cwd_is_refused_because_the_reviewer_needs_a_repository() {
        let no_cwd = br#"{"sessionId":"s","cwd":"","plan":"do a thing"}"#;
        assert_eq!(
            classify(&parts(&authed()), no_cwd, &config()).unwrap_err().0,
            StatusCode::BAD_REQUEST
        );
    }

    /// The one test that opens a socket, and the only kind that could have
    /// caught the missing timer: every other test here calls a pure function.
    ///
    /// Comment out `.timer(...)` in `connection_builder` and this fails — which
    /// is the point. A real client speaking real HTTP/1.1 gets bytes back.
    #[tokio::test]
    async fn a_real_connection_gets_a_real_response() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let io = hyper_util::rt::TokioIo::new(stream);
            let service =
                hyper::service::service_fn(|_req| async { Ok::<_, Infallible>(healthz()) });
            let _ = connection_builder().serve_connection(io, service).await;
        });

        // Raw TCP rather than a client crate, so the assertion is on bytes
        // actually coming back off the wire and not on some other library's
        // idea of what happened.
        let mut client = tokio::net::TcpStream::connect(addr).await.unwrap();
        client
            .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();

        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        let response = String::from_utf8_lossy(&response);

        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        assert!(response.contains(r#""ok":true"#), "{response}");
    }

    #[test]
    fn constant_time_eq_still_compares() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    /// The plugin distinguishes the three responses by shape alone, so the
    /// shapes are part of the contract rather than an implementation detail.
    #[test]
    fn the_wire_shapes_are_what_the_plugin_expects() {
        let approve = encode(&ReviewResponse::approve("fine".into(), "r-1".into(), "c-1".into()));
        assert!(approve.contains(r#""verdict":"approve""#), "{approve}");
        assert!(!approve.contains("message"), "{approve}");
        // The continuation the client has to store; without it round 2 starts
        // a reviewer with no memory of round 1.
        assert!(approve.contains(r#""conversationId":"c-1""#), "{approve}");

        let revise =
            encode(&ReviewResponse::revise("bad".into(), "fix it".into(), "r-2".into(), "c-1".into()));
        assert!(revise.contains(r#""verdict":"revise""#), "{revise}");
        assert!(revise.contains(r#""message":"fix it""#), "{revise}");
        assert!(revise.contains(r#""conversationId":"c-1""#), "{revise}");

        // No verdict, but a transcript was still written — the next round
        // continues in it, so this shape carries the conversation too.
        let inconclusive = encode(&ReviewResponse::inconclusive("no idea", "c-1".into()));
        assert_eq!(
            inconclusive,
            r#"{"systemMessage":"no idea","conversationId":"c-1"}"#
        );
    }
}
