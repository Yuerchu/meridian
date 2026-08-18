//! Session-scoped QQ tools exposed to the model during OneBot chats.
//!
//! Security: the target group/user is fixed to the current session at
//! construction time and is NOT part of the tool parameters, so the model
//! cannot read or act on other chats. Action tools are admin-only and go
//! through the Y/N chat approval flow — the approver is the message sender,
//! so handing them to non-admins would let users approve themselves.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};

use super::protocol::MessageSegment;
use super::protocol::OneBotAction;
use super::session::{SessionKey, SessionKind};
use super::{SharedState, call_api};

pub const QQ_HISTORY_TOOL: &str = "qq_get_chat_history";
const MAX_HISTORY_COUNT: i64 = 50;
const MAX_OUTPUT_CHARS: usize = 8000;
const MAX_LIKE_TIMES: i64 = 20;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    Any,
    GroupOnly,
    PrivateOnly,
}

struct ToolSpec {
    name: &'static str,
    admin_only: bool,
    needs_approval: bool,
    scope: Scope,
}

const SPECS: &[ToolSpec] = &[
    ToolSpec {
        name: "list_stickers",
        admin_only: false,
        needs_approval: false,
        scope: Scope::Any,
    },
    ToolSpec {
        name: "send_sticker",
        admin_only: false,
        needs_approval: false,
        scope: Scope::Any,
    },
    ToolSpec {
        name: QQ_HISTORY_TOOL,
        admin_only: false,
        needs_approval: false,
        scope: Scope::Any,
    },
    ToolSpec {
        name: "qq_get_group_info",
        admin_only: false,
        needs_approval: false,
        scope: Scope::GroupOnly,
    },
    ToolSpec {
        name: "qq_get_group_member_list",
        admin_only: false,
        needs_approval: false,
        scope: Scope::GroupOnly,
    },
    ToolSpec {
        name: "qq_get_group_member_info",
        admin_only: false,
        needs_approval: false,
        scope: Scope::GroupOnly,
    },
    ToolSpec {
        name: "qq_get_user_info",
        admin_only: false,
        needs_approval: false,
        scope: Scope::PrivateOnly,
    },
    ToolSpec {
        name: "qq_get_friend_list",
        admin_only: true,
        needs_approval: false,
        scope: Scope::Any,
    },
    ToolSpec {
        name: "qq_get_group_list",
        admin_only: true,
        needs_approval: false,
        scope: Scope::Any,
    },
    ToolSpec {
        name: "qq_delete_msg",
        admin_only: true,
        needs_approval: true,
        scope: Scope::Any,
    },
    ToolSpec {
        name: "qq_send_poke",
        admin_only: true,
        needs_approval: true,
        scope: Scope::Any,
    },
    ToolSpec {
        name: "qq_send_like",
        admin_only: true,
        needs_approval: true,
        scope: Scope::Any,
    },
    ToolSpec {
        name: "qq_set_essence_msg",
        admin_only: true,
        needs_approval: true,
        scope: Scope::GroupOnly,
    },
    ToolSpec {
        name: "qq_set_group_ban",
        admin_only: true,
        needs_approval: true,
        scope: Scope::GroupOnly,
    },
    ToolSpec {
        name: "qq_set_group_kick",
        admin_only: true,
        needs_approval: true,
        scope: Scope::GroupOnly,
    },
    ToolSpec {
        name: "qq_set_group_card",
        admin_only: true,
        needs_approval: true,
        scope: Scope::GroupOnly,
    },
    ToolSpec {
        name: "qq_set_group_name",
        admin_only: true,
        needs_approval: true,
        scope: Scope::GroupOnly,
    },
    ToolSpec {
        name: "qq_send_group_notice",
        admin_only: true,
        needs_approval: true,
        scope: Scope::GroupOnly,
    },
];

pub struct QqToolExecutor {
    state: Arc<SharedState>,
    session: SessionKey,
    is_admin: bool,
    self_id: Option<i64>,
    turn_id: String,
}

impl QqToolExecutor {
    pub fn new(
        state: Arc<SharedState>,
        session: SessionKey,
        is_admin: bool,
        self_id: Option<i64>,
        turn_id: String,
    ) -> Self {
        Self {
            state,
            session,
            is_admin,
            self_id,
            turn_id,
        }
    }

    fn available(&self, spec: &ToolSpec) -> bool {
        spec_available(spec, &self.session.kind, self.is_admin)
    }

    pub fn owns(&self, name: &str) -> bool {
        SPECS.iter().any(|s| s.name == name)
    }

