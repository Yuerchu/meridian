//! Turning `{"cmd": ..., "args": {...}}` back into a command call.
//!
//! The command list is written once, in `crate::command_table`, and consumed
//! twice: `generate_handler!` registers it with Tauri, and this builds the
//! remote entry point from the same rows. They cannot drift, because there is
//! nothing to drift from.
//!
//! Each row says how it may be reached:
//!
//! - `async` / `sync` — callable from either side. The keyword is there because
//!   a dispatcher cannot `.await` a function that is not a future, and the two
//!   spellings are otherwise identical.
//! - `local` — desktop only. The row still exists so Tauri registers it; what
//!   the remote side gets is a refusal naming the command.
//!
//! ## Why the arguments look like that
//!
//! Tauri's IPC takes camelCase argument names and matches them to snake_case
//! parameters. The frontend was written against that and sends `filePath` for a
//! `file_path`, so this has to do the same conversion or every call with a
//! multi-word argument would arrive empty. camelCase is the only wire spelling;
//! snake_case aliases and unknown fields are rejected as contract errors.

use serde::de::DeserializeOwned;

/// Pull one argument out of a payload that has already passed `validate_args`.
///
/// A missing argument is deserialised from `null` rather than refused outright,
/// so an `Option<T>` parameter the client omitted arrives as `None` — which is
/// what Tauri does, and what every optional parameter in the command surface
/// expects.
pub(crate) fn arg<T: DeserializeOwned>(args: &serde_json::Value, name: &str) -> Result<T, String> {
    let camel = to_camel_case(name);
    let value = args.get(&camel).cloned().unwrap_or(serde_json::Value::Null);
    serde_json::from_value(value).map_err(|e| format!("argument `{name}`: {e}"))
}

fn validate_args(args: &serde_json::Value, names: &[&str]) -> Result<(), String> {
    let object = args
        .as_object()
        .ok_or_else(|| "command arguments must be a JSON object".to_owned())?;
    let allowed: std::collections::HashSet<String> = names.iter().map(|name| to_camel_case(name)).collect();
    if let Some(name) = object.keys().find(|name| !allowed.contains(*name)) {
        return Err(format!("unknown command argument `{name}`"));
    }
    Ok(())
}

