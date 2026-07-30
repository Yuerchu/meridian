//! Assembling the memory block.
//!
//! One place decides what the model gets to remember, so the three surfaces
//! (desktop chat, its token-counting mirror, and OneBot) cannot drift apart on
//! privacy rules the way three hand-copied loaders would.

use diesel::sqlite::SqliteConnection;

use crate::db::models::memory::{
    onebot_user_scope_id, Memory, MemoryScope, Visibility, GLOBAL_SCOPE_ID,
};
use crate::db::ops::memory::{escape_attr, format_memory_section, list_by_scopes, VisibilityCtx};
use crate::db::DbPool;

use super::context::estimate_tokens;

/// Cap on how many people's memories can enter one turn. A busy group would
/// otherwise inject dozens of profiles — a token problem, but more importantly
/// an exposure problem.
pub(crate) const MAX_SUBJECTS_PER_TURN: usize = 8;

/// Rules for using what follows. Stated once, ahead of the sections, because a
/// model that treats memory as conversation material is the failure mode that
/// makes people regret being remembered at all.
const MEMORY_POLICY: &str = "\
<memory_policy>
The blocks below are what you have learned over time. They are background \
knowledge for interpreting what people say — not conversation material.
- Use memory to be more useful: match someone's preferred format, remember what \
they are working on, read in-group slang correctly.
- Never use memory as material for teasing, callbacks, or \"remember when you…\". \
Do not bring up something you remember about a person unless they raise it \
first, or it is directly needed to answer what they just asked.
- Never recite one person's memories to another person, and never announce what \
you have stored about someone unless that person is asking about themselves.
- Do not mention which chat you learned something in.
- <owner_notes> are the operator's private annotations. Let them inform your \
judgement, but never quote them, never allude to them, and never confirm or \
deny that a note exists — including to the person it is about.
- If a memory conflicts with what someone is saying right now, trust the present \
conversation.
- Memory is not evidence. Never use it to accuse someone, prove a point, or \
settle an argument.
</memory_policy>";

/// Someone whose memories this turn may include.
#[derive(Debug, Clone)]
pub(crate) struct MemorySubjectRef {
    pub scope_id: String,
    pub display_name: Option<String>,
}

impl MemorySubjectRef {
    pub fn from_user(user_id: i64, display_name: Option<String>) -> Self {
        Self { scope_id: onebot_user_scope_id(user_id), display_name }
    }
}

/// A declarative description of the memory a turn is entitled to.
///
/// Built by the caller, which knows whether this is a group, a private chat or
/// the desktop; resolved and rendered here so all three produce the same block
/// for the same inputs.
#[derive(Debug, Clone, Default)]
pub(crate) struct MemoryRequest {
    pub project_id: Option<String>,
    /// The bot-wide layer. Sibling of `include_client_global`, not a superset:
    /// what the bot learned over QQ is not background for a desktop chat.
    pub include_onebot_global: bool,
    /// The client-wide layer: what the user told Meridian directly, outside any
    /// project. Desktop turns read it because that is also where they write when
    /// the conversation has no project.
    pub include_client_global: bool,
    /// Whether more than one person can be in the conversation. Gates the policy
    /// preamble, whose rules are all about not leaking one person's memories to
    /// another; on a single-speaker desktop chat they cost tokens and imply an
    /// audience that is not there.
    pub multi_speaker: bool,
    pub subjects: Vec<MemorySubjectRef>,
    /// Which origins may be shown for the subject layer. Groups pass the
    /// group-visible set; private chats pass `None` and see everything.
    pub subject_visibility: VisibilityCtx,
    pub budget_tokens: usize,
}