    pub fn requires_approval(&self, name: &str) -> bool {
        SPECS.iter().find(|s| s.name == name).is_some_and(|s| s.needs_approval)
    }

    /// What the model is shown, which has to be a property of the *session*
    /// rather than of whoever spoke this turn: the tool array is part of the
    /// prefix a provider caches, and `is_admin` is decided per message
    /// (`handler.rs` reads it off the sender). Filtering this by the speaker
    /// made an admin's turn and an ordinary member's turn two different
    /// prefixes, and in a group where both speak every alternation threw the
    /// whole cache away — the system prompt with it, `base_prompt` being
    /// derived from the tool set.
    ///
    /// So a group shows every QQ tool its scope has and refuses at dispatch
    /// instead. What authorises a call is the loop's `offered` set, which it
    /// checks before every path and which follows the round's own speakers;
    /// `execute` re-checks against this executor. Widening what is *shown* is
    /// only acceptable because these descriptions are our own fixed prose about
    /// the chat the reader is already in. It is not acceptable for the registry
    /// and MCP tools, which carry user-configured server names and schemas —
    /// see `exposes_full_toolset`.
    ///
    /// A private chat has one counterpart, so `is_admin` is already constant
    /// for the life of the session and narrowing by it costs no cache.
    pub fn definitions(&self) -> Vec<crate::provider::ToolDefinition> {
        let shown = shown_as_admin(&self.session.kind, self.is_admin);
        SPECS
            .iter()
            .filter(|s| spec_available(s, &self.session.kind, shown))
            .map(|s| self.definition_for(s.name))
            .collect()
    }

    pub fn session_kind(&self) -> &SessionKind {
        &self.session.kind
    }

    /// What this session comes down to for someone with no admin standing: the
    /// set a round runs on when such a person opened it, and the one a turn
    /// falls back to when they speak into one an admin opened.
    ///
    /// Independent of this executor's own `is_admin` on purpose. That is the
    /// authority the round was *built* with, and the whole point here is to
    /// answer for somebody else.
    pub fn ordinary_names(&self) -> Vec<String> {
        SPECS
            .iter()
            .filter(|s| spec_available(s, &self.session.kind, false))
            .map(|s| s.name.to_string())
            .collect()
    }