fn to_camel_case(snake: &str) -> String {
    let mut out = String::with_capacity(snake.len());
    let mut upper_next = false;
    for c in snake.chars() {
        if c == '_' {
            upper_next = true;
        } else if upper_next {
            out.extend(c.to_uppercase());
            upper_next = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Refuse a typed preference command when the selected key is the server's own.
///
/// Sits in front of the whole table rather than in `commands::preference`,
/// because the restriction is about *where the request came from* and the
/// command itself has no idea. Keys for listener credentials, OneBot admins or
/// ACP binaries are absent from `PreferenceKey` altogether; auto-review and
/// sandbox remain readable by the local settings UI but not over a socket.
fn guard_preference(cmd: &str, args: &serde_json::Value) -> Result<(), String> {
    if !matches!(cmd, "get_preference" | "set_preference") {
        return Ok(());
    }
    let request = args
        .get("request")
        .ok_or_else(|| format!("{cmd} requires a request object"))?;
    let raw_key = request
        .get("key")
        .cloned()
        .ok_or_else(|| format!("{cmd} request requires key"))?;
    let key: crate::commands::preference::PreferenceKey =
        serde_json::from_value(raw_key).map_err(|error| format!("invalid preference key: {error}"))?;
    if key.is_server_owned() {
        return Err(format!(
            "`{}` configures the machine running Meridian; change it there",
            key.as_str()
        ));
    }
    Ok(())
}

/// Re-pointing a provider at a new URL is how a stored API key leaves the
/// machine: `get_secret` is local, but `update_provider` + a later request
/// sends that key to whatever `base_url` now names.
///
/// `None` / JSON null is "do not change", which is what the frontend sends
/// for every field it is not editing — so presence of the key is not enough.
fn guard_provider_update(cmd: &str, args: &serde_json::Value) -> Result<(), String> {
    if cmd != "update_provider" {
        return Ok(());
    }
    let request = args.get("request").ok_or("update_provider requires a request object")?;
    for name in ["base_url", "provider_type", "api_format"] {
        if field_is_set(request, name) {
            return Err(format!(
                "`{name}` configures where this machine sends its API keys; change it there"
            ));
        }
    }
    Ok(())
}

fn field_is_set(args: &serde_json::Value, name: &str) -> bool {
    let camel = to_camel_case(name);
    match args.get(&camel) {
        None | Some(serde_json::Value::Null) => false,
        Some(_) => true,
    }
}

/// Strip other servers' credentials from a response the remote client is
/// allowed to make. The dedicated GET commands do not go through
/// `guard_preference`, so without this they hand back what that guard exists
/// to keep off the wire.
fn sanitize_remote_output(cmd: &str, mut value: serde_json::Value) -> serde_json::Value {
    match cmd {
        "get_hooks_config" => {
            if let Some(obj) = value.as_object_mut() {
                obj.insert("token".into(), serde_json::Value::Null);
            }
        }
        "get_onebot_config" => {
            if let Some(obj) = value.as_object_mut() {
                obj.insert("access_token".into(), serde_json::Value::Null);
                obj.insert("admin_users".into(), serde_json::Value::Array(Vec::new()));
            }
        }
        "list_mcp_servers" => {
            if let Some(arr) = value.as_array_mut() {
                for row in arr {
                    if let Some(obj) = row.as_object_mut() {
                        obj.insert("env".into(), serde_json::Value::Null);
                        obj.insert("headers".into(), serde_json::Value::Null);
                    }
                }
            }
        }
        _ => {}
    }
    value
}

/// One row of the table, as a call.
///
/// Three rules rather than one branch, because the difference is in what the
/// generated code has to be: `.await` on a synchronous function does not
/// compile, and a local-only row must not name its function at all.
macro_rules! dispatch_call {
    (async, $app:expr, $args:expr, ($($module:ident)::+), $name:ident, ($($arg:ident : $ty:ty),* $(,)?)) => {{
        validate_args($args, &[$(stringify!($arg)),*])?;
        $( let $arg: $ty = arg($args, stringify!($arg))?; )*
        let out = crate::$($module)::+::$name($app.clone(), $($arg),*).await?;
        serde_json::to_value(out).map_err(|e| e.to_string())
    }};
    (sync, $app:expr, $args:expr, ($($module:ident)::+), $name:ident, ($($arg:ident : $ty:ty),* $(,)?)) => {{
        validate_args($args, &[$(stringify!($arg)),*])?;
        $( let $arg: $ty = arg($args, stringify!($arg))?; )*
        let out = crate::$($module)::+::$name($app.clone(), $($arg),*)?;
        serde_json::to_value(out).map_err(|e| e.to_string())
    }};
    (local, $app:expr, $args:expr, ($($module:ident)::+), $name:ident, ($($arg:ident : $ty:ty),* $(,)?)) => {
        {
            validate_args($args, &[$(stringify!($arg)),*])?;
            Err(format!(
                "`{}` is only available on the machine running Meridian",
                stringify!($name)
            ))
        }
    };
}

/// Build the dispatcher from the table.
macro_rules! make_dispatch {
    ($($(#[$attr:meta])* $kind:ident $($module:ident)::+ => $name:ident ($($arg:ident : $ty:ty),* $(,)?)),* $(,)?) => {
        /// Run one command by name.
        ///
        /// An `if` chain rather than a `match`, because `stringify!` cannot
        /// appear in a pattern. A hundred and fifty string comparisons per
        /// request is nothing next to what any of these then go on to do.
        pub(crate) async fn dispatch(
            app: &tauri::AppHandle,
            cmd: &str,
            args: &serde_json::Value,
        ) -> Result<serde_json::Value, String> {
            // Before the table, not inside it: what this refuses is an argument
            // to a command that is otherwise perfectly reachable.
            guard_preference(cmd, args)?;
            guard_provider_update(cmd, args)?;
            $(
                $(#[$attr])*
                if cmd == stringify!($name) {
                    return dispatch_call!($kind, app, args, ($($module)::+), $name, ($($arg : $ty),*))
                        .map(|value| sanitize_remote_output(cmd, value));
                }
            )*
            Err(format!("unknown command `{cmd}`"))
        }

        /// Every command name, in table order. Used by the tests that keep this
        /// honest.
        #[cfg(test)]
        pub(crate) const COMMAND_NAMES: &[&str] = &[
            $(
                $(#[$attr])*
                stringify!($name),
            )*
        ];

        /// The ones a remote client is refused. Kept as data so a test can pin
        /// it: adding a command that touches this machine's filesystem and
        /// forgetting to mark it `local` is exactly the mistake worth failing a
        /// build over.
        #[cfg(test)]
        pub(crate) const LOCAL_ONLY: &[&str] = &[
            $(
                $(#[$attr])*
                local_marker!($kind, $name),
            )*
        ];
    };
}

/// The command's name if the row is `local`, an empty string otherwise. Rules
/// rather than a comparison, because matching on the keyword is the one thing
/// a macro can do that a `const fn` cannot.
#[cfg(test)]
macro_rules! local_marker {
    (local, $name:ident) => {
        stringify!($name)
    };
    (async, $name:ident) => {
        ""
    };
    (sync, $name:ident) => {
        ""
    };
}

crate::with_all_commands!(make_dispatch);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snake_becomes_camel_the_way_tauri_does_it() {
        assert_eq!(to_camel_case("file_path"), "filePath");
        assert_eq!(to_camel_case("conversation_id"), "conversationId");
        assert_eq!(to_camel_case("key"), "key");
        assert_eq!(to_camel_case("saf_roots_json"), "safRootsJson");
    }

    /// What the frontend actually sends.
    #[test]
    fn an_argument_is_found_under_its_camel_case_name() {
        let args = serde_json::json!({ "conversationId": "c-1" });
        assert_eq!(arg::<String>(&args, "conversation_id").unwrap(), "c-1");
    }

    /// The old snake_case wire spelling is not a compatibility alias.
    #[test]
    fn snake_case_arguments_are_rejected() {
        let args = serde_json::json!({ "conversation_id": "c-1" });
        assert!(validate_args(&args, &["conversation_id"]).is_err());
    }

    #[test]
    fn unknown_arguments_are_rejected() {
        let args = serde_json::json!({ "conversationId": "c-1", "futureField": true });
        assert!(validate_args(&args, &["conversation_id"]).is_err());
        assert!(validate_args(&serde_json::json!({ "conversationId": "c-1" }), &["conversation_id"]).is_ok());
    }

    /// An omitted optional argument is `None`, not an error -- half the command
    /// surface has one.
    #[test]
    fn a_missing_optional_argument_is_none() {
        let args = serde_json::json!({});
        assert_eq!(arg::<Option<String>>(&args, "title").unwrap(), None);
    }

    /// A missing *required* argument still fails, rather than arriving as
    /// something empty.
    #[test]
    fn a_missing_required_argument_is_an_error() {
        let args = serde_json::json!({});
        assert!(arg::<String>(&args, "conversation_id").is_err());
    }

    /// The hole the `local` markers would otherwise have: all three servers
    /// keep their configuration in `preferences`, so a generic write reaches
    /// what `save_listen_config` and friends are marked `local` to protect.
    #[test]
    fn a_server_owned_preference_cannot_be_reached_generically() {
        for key in [
            // These are not members of the closed public key enum at all.
            "remote.enabled",
            "remote.token",
            "remote.port",
            "hooks.token",
            "hooks.enabled",
            "onebot.access_token",
            "onebot.admin_users",
            // Not self-lockout: whoever writes these picks the model that
            // answers approvals, and what it is told to allow.
            "autoreview.model",
            "autoreview.allow_rules",
            "autoreview.enabled",
            "sandbox.enabled",
        ] {
            let args = serde_json::json!({ "request": { "key": key } });
            assert!(
                guard_preference("set_preference", &args).is_err(),
                "writing `{key}` should be refused"
            );
            // Reading matters too: two of these are other servers' credentials.
            assert!(
                guard_preference("get_preference", &args).is_err(),
                "reading `{key}` should be refused"
            );
        }
    }

    /// And the restriction stays narrow -- ordinary settings are most of what
    /// this command is for, and a remote client is the owner's own device.
    #[test]
    fn ordinary_preferences_are_untouched() {
        for key in [
            "shell",
            "search_provider",
            "voice.filter_level",
            "voice.download_url",
            "android.manage_storage_enabled",
            "approvals.ttl_minutes",
            "sub_agent.explore.model",
            "sub_agent.agent.model",
        ] {
            let args = serde_json::json!({ "request": { "key": key } });
            assert!(guard_preference("set_preference", &args).is_ok(), "`{key}` should pass");
            assert!(guard_preference("get_preference", &args).is_ok(), "`{key}` should pass");
        }
    }

    #[test]
    fn legacy_flat_preference_arguments_are_rejected() {
        let args = serde_json::json!({ "key": "shell", "value": "bash" });
        assert!(guard_preference("get_preference", &args).is_err());
        assert!(guard_preference("set_preference", &args).is_err());
    }

    /// The guard is keyed on the command, not on the argument: a command that
    /// happens to take something called `key` is not a preference write.
    #[test]
    fn the_guard_only_looks_at_the_preference_commands() {
        let args = serde_json::json!({ "key": "remote.token" });
        assert!(guard_preference("set_provider_key", &args).is_ok());
        assert!(guard_preference("chat", &args).is_ok());
    }

    #[test]
    fn a_remote_caller_cannot_repoint_a_provider() {
        for (field, value) in [
            ("baseUrl", serde_json::json!("https://evil.example")),
            ("providerType", serde_json::json!("openai")),
            ("apiFormat", serde_json::json!("responses")),
        ] {
            let args = serde_json::json!({ "request": { field: value } });
            assert!(
                guard_provider_update("update_provider", &args).is_err(),
                "{field} should be refused"
            );
        }
        // snake_case is not a second spelling the guard recognises. The exact
        // command-argument validator rejects it before dispatch instead.
        let snake = serde_json::json!({ "request": { "base_url": "https://evil.example" } });
        assert!(guard_provider_update("update_provider", &snake).is_ok());
        let request = snake.get("request").unwrap();
        assert!(validate_args(request, &["base_url"]).is_err());
        let rename = serde_json::json!({
            "request": { "id": "p1", "name": "Work", "baseUrl": null, "providerType": null }
        });
        assert!(guard_provider_update("update_provider", &rename).is_ok());
        assert!(guard_provider_update("chat", &serde_json::json!({ "request": { "baseUrl": "https://x" } })).is_ok());
    }

    #[test]
    fn other_servers_credentials_are_stripped_from_remote_reads() {
        let hooks = sanitize_remote_output(
            "get_hooks_config",
            serde_json::json!({ "enabled": true, "host": "127.0.0.1", "token": "sekrit" }),
        );
        assert_eq!(hooks["token"], serde_json::Value::Null);
        assert_eq!(hooks["host"], "127.0.0.1");

        let onebot = sanitize_remote_output(
            "get_onebot_config",
            serde_json::json!({
                "enabled": true,
                "access_token": "sekrit",
                "admin_users": [123]
            }),
        );
        assert_eq!(onebot["access_token"], serde_json::Value::Null);
        assert_eq!(onebot["admin_users"], serde_json::json!([]));

        let mcp = sanitize_remote_output(
            "list_mcp_servers",
            serde_json::json!([{ "name": "fs", "env": "{\"TOKEN\":\"x\"}", "headers": "a: b" }]),
        );
        assert_eq!(mcp[0]["env"], serde_json::Value::Null);
        assert_eq!(mcp[0]["headers"], serde_json::Value::Null);
        assert_eq!(mcp[0]["name"], "fs");
    }

    #[test]
    fn the_table_has_no_duplicate_names() {
        let mut seen = std::collections::HashSet::new();
        for name in COMMAND_NAMES {
            assert!(seen.insert(*name), "`{name}` appears twice in the command table");
        }
    }

    #[test]
    fn every_plan_review_command_is_registered_for_remote_dispatch() {
        let expected = [
            "get_plan_review",
            "list_plan_revisions",
            "save_plan_review_draft",
            "discard_plan_review_draft",
            "decide_plan_review",
            "get_plan_review_delivery",
            "continue_plan_review_delivery",
            "resolve_plan_file_conflict",
        ];
        for name in expected {
            assert!(
                COMMAND_NAMES.contains(&name),
                "{name} is missing from the command table"
            );
            let index = COMMAND_NAMES.iter().position(|candidate| *candidate == name).unwrap();
            assert_eq!(LOCAL_ONLY[index], "", "{name} must be reachable by remote clients");
        }
    }

    /// The list of what a remote client cannot reach, pinned.
    ///
    /// This is not a test of the code so much as a place the decision is
    /// written down: a new command that takes a path on *this* machine, or that
    /// reconfigures the server answering the request, has to be marked `local`,
    /// and the way to find out you forgot is here rather than in production.
    #[test]
    fn the_local_only_set_is_what_we_think_it_is() {
        let mut actual: Vec<&str> = LOCAL_ONLY.iter().copied().filter(|n| !n.is_empty()).collect();
        actual.sort_unstable();

        let mut expected = vec![
            // The keychain. Every provider's API key is in there under a name
            // derived from an id a remote caller can list, so a generic read
            // hands over credentials; `get_provider_key_exists` answers the
            // question a client actually has and stays reachable.
            "set_secret",
            "get_secret",
            "delete_secret",
            // Paths on the machine the *user* is sitting at, which is not this
            // one when the request came over a socket.
            "upload_file",
            // No path in it, but a remote client already has `/upload` for the
            // same operation as multipart — base64 through the socket would be
            // a second, worse spelling of it.
            "upload_file_bytes",
            "export_conversation",
            "export_logs",
            "import_emojis",
            "voice_import_model",
            // Writes a bundle to an arbitrary local path, and what it writes is
            // the voice corpus itself. Listing and deleting stay reachable:
            // deleting is *the* action someone asks for from their phone.
            "export_voice_corpus",
            // Reconfiguring the server that is answering the request. A remote
            // caller turning off remote access cuts the branch it is sitting on.
            "save_listen_config",
            "start_listen",
            "stop_listen",
            "regenerate_listen_token",
            "save_hooks_config",
            "start_hooks",
            "stop_hooks",
            "regenerate_hooks_token",
            "save_onebot_config",
            "start_onebot",
            "stop_onebot",
            // These two are `local` for what they *return*, not for what they
            // do — the only pair in this list that is. `OneBotConfig` carries
            // `access_token`, which is another server's credential and the same
            // key `guard_preference` refuses to let a remote caller write;
            // reading it back undoes that guard from the other side. It also
            // carries `admin_users` and the voice allowlists, whose private-chat
            // entries are a person's own QQ number. The readiness beside it is
            // derived from the same row.
            "get_onebot_config",
            "get_voice_send_readiness",
            // A step beyond the rest of this group. `acp.command` names a
            // binary this app will execute, so writing it from a socket is
            // arbitrary code execution here — not the self-lockout the others
            // guard against. The check runs that same binary.
            "acp_save_config",
            "acp_check_adapter",
            // The notification endpoints, and again not for self-lockout. The
            // URL decides where an alert naming a provider and an amount of
            // money is delivered, so a remote caller able to write one
            // redirects the alerts; the signing secret beside it is a
            // credential. Reading the list back is `local` for the same reason
            // `get_onebot_config` is — it carries those URLs, whose query
            // strings are how DingTalk and WeCom authenticate a robot.
            "get_notify_config",
            "save_notify_config",
            "list_notification_webhooks",
            "create_notification_webhook",
            "update_notification_webhook",
            "delete_notification_webhook",
            "test_notification_webhook",
            // Same ACE as `acp.command`: a stdio MCP server is a binary this
            // app spawns, and a custom tool with `permission: always` is a
            // shell command that never asks.
            "create_mcp_server",
            "update_mcp_server",
            "connect_mcp_server",
            "create_custom_tool",
            "update_custom_tool",
            // Arbitrary URL, up to 1 GB written to disk.
            "voice_download_model",
            // Hardware attached to this machine.
            "voice_start_recording",
            "voice_stop_and_transcribe",
            "voice_cancel_recording",
            "voice_release_prewarm",
            "voice_probe_echo",
            // Android's own surface: the device asking is the device that has
            // the storage grant, so these are answered locally on the client.
            "get_window_insets",
            "get_manage_storage_status",
            "request_manage_storage",
            "pick_saf_directory",
            "list_saf_roots",
            "remove_saf_root",
            "take_photo",
            "pick_gallery_image",
            "resolve_file_name",
            // This machine's windows. A remote client has its own launch to
            // worry about, and the splash it would be dismissing is one it
            // cannot see.
            "splash_animation_done",
            "splash_app_ready",
            // Runs the user's configured editor command template — a program
            // launch on this machine, which a socket must not be able to ask
            // for.
            "open_in_editor",
            // The input method: this machine's keyboard. Importing reads a path
            // here, registering asks for elevation here, and the host is a
            // process here. Filtered out by `COMMAND_NAMES` off Windows.
            "save_ime_config",
            "import_ime_dictionary",
            "set_ime_dictionary_enabled",
            "remove_ime_dictionary",
            "start_ime_host",
            "stop_ime_host",
            "set_ime_profile_enabled",
            "register_ime",
        ];
        expected.sort_unstable();
        expected.retain(|name| COMMAND_NAMES.contains(name));

        assert_eq!(actual, expected);
    }
}