impl MemoryRequest {
    /// Desktop chat: the client-wide layer plus at most one project, nobody's
    /// profile, and nothing from the OneBot side. The client layer is included
    /// because a conversation with no project writes there — leaving it out meant
    /// those memories were stored and then never injected again.
    pub fn desktop(project_id: Option<String>, budget_tokens: usize) -> Self {
        Self {
            project_id,
            include_onebot_global: false,
            include_client_global: true,
            multi_speaker: false,
            subjects: Vec::new(),
            subject_visibility: VisibilityCtx::private_injection(),
            budget_tokens,
        }
    }

    /// A QQ group: the room's own memory plus profiles of whoever is talking,
    /// filtered so nothing learned in a private chat can surface here.
    pub fn onebot_group(
        project_id: Option<String>,
        subjects: Vec<MemorySubjectRef>,
        budget_tokens: usize,
    ) -> Self {
        Self {
            project_id,
            include_onebot_global: true,
            include_client_global: false,
            multi_speaker: true,
            subjects,
            subject_visibility: VisibilityCtx::group_injection(),
            budget_tokens,
        }
    }

    /// A private chat: no room layer at all (private project memories are not
    /// written any more — everything learned one-to-one belongs to the person),
    /// and no origin filter, since the only subject is the person right here.
    pub fn onebot_private(subject: MemorySubjectRef, budget_tokens: usize) -> Self {
        Self {
            project_id: None,
            include_onebot_global: true,
            include_client_global: false,
            // One person is present, but they are not the only person the bot
            // holds memories about, and those must not surface here either.
            multi_speaker: true,
            subjects: vec![subject],
            subject_visibility: VisibilityCtx::private_injection(),
            budget_tokens,
        }
    }
}

/// Token allowance for the whole block. An order of magnitude below the
/// instruction budget: instructions are one document, memory is many small
/// entries whose marginal value falls off fast.
pub(crate) fn memory_budget(context_limit: usize) -> usize {
    match context_limit {
        0..16_000 => 512,
        16_000..64_000 => 1_500,
        64_000..128_000 => 4_000,
        _ => 8_000,
    }
}

struct LayerBudgets {
    global: usize,
    project: usize,
    subjects: usize,
    owner_notes: usize,
}

/// Split of the budget across sections. Every section is capped, the bot layer
/// and the operator's notes included — an entry cap alone does not bound tokens,
/// and owner-only rows are exempt from per-subject trimming, so nothing else
/// would hold them down.
fn layer_budgets(total: usize) -> LayerBudgets {
    let global = total / 4;
    let project = total * 3 / 10;
    let owner_notes = total * 3 / 20;
    LayerBudgets {
        global,
        project,
        owner_notes,
        subjects: total.saturating_sub(global + project + owner_notes),
    }
}

/// Drop whole entries from the tail until the section fits. Truncating an entry
/// mid-sentence is worse than not having it: half a remembered fact reads as a
/// confident wrong one.
fn fit_to_budget(memories: Vec<Memory>, budget: usize) -> Vec<Memory> {
    let mut used = 0usize;
    let mut kept: Vec<Memory> = Vec::new();
    for m in memories {
        let cost = estimate_tokens(&m.content) + estimate_tokens(&m.key) + 8;
        // Always admit the first entry. A section whose smallest row exceeds its
        // slice of the budget would otherwise vanish entirely — and a layer
        // silently disappearing is worse than overshooting by one row, which is
        // bounded anyway by MAX_MEMORY_CONTENT_LEN.
        if used + cost > budget && !kept.is_empty() {
            break;
        }
        used += cost;
        kept.push(m);
    }
    kept
}