    fn definition_for(&self, name: &str) -> crate::provider::ToolDefinition {
        let scope = match self.session.kind {
            SessionKind::Group => "本群",
            SessionKind::Private => "本私聊",
        };
        let no_params = serde_json::json!({ "type": "object", "properties": {} });
        let (description, parameters) = match name {
            "list_stickers" => (
                "列出当前 QQ 机器人账号已确认语义、可发送的表情。返回的 sticker_id 只用于 send_sticker。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "可选的名称或标签筛选" }
                    }
                }),
            ),
            "send_sticker" => (
                "把一个已确认表情作为独立消息发到当前 QQ 会话。每个助手回合最多成功一次，可同时回复文字。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "sticker_id": { "type": "string", "description": "list_stickers 返回的精确 id" }
                    },
                    "required": ["sticker_id"]
                }),
            ),
            QQ_HISTORY_TOOL => (
                format!(
                    "获取当前 QQ 会话({scope})的历史消息记录。用于了解最近的聊天上下文,\
                     例如回答\"刚才聊了什么\"之类的问题。输出末尾会给出继续向前翻页用的 message_seq。"
                ),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "count": {
                            "type": "integer",
                            "description": "获取多少条消息,1-50,默认 20",
                        },
                        "message_seq": {
                            "type": "integer",
                            "description": "从该消息序号继续向前翻页;省略则取最新消息",
                        },
                    },
                }),
            ),
            "qq_get_group_info" => ("获取本群的基本信息(群名、人数等)。".to_string(), no_params),
            "qq_get_group_member_list" => ("获取本群成员列表(名称、QQ号、角色)。".to_string(), no_params),
            "qq_get_group_member_info" => (
                "获取本群某个成员的详细信息(名片、角色、头衔、入群时间等)。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "user_id": { "type": "integer", "description": "成员 QQ 号" },
                    },
                    "required": ["user_id"],
                }),
            ),
            "qq_get_user_info" => ("获取当前私聊对象的资料(昵称等)。".to_string(), no_params),
            "qq_get_friend_list" => ("获取机器人的好友列表。".to_string(), no_params),
            "qq_get_group_list" => ("获取机器人加入的群列表。".to_string(), no_params),
            "qq_delete_msg" => (
                "撤回一条消息(自己发出的,或作为群管理员撤回他人的)。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "message_id": { "type": "integer", "description": "要撤回的消息 ID" },
                    },
                    "required": ["message_id"],
                }),
            ),
            "qq_send_poke" => (
                match self.session.kind {
                    SessionKind::Group => "戳一戳本群的某个成员。".to_string(),
                    SessionKind::Private => "戳一戳当前私聊对象。".to_string(),
                },
                match self.session.kind {
                    SessionKind::Group => serde_json::json!({
                        "type": "object",
                        "properties": {
                            "user_id": { "type": "integer", "description": "要戳的成员 QQ 号" },
                        },
                        "required": ["user_id"],
                    }),
                    SessionKind::Private => no_params,
                },
            ),
            "qq_send_like" => (
                "给某人的资料卡点赞。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "user_id": {
                            "type": "integer",
                            "description": "点赞对象 QQ 号;私聊中省略则默认当前对象",
                        },
                        "times": { "type": "integer", "description": "点赞次数,1-20,默认 10" },
                    },
                }),
            ),
            "qq_set_essence_msg" => (
                "将本群的一条消息设为精华消息。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "message_id": { "type": "integer", "description": "消息 ID" },
                    },
                    "required": ["message_id"],
                }),
            ),
            "qq_set_group_ban" => (
                "禁言本群成员。duration 为秒数,0 表示解除禁言。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "user_id": { "type": "integer", "description": "成员 QQ 号" },
                        "duration": { "type": "integer", "description": "禁言秒数,0 解除,默认 600" },
                    },
                    "required": ["user_id"],
                }),
            ),
            "qq_set_group_kick" => (
                "将成员移出本群。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "user_id": { "type": "integer", "description": "成员 QQ 号" },
                    },
                    "required": ["user_id"],
                }),
            ),
            "qq_set_group_card" => (
                "设置本群成员的群名片。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "user_id": { "type": "integer", "description": "成员 QQ 号" },
                        "card": { "type": "string", "description": "新的群名片,空字符串表示清除" },
                    },
                    "required": ["user_id", "card"],
                }),
            ),
            "qq_set_group_name" => (
                "修改本群的群名。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "name": { "type": "string", "description": "新的群名" },
                    },
                    "required": ["name"],
                }),
            ),
            "qq_send_group_notice" => (
                "发布本群的群公告。".to_string(),
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "content": { "type": "string", "description": "公告内容" },
                    },
                    "required": ["content"],
                }),
            ),
            _ => (String::new(), no_params),
        };
        crate::provider::ToolDefinition {
            name: name.into(),
            description,
            parameters,
        }
    }

    pub async fn execute(&self, name: &str, arguments: &str) -> Result<String, String> {
        let spec = SPECS
            .iter()
            .find(|s| s.name == name)
            .ok_or_else(|| format!("Unknown QQ tool: {name}"))?;
        // The offered-tools gate in the agent loop already blocks unavailable
        // tools; this re-check is defense in depth.
        if !self.available(spec) {
            return Err(format!("Tool {name} is not available in this session"));
        }
        let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_else(|_| serde_json::json!({}));

        match name {
            "list_stickers" => self.list_stickers(&args).await,
            "send_sticker" => self.send_sticker(&args).await,
            QQ_HISTORY_TOOL => self.get_chat_history(&args).await,
            "qq_get_group_info" => self.get_group_info().await,
            "qq_get_group_member_list" => self.get_group_member_list().await,
            "qq_get_group_member_info" => {
                let user_id = require_i64(&args, "user_id")?;
                self.get_group_member_info(user_id).await
            }
            "qq_get_user_info" => self.get_user_info().await,
            "qq_get_friend_list" => self.get_friend_list().await,
            "qq_get_group_list" => self.get_group_list().await,
            "qq_delete_msg" => {
                let message_id = require_i64(&args, "message_id")?;
                call_api(&self.state, OneBotAction::delete_msg(message_id, echo())).await?;
                Ok(format!("已撤回消息 {message_id}"))
            }
            "qq_send_poke" => {
                let (user_id, group_id) = match self.session.kind {
                    SessionKind::Group => (require_i64(&args, "user_id")?, Some(self.session.id)),
                    SessionKind::Private => (self.session.id, None),
                };
                call_api(&self.state, OneBotAction::send_poke(user_id, group_id, echo())).await?;
                Ok("已发送戳一戳".into())
            }
            "qq_send_like" => {
                let user_id = match get_i64(&args, "user_id") {
                    Some(id) => id,
                    None if self.session.kind == SessionKind::Private => self.session.id,
                    None => return Err("missing required parameter: user_id".into()),
                };
                let times = get_i64(&args, "times").unwrap_or(10).clamp(1, MAX_LIKE_TIMES);
                call_api(&self.state, OneBotAction::send_like(user_id, times, echo())).await?;
                Ok(format!("已给 {user_id} 点赞 {times} 次"))
            }
            "qq_set_essence_msg" => {
                let message_id = require_i64(&args, "message_id")?;
                call_api(&self.state, OneBotAction::set_essence_msg(message_id, echo())).await?;
                Ok("已设为精华消息".into())
            }
            "qq_set_group_ban" => {
                let user_id = require_i64(&args, "user_id")?;
                let duration = get_i64(&args, "duration").unwrap_or(600).max(0);
                call_api(
                    &self.state,
                    OneBotAction::set_group_ban(self.session.id, user_id, duration, echo()),
                )
                .await?;
                Ok(if duration > 0 {
                    format!("已禁言 {user_id} {duration} 秒")
                } else {
                    format!("已解除 {user_id} 的禁言")
                })
            }
            "qq_set_group_kick" => {
                let user_id = require_i64(&args, "user_id")?;
                call_api(
                    &self.state,
                    OneBotAction::set_group_kick(self.session.id, user_id, echo()),
                )
                .await?;
                Ok(format!("已将 {user_id} 移出本群"))
            }
            "qq_set_group_card" => {
                let user_id = require_i64(&args, "user_id")?;
                let card = args.get("card").and_then(|v| v.as_str()).unwrap_or("");
                call_api(
                    &self.state,
                    OneBotAction::set_group_card(self.session.id, user_id, card, echo()),
                )
                .await?;
                Ok(format!("已设置 {user_id} 的群名片"))
            }
            "qq_set_group_name" => {
                let name_arg = args
                    .get("name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .ok_or("missing required parameter: name")?;
                call_api(
                    &self.state,
                    OneBotAction::set_group_name(self.session.id, name_arg, echo()),
                )
                .await?;
                Ok("已修改群名".into())
            }
            "qq_send_group_notice" => {
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .ok_or("missing required parameter: content")?;
                call_api(
                    &self.state,
                    OneBotAction::send_group_notice(self.session.id, content, echo()),
                )
                .await?;
                Ok("已发布群公告".into())
            }
            _ => Err(format!("Unknown QQ tool: {name}")),
        }
    }

    async fn list_stickers(&self, args: &serde_json::Value) -> Result<String, String> {
        let self_id = self.self_id.ok_or("OneBot event did not include self_id")?.to_string();
        let query = args
            .get("query")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let pool = self.state.pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let Some(pack) =
                crate::db::ops::emoji_pack::get_by_source_account(&mut conn, &self_id).map_err(|e| e.to_string())?
            else {
                return Ok("[]".to_string());
            };
            let stickers =
                crate::db::ops::emoji::list_confirmed_for_packs(&mut conn, &[pack.id]).map_err(|e| e.to_string())?;
            let values: Vec<_> = stickers
                .into_iter()
                .filter(|sticker| {
                    query.is_empty()
                        || format!("{} {}", sticker.name, sticker.tags.as_deref().unwrap_or(""))
                            .to_lowercase()
                            .contains(&query)
                })
                .take(100)
                .map(|sticker| {
                    serde_json::json!({
                        "sticker_id": sticker.id,
                        "name": sticker.name,
                        "tags": sticker.tags,
                    })
                })
                .collect();
            serde_json::to_string(&values).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    async fn send_sticker(&self, args: &serde_json::Value) -> Result<String, String> {
        static SENT_TURNS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
        let sticker_id = args
            .get("sticker_id")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .ok_or("missing required parameter: sticker_id")?
            .to_string();
        {
            let sent = SENT_TURNS
                .get_or_init(Default::default)
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if sent.contains(&self.turn_id) {
                return Err("A sticker has already been sent in this turn".into());
            }
        }
        let self_id = self.self_id.ok_or("OneBot event did not include self_id")?.to_string();
        let pool = self.state.pool.clone();
        let app = self.state.app_handle.clone();
        let sticker = tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            let pack = crate::db::ops::emoji_pack::get_by_source_account(&mut conn, &self_id)
                .map_err(|e| e.to_string())?
                .ok_or("No sticker pool exists for this bot account")?;
            let sticker = crate::db::ops::emoji::get_emoji(&mut conn, &sticker_id)
                .map_err(|_| "Unknown sticker id".to_string())?;
            if sticker.pack_id != pack.id || sticker.semantic_status != "confirmed" {
                return Err("That sticker is not in this bot account's confirmed roster".into());
            }
            Ok::<_, String>(sticker)
        })
        .await
        .map_err(|e| e.to_string())??;

        let payload = sticker
            .native_payload
            .as_deref()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        let cached_image = || -> Result<MessageSegment, String> {
            use base64::Engine;
            use tauri::Manager;
            if sticker.file_name.is_empty() {
                return Err("Sticker has no cached image fallback".into());
            }
            let app = app.as_ref().ok_or("no app handle")?;
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let path = crate::emoji::emoji_path(&data_dir, &sticker.pack_id, &sticker.file_name);
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
            Ok(MessageSegment::image(&format!("base64://{encoded}")))
        };
        let send = |segment: MessageSegment, echo: String| match self.session.kind {
            SessionKind::Group => OneBotAction::send_group_msg(self.session.id, vec![segment]).with_echo(echo),
            SessionKind::Private => OneBotAction::send_private_msg(self.session.id, vec![segment]).with_echo(echo),
        };

        let first = match sticker.source.as_str() {
            "onebot_face" => MessageSegment::raw("face", payload),
            "onebot_mface" => MessageSegment::raw("mface", payload),
            _ => cached_image()?,
        };
        let direct = call_api(&self.state, send(first, echo())).await;
        if let Err(error) = direct {
            if sticker.source != "onebot_mface" {
                return Err(error);
            }
            call_api(&self.state, send(cached_image()?, echo())).await?;
        }

        let mut sent = SENT_TURNS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if sent.len() >= 4096 {
            sent.clear();
        }
        sent.insert(self.turn_id.clone());
        serde_json::to_string(&serde_json::json!({
            "sticker_id": sticker.id,
            "name": sticker.name,
        }))
        .map_err(|e| e.to_string())
    }

    async fn get_chat_history(&self, args: &serde_json::Value) -> Result<String, String> {
        let count = get_i64(args, "count").unwrap_or(20).clamp(1, MAX_HISTORY_COUNT);
        let message_seq = get_i64(args, "message_seq").filter(|s| *s > 0);

        let action = match self.session.kind {
            SessionKind::Group => OneBotAction::get_group_msg_history(self.session.id, message_seq, count, echo()),
            SessionKind::Private => OneBotAction::get_friend_msg_history(self.session.id, message_seq, count, echo()),
        };

        let data = call_api(&self.state, action).await?;
        let messages = data
            .get("messages")
            .and_then(|m| m.as_array())
            .ok_or("no messages in response")?;
        if messages.is_empty() {
            return Ok("没有获取到历史消息".into());
        }
        Ok(format_history(messages))
    }

    async fn get_group_info(&self) -> Result<String, String> {
        let data = call_api(&self.state, OneBotAction::get_group_info(self.session.id, echo())).await?;
        let name = data.get("group_name").and_then(|v| v.as_str()).unwrap_or("?");
        let mut out = format!("群名: {name}\n群号: {}", self.session.id);
        if let Some(n) = data.get("member_count").and_then(|v| v.as_i64()) {
            let max = data
                .get("max_member_count")
                .and_then(|v| v.as_i64())
                .map(|m| format!("/{m}"))
                .unwrap_or_default();
            out.push_str(&format!("\n成员数: {n}{max}"));
        }
        Ok(out)
    }

    async fn get_group_member_list(&self) -> Result<String, String> {
        let data = call_api(
            &self.state,
            OneBotAction::get_group_member_list(self.session.id, echo()),
        )
        .await?;
        let members = data.as_array().ok_or("unexpected member list response")?;
        let mut lines = Vec::with_capacity(members.len() + 1);
        lines.push(format!("本群共 {} 人:", members.len()));
        for m in members {
            let name = m
                .get("card")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| m.get("nickname").and_then(|v| v.as_str()))
                .unwrap_or("?");
            let id = m.get("user_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let role = match m.get("role").and_then(|v| v.as_str()) {
                Some("owner") => " [群主]",
                Some("admin") => " [管理员]",
                _ => "",
            };
            lines.push(format!("{name}({id}){role}"));
        }
        Ok(truncate_head(lines.join("\n")))
    }

    async fn get_group_member_info(&self, user_id: i64) -> Result<String, String> {
        let data = call_api(
            &self.state,
            OneBotAction::get_group_member_info(self.session.id, user_id, echo()),
        )
        .await?;
        let mut out = Vec::new();
        let nickname = data.get("nickname").and_then(|v| v.as_str()).unwrap_or("?");
        out.push(format!("昵称: {nickname}"));
        if let Some(card) = data.get("card").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            out.push(format!("群名片: {card}"));
        }
        out.push(format!("QQ号: {user_id}"));
        let role = match data.get("role").and_then(|v| v.as_str()) {
            Some("owner") => "群主",
            Some("admin") => "管理员",
            _ => "成员",
        };
        out.push(format!("角色: {role}"));
        if let Some(title) = data.get("title").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            out.push(format!("头衔: {title}"));
        }
        if let Some(ts) = data.get("join_time").and_then(|v| v.as_i64()).filter(|t| *t > 0)
            && let Some(dt) = chrono::DateTime::from_timestamp(ts, 0)
        {
            out.push(format!(
                "入群时间: {}",
                dt.with_timezone(&chrono::Local).format("%Y-%m-%d")
            ));
        }
        Ok(out.join("\n"))
    }

    async fn get_user_info(&self) -> Result<String, String> {
        let data = call_api(&self.state, OneBotAction::get_stranger_info(self.session.id, echo())).await?;
        let nickname = data.get("nickname").and_then(|v| v.as_str()).unwrap_or("?");
        let mut out = format!("昵称: {nickname}\nQQ号: {}", self.session.id);
        if let Some(sign) = data.get("sign").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            out.push_str(&format!("\n签名: {sign}"));
        }
        Ok(out)
    }

    async fn get_friend_list(&self) -> Result<String, String> {
        let data = call_api(&self.state, OneBotAction::get_friend_list(echo())).await?;
        let friends = data.as_array().ok_or("unexpected friend list response")?;
        let mut lines = Vec::with_capacity(friends.len() + 1);
        lines.push(format!("共 {} 位好友:", friends.len()));
        for f in friends {
            let name = f
                .get("remark")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| f.get("nickname").and_then(|v| v.as_str()))
                .unwrap_or("?");
            let id = f.get("user_id").and_then(|v| v.as_i64()).unwrap_or(0);
            lines.push(format!("{name}({id})"));
        }
        Ok(truncate_head(lines.join("\n")))
    }

    async fn get_group_list(&self) -> Result<String, String> {
        let data = call_api(&self.state, OneBotAction::get_group_list(echo())).await?;
        let groups = data.as_array().ok_or("unexpected group list response")?;
        let mut lines = Vec::with_capacity(groups.len() + 1);
        lines.push(format!("共加入 {} 个群:", groups.len()));
        for g in groups {
            let name = g.get("group_name").and_then(|v| v.as_str()).unwrap_or("?");
            let id = g.get("group_id").and_then(|v| v.as_i64()).unwrap_or(0);
            lines.push(format!("{name}({id})"));
        }
        Ok(truncate_head(lines.join("\n")))
    }
}

