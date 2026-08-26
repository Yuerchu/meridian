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
//! multi-word argument would arrive empty. It looks for both spellings: the
//! camelCase one first, because that is what the client actually sends, and the
//! original as a fallback so a hand-written request works too.

use serde::de::DeserializeOwned;

/// Pull one argument out of the payload, under either spelling.
///
/// A missing argument is deserialised from `null` rather than refused outright,
/// so an `Option<T>` parameter the client omitted arrives as `None` — which is
/// what Tauri does, and what every optional parameter in the command surface
/// expects.
pub(crate) fn arg<T: DeserializeOwned>(args: &serde_json::Value, name: &str) -> Result<T, String> {
    let camel = to_camel_case(name);
    let value = args
        .get(&camel)
        .or_else(|| args.get(name))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    serde_json::from_value(value).map_err(|e| format!("argument `{name}`: {e}"))
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

/// Preference keys that belong to a server rather than to the user.
///
/// `save_listen_config`, `start_hooks`, `save_onebot_config` and the rest are
/// marked `local` because a remote caller reconfiguring the server that is
/// answering it is sawing off the branch it sits on. But those commands are
/// only one way to reach that state: all three servers keep their configuration
/// in `preferences`, and `set_preference` is a generic key-value write. Marking
/// the specific commands and leaving the generic one open would mean the rule
/// held only for callers who did not think to go round it.
///
/// Two of these are worse than self-lockout. `hooks.token` and
/// `onebot.access_token` are other servers' credentials, and
/// `onebot.admin_users` decides who counts as an admin in QQ — writing it is
/// privilege escalation against a *third party*, not a setting the owner is
/// entitled to change about their own session.
///
/// `autoreview.` is here for the escalation reason rather than the self-lockout
/// one. Those keys decide which model answers approvals and what it is told;
/// pointing `autoreview.model` at something that waves everything through, or
/// appending one line to `autoreview.allow_rules`, converts write access to a
/// settings key into permission to run anything on the host. It is the only
/// prefix whose *values* grant capability rather than configure a listener.
const SERVER_OWNED_PREFIXES: &[&str] = &[
    "remote.",
    "hooks.",
    "onebot.",
    "autoreview.",
    "acp.",
    // Whether commands run inside the OS sandbox. Turning it off is permission
    // to write outside the project, same class as `autoreview.allow_rules`.
    "sandbox.",
];

/// Refuse the generic key-value commands when the key is a server's own.
///
/// Sits in front of the whole table rather than in `commands::preference`,
/// because the restriction is about *where the request came from* and the
/// command itself has no idea. The window goes on being able to write anything.
fn guard_preference(cmd: &str, args: &serde_json::Value) -> Result<(), String> {
    if !matches!(cmd, "get_preference" | "set_preference") {
        return Ok(());
    }
    let key: String = arg(args, "key").unwrap_or_default();
    if SERVER_OWNED_PREFIXES.iter().any(|prefix| key.starts_with(prefix)) {
        return Err(format!(
            "`{key}` configures a server on the machine running Meridian; change it there"
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
    for name in ["base_url", "provider_type", "api_format"] {
        if field_is_set(args, name) {
            return Err(format!(
                "`{name}` configures where this machine sends its API keys; change it there"
            ));
        }
    }
    Ok(())
}

fn field_is_set(args: &serde_json::Value, name: &str) -> bool {
    let camel = to_camel_case(name);
    match args.get(&camel).or_else(|| args.get(name)) {
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
        $( let $arg: $ty = arg($args, stringify!($arg))?; )*
        let out = crate::$($module)::+::$name($app.clone(), $($arg),*).await?;
        serde_json::to_value(out).map_err(|e| e.to_string())
    }};
    (sync, $app:expr, $args:expr, ($($module:ident)::+), $name:ident, ($($arg:ident : $ty:ty),* $(,)?)) => {{
        $( let $arg: $ty = arg($args, stringify!($arg))?; )*
        let out = crate::$($module)::+::$name($app.clone(), $($arg),*)?;
        serde_json::to_value(out).map_err(|e| e.to_string())
    }};
    (local, $app:expr, $args:expr, ($($module:ident)::+), $name:ident, ($($arg:ident : $ty:ty),* $(,)?)) => {
        Err(format!(
            "`{}` is only available on the machine running Meridian",
            stringify!($name)
        ))
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

    /// And what a hand-written request would send.
    #[test]
    fn the_original_spelling_still_works() {
        let args = serde_json::json!({ "conversation_id": "c-1" });
        assert_eq!(arg::<String>(&args, "conversation_id").unwrap(), "c-1");
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
            let args = serde_json::json!({ "key": key });
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
        for key in ["ui.theme", "logging.level", "voice.filter_level"] {
            let args = serde_json::json!({ "key": key });
            assert!(guard_preference("set_preference", &args).is_ok(), "`{key}` should pass");
            assert!(guard_preference("get_preference", &args).is_ok(), "`{key}` should pass");
        }
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
            ("base_url", serde_json::json!("https://evil.example")),
            ("providerType", serde_json::json!("openai")),
            ("apiFormat", serde_json::json!("responses")),
        ] {
            let args = serde_json::json!({ field: value });
            assert!(
                guard_provider_update("update_provider", &args).is_err(),
                "{field} should be refused"
            );
        }
        let rename = serde_json::json!({ "name": "Work", "baseUrl": null, "providerType": null });
        assert!(guard_provider_update("update_provider", &rename).is_ok());
        assert!(guard_provider_update("chat", &serde_json::json!({ "baseUrl": "https://x" })).is_ok());
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
        ];
        expected.sort_unstable();
        expected.retain(|name| COMMAND_NAMES.contains(name));

        assert_eq!(actual, expected);
    }
}