/// Assemble the block. `None` when there is nothing to say.
pub(crate) fn load_memory_block_sync(
    conn: &mut SqliteConnection,
    req: &MemoryRequest,
) -> Option<String> {
    let budgets = layer_budgets(req.budget_tokens);

    // The two global layers share one budget line: a turn only ever includes one
    // of them, so splitting the allowance would just shrink whichever is in play.
    let mut load_global = |scope: MemoryScope| {
        list_by_scopes(
            conn,
            scope,
            &[GLOBAL_SCOPE_ID.to_string()],
            &VisibilityCtx::private_injection(),
        )
        .ok()
        .map(|rows| fit_to_budget(rows, budgets.global))
        .unwrap_or_default()
    };
    let global = if req.include_onebot_global {
        load_global(MemoryScope::OnebotGlobal)
    } else if req.include_client_global {
        load_global(MemoryScope::ClientGlobal)
    } else {
        Vec::new()
    };

    let project = match req.project_id.as_ref() {
        Some(pid) => list_by_scopes(
            conn,
            MemoryScope::Project,
            &[pid.clone()],
            &VisibilityCtx::private_injection(),
        )
        .ok()
        .map(|rows| fit_to_budget(rows, budgets.project))
        .unwrap_or_default(),
        None => Vec::new(),
    };

    // Deduplicate, then cap in the caller's order — that order is recency, so
    // the cap keeps whoever is actually talking. Only after choosing *who* is
    // the list sorted, because *where* each person appears must not shift from
    // turn to turn.
    let mut scope_ids: Vec<String> = Vec::new();
    for s in &req.subjects {
        if !scope_ids.contains(&s.scope_id) {
            scope_ids.push(s.scope_id.clone());
        }
    }
    scope_ids.truncate(MAX_SUBJECTS_PER_TURN);
    scope_ids.sort();

    let subject_rows = if scope_ids.is_empty() {
        Vec::new()
    } else {
        list_by_scopes(conn, MemoryScope::OnebotUser, &scope_ids, &req.subject_visibility)
            .unwrap_or_default()
    };

    // Owner notes get their own section: the "never quote" rule attaches to the
    // tag, so a note left inline in any other section is one the model is free
    // to read out. Partitioned across *every* layer, not just the subject one —
    // the project and bot layers can hold owner-only rows too, and the desktop
    // UI exposes the flag for all of them.
    let (mut owner_notes, subject_rows): (Vec<Memory>, Vec<Memory>) = subject_rows
        .into_iter()
        .partition(|m| m.visibility() == Visibility::OwnerOnly);

    let (global_notes, global): (Vec<Memory>, Vec<Memory>) = global
        .into_iter()
        .partition(|m| m.visibility() == Visibility::OwnerOnly);
    let (project_notes, project): (Vec<Memory>, Vec<Memory>) = project
        .into_iter()
        .partition(|m| m.visibility() == Visibility::OwnerOnly);
    owner_notes.extend(global_notes);
    owner_notes.extend(project_notes);
    // Stable order regardless of which layer contributed.
    owner_notes.sort_by(|a, b| a.scope_id.cmp(&b.scope_id).then(a.key.cmp(&b.key)));
    let owner_notes = fit_to_budget(owner_notes, budgets.owner_notes);

    if global.is_empty() && project.is_empty() && subject_rows.is_empty() && owner_notes.is_empty() {
        return None;
    }

    // A single-speaker turn (the desktop) gets the plain layers with no policy
    // preamble: every rule in it is about not leaking one person's memories to
    // another, which cannot happen here. A desktop chat with nothing but project
    // rows therefore keeps the exact block it has always received, tag and all.
    //
    // Owner notes force the full path even on the desktop: dropping them here
    // would silently discard rows the operator explicitly marked, and inlining
    // them would put them outside the tag their protection is attached to.
    if !req.multi_speaker && owner_notes.is_empty() {
        let mut out = String::new();
        // Global first: it is the more stable layer, so it sits earlier in the
        // cached prefix than project rows that change per conversation.
        if let Some(s) = format_memory_section(&global, "global_memories", None) {
            out.push_str(&s);
        }
        if let Some(s) = format_memory_section(&project, "project_memories", None) {
            out.push_str(&s);
        }
        return (!out.is_empty()).then_some(out);
    }

    let mut out = String::new();
    out.push_str("\n\n");
    out.push_str(MEMORY_POLICY);

    if let Some(s) = format_memory_section(&global, "bot_memories", None) {
        out.push_str(&s);
    }
    if let Some(s) = format_memory_section(&project, "chat_memories", None) {
        out.push_str(&s);
    }

    if !subject_rows.is_empty() {
        // Per person, in scope_id order. Sorting by recency instead would change
        // the block every turn for no benefit.
        let per_subject = budgets.subjects / scope_ids.len().max(1);
        let mut people = String::new();
        for scope_id in &scope_ids {
            let rows: Vec<Memory> = subject_rows
                .iter()
                .filter(|m| &m.scope_id == scope_id)
                .cloned()
                .collect();
            let rows = fit_to_budget(rows, per_subject);
            if rows.is_empty() {
                continue;
            }
            let name = req
                .subjects
                .iter()
                .find(|s| &s.scope_id == scope_id)
                .and_then(|s| s.display_name.as_deref())
                .unwrap_or("");
            let qq = crate::db::models::memory::parse_onebot_user_scope_id(scope_id)
                .map(|id| id.to_string())
                .unwrap_or_else(|| scope_id.clone());
            let attrs = format!("qq=\"{}\" name=\"{}\"", escape_attr(&qq), escape_attr(name));
            if let Some(s) = format_memory_section(&rows, "person", Some(&attrs)) {
                people.push_str(&s);
            }
        }
        if !people.is_empty() {
            out.push_str("\n\n<people>");
            out.push_str(&people);
            out.push_str("\n</people>");
        }
    }

    if let Some(s) = format_memory_section(&owner_notes, "owner_notes", None) {
        out.push_str(&s);
    }

    Some(out)
}