/// Static catalog for the settings UI: tool names plus the flags that drive
/// the availability badges. Display names/descriptions are localized on the
/// frontend by tool name.
pub fn catalog() -> Vec<serde_json::Value> {
    SPECS
        .iter()
        .map(|s| {
            let scope = match s.scope {
                Scope::Any => "any",
                Scope::GroupOnly => "group",
                Scope::PrivateOnly => "private",
            };
            serde_json::json!({
                "name": s.name,
                "description": "",
                "source": "onebot",
                "admin_only": s.admin_only,
                "needs_approval": s.needs_approval,
                "scope": scope,
            })
        })
        .collect()
}

/// Whose view of the QQ tool set this session shows. A group's has to be one
/// view for everyone in it, because the speaker changes between turns and the
/// tool array is cached prefix; a private chat's counterpart never changes, so
/// its view can stay as narrow as it always was.
fn shown_as_admin(kind: &SessionKind, is_admin: bool) -> bool {
    match kind {
        SessionKind::Group => true,
        SessionKind::Private => is_admin,
    }
}

/// Whether this session may be sent the registry and MCP tool definitions at
/// all.
///
/// Only a private chat with an admin. Those definitions carry names, prose and
/// argument schemas that come from the user's own configuration — an MCP server
/// is routinely pointed at internal systems — and a group cannot show them to
/// one member without showing them to everyone present, because one tool array
/// is all a session gets. The narrower QQ set stays available to a group and is
/// safe to (see `definitions`).
///
/// An admin who needs the full set in a group has the same conversation with
/// the bot in private.
pub(super) fn exposes_full_toolset(kind: &SessionKind, is_admin: bool) -> bool {
    is_admin && *kind == SessionKind::Private
}

