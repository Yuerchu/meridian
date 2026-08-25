//! Does the ChatGPT backend accept a request from *this* app?
//!
//! Ignored by default: it needs a real `codex login` and it spends real quota.
//!
//! ```
//! cargo test -p meridian-core --test codex_smoke -- --ignored --nocapture
//! ```
//!
//! It exists to settle one decision that cannot be settled from a fixture: we
//! send `originator: meridian` rather than impersonating the Codex CLI, and
//! whether the backend accepts an originator it has not seen before is a fact
//! about their server. If this fails with a 400 or 403 naming the originator,
//! that is the answer — and it goes back to the person who made the call rather
//! than being quietly worked around.

use meridian_core::codex_auth::{Manager, StoreId, storage};
use meridian_core::keyring::DefaultKeyringStore;
use std::sync::Arc;

/// Matches what the adapter will send. Kept here rather than imported so this
/// file is honest about what it is testing even before the adapter exists.
const ORIGINATOR: &str = "meridian";
const BASE_URL: &str = "https://chatgpt.com/backend-api/codex";

/// Whatever the CLI is configured to use, because the set of models a ChatGPT
/// account may reach is narrower than the API's and moves.
///
/// Measured: `gpt-5.4` answers *"The 'gpt-5.4' model is not supported when using
/// Codex with a ChatGPT account"* while the model in `config.toml` succeeds. A
/// hardcoded name here would fail for reasons that have nothing to do with what
/// the test is checking.
fn configured_model(home: &std::path::Path) -> String {
    std::fs::read_to_string(home.join("config.toml"))
        .ok()
        .and_then(|text| {
            text.lines()
                .filter_map(|line| line.trim().strip_prefix("model")?.trim().strip_prefix('='))
                .map(|value| value.trim().trim_matches('"').to_string())
                .find(|value| !value.is_empty())
        })
        .unwrap_or_else(|| "gpt-5.6".to_string())
}

#[tokio::test]
#[ignore = "needs a real ChatGPT login and spends quota"]
async fn the_backend_accepts_a_request_from_this_app() {
    let home = storage::find_codex_home().expect("no home directory");
    if !storage::auth_file(&home).exists() {
        panic!("no login at {} — run `codex login` first", home.display());
    }

    let manager = Manager::new(
        StoreId::CodexCli { home: home.clone() },
        Arc::new(DefaultKeyringStore),
        Arc::new(meridian_core::client::ReqwestTransport::shared()),
    );

    let status = manager.status();
    println!("account: {:?} plan: {:?}", status.email, status.plan);
    assert!(status.logged_in, "{:?}", status.problem);

    let bearer = manager.bearer().await.expect("could not obtain a token");
    println!("account_id: {} fedramp: {}", bearer.account_id, bearer.is_fedramp);

    // The smallest thing that still exercises the whole path: auth headers,
    // originator, the Responses shape, and `store: false`.
    let body = serde_json::json!({
        "model": configured_model(&home),
        "instructions": "Reply with the single word: ok",
        "input": [{
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_text", "text": "say ok" }]
        }],
        "stream": true,
        "store": false,
        "include": ["reasoning.encrypted_content"],
        "tool_choice": "auto",
        "parallel_tool_calls": false,
        "tools": [],
    });

    let client = reqwest::Client::new();
    let mut request = client
        .post(format!("{BASE_URL}/responses"))
        .header("authorization", format!("Bearer {}", bearer.access_token))
        .header("chatgpt-account-id", &bearer.account_id)
        .header("originator", ORIGINATOR)
        .header("user-agent", format!("{ORIGINATOR}/0.2.0"))
        .header("session_id", uuid::Uuid::new_v4().to_string())
        .header("content-type", "application/json")
        .json(&body);
    if bearer.is_fedramp {
        request = request.header("x-openai-fedramp", "true");
    }

    let response = request.send().await.expect("request failed to send");
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    println!("HTTP {status}");
    // Truncated: an SSE stream is long and none of it needs to be in a log.
    println!("body (first 600): {}", &text.chars().take(600).collect::<String>());

    assert!(
        status.is_success(),
        "the backend refused a request from originator={ORIGINATOR:?}.\n\
         If the refusal names the originator, that is the decision to revisit — \
         report it rather than switching to codex_cli_rs.\nHTTP {status}: {text}"
    );
}