/// The tail of a request: history, then the memory block, then what was just
/// said. Shared so every surface places the block identically — it must sit
/// before the current message, or the model reads its own background as the
/// thing it was asked about.
pub(crate) fn trailing_with_memory(
    memory_block: Option<&str>,
    user_message: &str,
) -> Vec<crate::provider::ChatMessage> {
    let mut out = Vec::new();
    if let Some(block) = memory_block.filter(|b| !b.trim().is_empty()) {
        out.push(crate::provider::ChatMessage::system_context(block.trim_start()));
    }
    out.push(crate::provider::ChatMessage::user(user_message));
    out
}

/// Async wrapper for the two call sites that hold a pool rather than a
/// connection.
pub(crate) async fn load_memory_block(pool: &DbPool, req: MemoryRequest) -> Option<String> {
    let pool = pool.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().ok()?;
        load_memory_block_sync(&mut conn, &req)
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::memory::{NewMemory, Origin};
    use crate::db::models::project::NewProject;
    use crate::db::ops::memory::upsert_memory;
    use crate::db::test_db;

    fn project(conn: &mut SqliteConnection, id: &str) {
        crate::db::ops::project::create_project(
            conn,
            &NewProject {
                id, name: "P", path: None, source_type: "local", source_id: None,
                assistant_id: None, description: None, created_at: 1, updated_at: 1,
            },
        )
        .unwrap();
    }

    #[allow(clippy::too_many_arguments)]
    fn add(
        conn: &mut SqliteConnection,
        id: &str,
        scope: MemoryScope,
        scope_id: &str,
        key: &str,
        content: &str,
        origin: Origin,
        vis: Visibility,
    ) {
        let subject = (scope == MemoryScope::OnebotUser).then_some(scope_id);
        upsert_memory(
            conn,
            &NewMemory {
                id, scope_type: scope.as_str(), scope_id, key, content,
                memory_type: "general", subject_scope_id: subject,
                origin: origin.as_str(), visibility: vis.as_str(),
                source_session_id: None, created_at: 1, updated_at: 1,
            },
        )
        .unwrap();
    }

    /// Desktop output must not change: existing assistants are tuned against it.
    #[test]
    fn desktop_block_is_unchanged_from_the_legacy_format() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        project(conn, "p1");
        add(conn, "m1", MemoryScope::Project, "p1", "stack", "Rust + Tauri",
            Origin::Desktop, Visibility::Normal);

        let block = load_memory_block_sync(
            conn,
            &MemoryRequest::desktop(Some("p1".into()), 8_000),
        )
        .unwrap();

        assert_eq!(
            block,
            "\n\n<project_memories>\n- [general] stack: Rust + Tauri\n</project_memories>",
            "desktop keeps the legacy single-section block byte for byte"
        );
    }

    /// A conversation with no project writes to the client-global scope, so the
    /// desktop has to read it back — otherwise those memories are stored and
    /// never seen again. Still no policy preamble: one speaker, nothing to leak.
    #[test]
    fn desktop_reads_global_memories_without_the_policy_preamble() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        add(conn, "g1", MemoryScope::ClientGlobal, GLOBAL_SCOPE_ID, "editor_choice",
            "用 Zed 写代码", Origin::Desktop, Visibility::Normal);

        let block = load_memory_block_sync(conn, &MemoryRequest::desktop(None, 8_000)).unwrap();

        assert_eq!(
            block,
            "\n\n<global_memories>\n- [general] editor_choice: 用 Zed 写代码\n</global_memories>",
        );
        assert!(!block.contains("<memory_policy>"));
    }

    /// Both layers render, global first so the stabler rows stay in the cached
    /// prefix.
    #[test]
    fn desktop_renders_global_before_project() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        project(conn, "p1");
        add(conn, "g1", MemoryScope::ClientGlobal, GLOBAL_SCOPE_ID, "editor_choice",
            "用 Zed 写代码", Origin::Desktop, Visibility::Normal);
        add(conn, "m1", MemoryScope::Project, "p1", "stack", "Rust + Tauri",
            Origin::Desktop, Visibility::Normal);

        let block = load_memory_block_sync(
            conn,
            &MemoryRequest::desktop(Some("p1".into()), 8_000),
        )
        .unwrap();

        let global_at = block.find("<global_memories>").unwrap();
        let project_at = block.find("<project_memories>").unwrap();
        assert!(global_at < project_at);
        assert!(!block.contains("<memory_policy>"));
    }

    /// The two global layers are siblings, not a hierarchy: what the bot learned
    /// over QQ is not background for a desktop chat, and vice versa.
    #[test]
    fn the_two_global_layers_do_not_leak_into_each_other() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        add(conn, "bot", MemoryScope::OnebotGlobal, GLOBAL_SCOPE_ID, "bot_rule",
            "群里少说话", Origin::Admin, Visibility::Normal);

        // Desktop sees nothing: the only row lives on the bot side.
        assert!(load_memory_block_sync(conn, &MemoryRequest::desktop(None, 8_000)).is_none());

        add(conn, "client", MemoryScope::ClientGlobal, GLOBAL_SCOPE_ID, "editor_choice",
            "用 Zed 写代码", Origin::Desktop, Visibility::Normal);

        let desktop = load_memory_block_sync(conn, &MemoryRequest::desktop(None, 8_000)).unwrap();
        assert!(desktop.contains("editor_choice"));
        assert!(!desktop.contains("bot_rule"));

        let private = load_memory_block_sync(
            conn,
            &MemoryRequest::onebot_private(
                MemorySubjectRef { scope_id: onebot_user_scope_id(1), display_name: None },
                8_000,
            ),
        )
        .unwrap();
        assert!(private.contains("bot_rule"));
        assert!(!private.contains("editor_choice"));
    }

    /// The privacy boundary, end to end through the renderer.
    #[test]
    fn group_block_omits_private_memories() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        let alice = onebot_user_scope_id(1);
        add(conn, "priv", MemoryScope::OnebotUser, &alice, "secret", "told in DM",
            Origin::Private, Visibility::Normal);
        add(conn, "grp", MemoryScope::OnebotUser, &alice, "style", "likes terse",
            Origin::Group, Visibility::Normal);

        let block = load_memory_block_sync(
            conn,
            &MemoryRequest::onebot_group(
                None,
                vec![MemorySubjectRef::from_user(1, Some("Alice".into()))],
                8_000,
            ),
        )
        .unwrap();

        assert!(block.contains("likes terse"));
        assert!(!block.contains("told in DM"), "private memory leaked into a group");
        assert!(block.contains("<people>"));
        assert!(block.contains(r#"<person qq="1" name="Alice">"#));
    }

    #[test]
    fn owner_notes_are_a_separate_section() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        let alice = onebot_user_scope_id(1);
        add(conn, "note", MemoryScope::OnebotUser, &alice, "debt", "owes money",
            Origin::Admin, Visibility::OwnerOnly);
        add(conn, "pref", MemoryScope::OnebotUser, &alice, "style", "likes terse",
            Origin::Group, Visibility::Normal);

        let block = load_memory_block_sync(
            conn,
            &MemoryRequest::onebot_group(
                None,
                vec![MemorySubjectRef::from_user(1, Some("Alice".into()))],
                8_000,
            ),
        )
        .unwrap();

        // Matched with surrounding newlines: the policy preamble mentions the
        // tag by name, and a bare `find` would hit that instead.
        let people = block.find("\n\n<people>").unwrap();
        let notes = block.find("\n\n<owner_notes>\n").unwrap();
        assert!(notes > people, "owner notes must not be mixed into <people>");
        assert!(!block[people..notes].contains("owes money"));
        assert!(block[notes..].contains("owes money"));
    }

    /// Nicknames routinely contain characters that would break the attribute.
    #[test]
    fn person_attributes_are_escaped() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        let scope = onebot_user_scope_id(5);
        add(conn, "a", MemoryScope::OnebotUser, &scope, "k", "v",
            Origin::Group, Visibility::Normal);

        let block = load_memory_block_sync(
            conn,
            &MemoryRequest::onebot_group(
                None,
                vec![MemorySubjectRef::from_user(5, Some(r#"a"<b>"#.into()))],
                8_000,
            ),
        )
        .unwrap();

        assert!(block.contains(r#"name="a&quot;&lt;b&gt;""#));
    }

    /// Order must not depend on anything that changes between turns.
    #[test]
    fn subject_order_follows_scope_id_not_request_order() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        for uid in [2i64, 1] {
            let scope = onebot_user_scope_id(uid);
            add(conn, &format!("m{uid}"), MemoryScope::OnebotUser, &scope, "k",
                &format!("about {uid}"), Origin::Group, Visibility::Normal);
        }

        let a = load_memory_block_sync(
            conn,
            &MemoryRequest::onebot_group(
                None,
                vec![MemorySubjectRef::from_user(2, None), MemorySubjectRef::from_user(1, None)],
                8_000,
            ),
        )
        .unwrap();
        let b = load_memory_block_sync(
            conn,
            &MemoryRequest::onebot_group(
                None,
                vec![MemorySubjectRef::from_user(1, None), MemorySubjectRef::from_user(2, None)],
                8_000,
            ),
        )
        .unwrap();
        assert_eq!(a, b, "block must be a pure function of the memory set");
    }

    #[test]
    fn every_layer_is_capped_including_the_bot_layer() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        for i in 0..40 {
            add(conn, &format!("g{i}"), MemoryScope::OnebotGlobal, GLOBAL_SCOPE_ID,
                &format!("k{i:02}"), &"word ".repeat(60), Origin::Admin, Visibility::Normal);
        }

        let block = load_memory_block_sync(
            conn,
            &MemoryRequest::onebot_group(None, vec![], 512),
        )
        .unwrap();

        assert!(
            estimate_tokens(&block) < 1_200,
            "bot layer must be bounded by tokens, not just by entry count"
        );
    }

    #[test]
    fn nothing_to_say_yields_no_block() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        assert!(load_memory_block_sync(conn, &MemoryRequest::desktop(None, 8_000)).is_none());
    }

    /// An owner-only row in ANY layer must land in <owner_notes>. Left inline in
    /// <chat_memories> or <bot_memories> it is a note the model is free to read
    /// out, while its subject still cannot see or delete it.
    #[test]
    fn owner_only_rows_are_sectioned_from_every_layer() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        project(conn, "p1");
        add(conn, "pub", MemoryScope::Project, "p1", "slang", "in-joke",
            Origin::Group, Visibility::Normal);
        add(conn, "note", MemoryScope::Project, "p1", "client", "do not mention pricing",
            Origin::Desktop, Visibility::OwnerOnly);
        add(conn, "gnote", MemoryScope::OnebotGlobal, GLOBAL_SCOPE_ID, "quirk",
            "operator only", Origin::Admin, Visibility::OwnerOnly);

        let block = load_memory_block_sync(
            conn,
            &MemoryRequest::onebot_group(Some("p1".into()), vec![], 8_000),
        )
        .unwrap();

        let notes_at = block.find("\n\n<owner_notes>\n").expect("owner notes section");
        assert!(block.contains("in-joke"));
        // Neither note may appear before the section that protects them.
        assert!(!block[..notes_at].contains("do not mention pricing"));
        assert!(!block[..notes_at].contains("operator only"));
        assert!(block[notes_at..].contains("do not mention pricing"));
        assert!(block[notes_at..].contains("operator only"));
    }

    /// Desktop keeps the legacy block only while there is nothing to protect.
    #[test]
    fn desktop_owner_notes_force_the_sectioned_path() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        project(conn, "p1");
        add(conn, "note", MemoryScope::Project, "p1", "private", "hidden thing",
            Origin::Desktop, Visibility::OwnerOnly);

        let block =
            load_memory_block_sync(conn, &MemoryRequest::desktop(Some("p1".into()), 8_000))
                .unwrap();

        assert!(block.contains("<owner_notes>"), "must not be silently dropped");
        assert!(!block.contains("<project_memories>"));
    }

    /// Owner-only rows are exempt from per-subject trimming, so the renderer is
    /// the only thing bounding them.
    #[test]
    fn owner_notes_are_bounded_by_the_budget() {
        let pool = test_db();
        let conn = &mut pool.get().unwrap();
        project(conn, "p1");
        for i in 0..40 {
            add(conn, &format!("n{i}"), MemoryScope::Project, "p1",
                &format!("k{i:02}"), &"word ".repeat(60),
                Origin::Desktop, Visibility::OwnerOnly);
        }

        let block = load_memory_block_sync(
            conn,
            &MemoryRequest::onebot_group(Some("p1".into()), vec![], 512),
        )
        .unwrap();

        assert!(estimate_tokens(&block) < 1_200);
    }
}

#[cfg(test)]
mod placement_tests {
    use super::*;
    use crate::provider::MessageOrigin;

    /// The block must sit before the message it provides background for, and it
    /// must not be attributed to anyone: it is not something a user said.
    #[test]
    fn memory_precedes_the_current_message_and_has_no_speaker() {
        let msgs = trailing_with_memory(Some("\n\n<bot_memories>\n- x\n</bot_memories>"), "hi");

        assert_eq!(msgs.len(), 2);
        assert!(matches!(msgs[0].origin, MessageOrigin::SystemContext));
        assert!(msgs[0].content.starts_with("<bot_memories>"));
        assert_eq!(msgs[1].content, "hi");
        assert!(matches!(msgs[1].origin, MessageOrigin::LegacyUser));
    }

    #[test]
    fn no_memory_means_no_extra_message() {
        assert_eq!(trailing_with_memory(None, "hi").len(), 1);
        assert_eq!(trailing_with_memory(Some("   "), "hi").len(), 1);
    }
}