fn spec_available(spec: &ToolSpec, kind: &SessionKind, is_admin: bool) -> bool {
    if spec.admin_only && !is_admin {
        return false;
    }
    match spec.scope {
        Scope::Any => true,
        Scope::GroupOnly => *kind == SessionKind::Group,
        Scope::PrivateOnly => *kind == SessionKind::Private,
    }
}

fn echo() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn get_i64(args: &serde_json::Value, key: &str) -> Option<i64> {
    args.get(key)
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
}

fn require_i64(args: &serde_json::Value, key: &str) -> Result<i64, String> {
    get_i64(args, key).ok_or_else(|| format!("missing required parameter: {key}"))
}

/// Keep the head of an over-long listing (the interesting part for lists).
fn truncate_head(text: String) -> String {
    if text.chars().count() <= MAX_OUTPUT_CHARS {
        return text;
    }
    let cut = text
        .char_indices()
        .nth(MAX_OUTPUT_CHARS)
        .map(|(i, _)| i)
        .unwrap_or(text.len());
    format!("{}\n(更多条目已截断)", &text[..cut])
}

fn format_history(messages: &[serde_json::Value]) -> String {
    let mut lines = Vec::with_capacity(messages.len());
    let mut min_seq: Option<i64> = None;
    for msg in messages {
        if let Some(seq) = msg.get("message_seq").and_then(|v| v.as_i64()).filter(|s| *s > 0) {
            min_seq = Some(min_seq.map_or(seq, |m: i64| m.min(seq)));
        }
        let time = msg
            .get("time")
            .and_then(|v| v.as_i64())
            .and_then(|ts| chrono::DateTime::from_timestamp(ts, 0))
            .map(|dt| dt.with_timezone(&chrono::Local).format("%m-%d %H:%M").to_string())
            .unwrap_or_default();
        let sender = msg
            .get("sender")
            .map(|s| {
                s.get("card")
                    .and_then(|v| v.as_str())
                    .filter(|c| !c.is_empty())
                    .or_else(|| s.get("nickname").and_then(|v| v.as_str()))
                    .unwrap_or("?")
            })
            .unwrap_or("?");
        let text = msg
            .get("message")
            .map(|m| super::format::segments_to_text(m, None))
            .filter(|t| !t.is_empty())
            .or_else(|| msg.get("raw_message").and_then(|v| v.as_str()).map(String::from))
            .unwrap_or_default();
        if text.is_empty() {
            continue;
        }
        lines.push(format!("[{time}] {sender}: {text}"));
    }

    let mut out = lines.join("\n");
    let char_count = out.chars().count();
    if char_count > MAX_OUTPUT_CHARS {
        let skip = char_count - MAX_OUTPUT_CHARS;
        let cut = out.char_indices().nth(skip).map(|(i, _)| i).unwrap_or(0);
        out = format!("(更早的消息已截断)\n{}", &out[cut..]);
    }
    if let Some(seq) = min_seq {
        out.push_str(&format!("\n(如需更早的消息,传入 message_seq={seq} 继续向前翻页)"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(kind: SessionKind, is_admin: bool) -> Vec<&'static str> {
        SPECS
            .iter()
            .filter(|s| spec_available(s, &kind, is_admin))
            .map(|s| s.name)
            .collect()
    }

    /// What a session shows and what a speaker may run are two questions, and
    /// only the second one is about who spoke. A group gets one tool array
    /// however many people talk into it, because that array is part of the
    /// prefix the provider caches — it used to be rebuilt per message, so an
    /// admin and an ordinary member alternating threw the cache away on every
    /// turn.
    #[test]
    fn a_group_shows_one_tool_set_whoever_spoke() {
        let shown_to_admin = names(SessionKind::Group, shown_as_admin(&SessionKind::Group, true));
        let shown_to_member = names(SessionKind::Group, shown_as_admin(&SessionKind::Group, false));
        assert_eq!(shown_to_admin, shown_to_member);

        // And the widening stops at what is shown: an ordinary member may still
        // only run the read-only ones, which is what `ordinary_names` returns
        // and the loop checks before dispatch.
        let permitted = names(SessionKind::Group, false);
        assert!(permitted.len() < shown_to_member.len());
        assert!(permitted.iter().all(|n| shown_to_member.contains(n)));
        assert!(!permitted.contains(&"qq_set_group_ban"));
    }

    /// A private chat has one counterpart, so `is_admin` cannot change under it
    /// and narrowing costs no cache — which leaves no reason to show somebody
    /// tools they will only be refused.
    #[test]
    fn a_private_chat_shows_nothing_its_counterpart_cannot_run() {
        let shown = names(SessionKind::Private, shown_as_admin(&SessionKind::Private, false));
        assert_eq!(shown, names(SessionKind::Private, false));
        assert!(!shown.contains(&"qq_delete_msg"));
    }

    /// The registry and MCP definitions carry the user's own server names,
    /// prose and argument schemas. A group is one tool array shared by everyone
    /// present, so showing them to its admin would be showing them to the room.
    #[test]
    fn only_an_admin_in_private_is_sent_the_registry_and_mcp_tools() {
        assert!(exposes_full_toolset(&SessionKind::Private, true));
        assert!(!exposes_full_toolset(&SessionKind::Private, false));
        assert!(
            !exposes_full_toolset(&SessionKind::Group, true),
            "a group cannot show these to one member alone",
        );
        assert!(!exposes_full_toolset(&SessionKind::Group, false));
    }

    #[test]
    fn test_non_admin_group_gets_query_tools_only() {
        let n = names(SessionKind::Group, false);
        assert!(n.contains(&"list_stickers"));
        assert!(n.contains(&"send_sticker"));
        assert!(n.contains(&QQ_HISTORY_TOOL));
        assert!(n.contains(&"qq_get_group_member_list"));
        assert!(!n.contains(&"qq_get_user_info"), "private-only tool absent in groups");
        assert!(!n.contains(&"qq_set_group_ban"), "action tools are admin-only");
        assert!(!n.contains(&"qq_get_friend_list"), "bot-global reads are admin-only");
    }

    #[test]
    fn test_non_admin_private_scope() {
        let n = names(SessionKind::Private, false);
        assert!(n.contains(&QQ_HISTORY_TOOL));
        assert!(n.contains(&"qq_get_user_info"));
        assert!(!n.contains(&"qq_get_group_member_list"));
        assert!(!n.contains(&"qq_delete_msg"));
    }

    #[test]
    fn test_admin_group_gets_action_tools() {
        let n = names(SessionKind::Group, true);
        assert!(n.contains(&"qq_set_group_ban"));
        assert!(n.contains(&"qq_send_group_notice"));
        assert!(n.contains(&"qq_get_friend_list"));
        assert!(!n.contains(&"qq_get_user_info"), "still group-scoped");
    }

    #[test]
    fn test_admin_private_excludes_group_actions() {
        let n = names(SessionKind::Private, true);
        assert!(n.contains(&"qq_delete_msg"));
        assert!(n.contains(&"qq_send_poke"));
        assert!(!n.contains(&"qq_set_group_kick"));
    }

    #[test]
    fn test_action_tools_require_approval_queries_do_not() {
        let approval_needed: Vec<_> = SPECS.iter().filter(|s| s.needs_approval).map(|s| s.name).collect();
        assert!(approval_needed.contains(&"qq_set_group_ban"));
        assert!(approval_needed.contains(&"qq_delete_msg"));
        assert!(!approval_needed.contains(&QQ_HISTORY_TOOL));
        assert!(!approval_needed.contains(&"send_sticker"));
        assert!(!approval_needed.contains(&"qq_get_group_member_list"));
        // Every approval-gated tool is also admin-only.
        assert!(SPECS.iter().filter(|s| s.needs_approval).all(|s| s.admin_only));
    }

    #[test]
    fn test_format_history_paging_footer() {
        let messages = vec![
            serde_json::json!({
                "time": 1700000000, "message_seq": 120,
                "sender": {"nickname": "甲"},
                "message": [{"type": "text", "data": {"text": "hello"}}],
            }),
            serde_json::json!({
                "time": 1700000060, "message_seq": 121,
                "sender": {"nickname": "乙"},
                "message": [{"type": "text", "data": {"text": "world"}}],
            }),
        ];
        let out = format_history(&messages);
        assert!(out.contains("甲: hello"));
        assert!(
            out.contains("message_seq=120"),
            "footer points at the oldest seq: {out}"
        );
    }

    #[test]
    fn test_format_history_no_footer_without_seq() {
        let messages = vec![serde_json::json!({
            "time": 1700000000,
            "sender": {"nickname": "甲"},
            "message": [{"type": "text", "data": {"text": "hi"}}],
        })];
        let out = format_history(&messages);
        assert!(!out.contains("message_seq="));
    }
}
