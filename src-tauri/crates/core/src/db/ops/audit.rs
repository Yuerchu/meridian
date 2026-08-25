use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::db::models::audit::NewAuditMessage;
use crate::db::models::message::Message;
use crate::db::schema::{audit_messages, conversations, memory_subjects, model_configs, projects, turns};
use crate::util::now_ms;

/// What a row needs beside itself to be readable once everything it points at is
/// gone.
///
/// Read here rather than passed in, because no caller has all four: the writer
/// of a user row knows the conversation but not the turn's origin, and the one
/// that completes an assistant row knows neither the project nor the speaker's
/// nickname. Four small lookups against primary keys and one index, once per
/// message — the alternative is four more parameters on every write path and a
/// new way for each of them to be forgotten.
struct Snapshot {
    source_type: Option<String>,
    source_id: Option<String>,
    turn_origin: Option<String>,
    self_id: Option<i64>,
    sender_name: Option<String>,
    prices: Prices,
}

/// What this reply was priced at, taken now rather than looked up later.
///
/// `model_configs` is edited — a rate is cut, a typo is corrected, a name is
/// re-pointed at a cheaper tier — and every one of those would otherwise rewrite
/// what last month cost. Copied here for the same reason `provider_name` is:
/// this table says what happened, and the price at the time is part of that.
///
/// All `None` for a user row, which has no tokens to price, and for a model
/// nobody has configured. The latter is why a reader has to be able to say "this
/// much traffic has no price" rather than quietly reporting it as free.
#[derive(Default)]
struct Prices {
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
    /// Per thousand invocations, not per million tokens — the unit the
    /// upstream publishes it in.
    server_tool: Option<f64>,
}

/// The role an automatic-review request is filed under.
///
/// Its own value rather than `assistant`, because a review is spend the user
/// did not ask for directly and a total that cannot separate the two is a
/// total nobody can act on. `db::ops::usage` counts both.
pub const AUTO_REVIEW_ROLE: &str = "auto_review";

/// Summarising a conversation so it fits again.
///
/// The most expensive request the app makes on its own behalf — its prompt is
/// the whole history being compacted — and until this existed it was the one
/// upstream charge that appeared nowhere at all. The summary it produces is
/// written as a `user` row, so it could never have been counted through the
/// ordinary path.
pub const COMPACTION_ROLE: &str = "compaction";

/// Naming a conversation from its first exchange. Small, frequent, and equally
/// invisible before this.
pub const TITLE_ROLE: &str = "title";

/// Pulling durable facts out of a finished QQ turn. Another request nobody
/// typed, and the same hole titles used to fall through: `chat()` throws the
/// usage away at the adapter boundary.
pub const EXTRACTION_ROLE: &str = "extraction";

/// Every role that carries spend.
///
/// The list `db::ops::usage` filters on. A role missing from here is traffic
/// that was paid for and reported as nothing — which is how compaction and
/// titles went unrecorded for as long as they did, so adding a role means adding
/// it here in the same change.
pub const BILLED_ROLES: &[&str] = &[
    "assistant",
    AUTO_REVIEW_ROLE,
    COMPACTION_ROLE,
    TITLE_ROLE,
    EXTRACTION_ROLE,
];

/// The rates this reply was charged, with any tiered pricing already resolved.
///
/// **This is where a tier is decided, and the only place it can be.** The tier
/// depends on how big *this* prompt was, and that number exists here and nowhere
/// downstream: `db::ops::usage` reads back a `SUM` over rows that are no longer
/// one request, so re-deciding at read time would mean inventing a prompt size.
/// What lands in the four price columns is the tier's own rates, which makes a
/// crossing of the threshold look — to the reporting query — exactly like a
/// price change mid-month, and that is a thing it already handles.
///
/// `prompt_tokens` is the whole prompt, cached part included, because that is
/// what the upstreams measure against. A row with no token count falls to the
/// base rates: an unknown prompt size cannot be argued into a tier, and the base
/// rate is the one that cannot overcharge.
fn prices_for(
    conn: &mut SqliteConnection,
    provider_id: Option<&str>,
    model_id: Option<&str>,
    prompt_tokens: Option<i32>,
) -> Prices {
    let (Some(provider), Some(model)) = (provider_id, model_id) else {
        return Prices::default();
    };
    model_configs::table
        .filter(model_configs::provider_id.eq(provider))
        .filter(model_configs::model_id.eq(model))
        .select(crate::db::models::model_config::ModelConfig::as_select())
        .first(conn)
        .map(|config| {
            let effective = crate::agent::pricing::Prices::for_prompt(&config, prompt_tokens.unwrap_or(0) as i64);
            Prices {
                input: Some(effective.input),
                output: Some(effective.output),
                // Left as resolved but not defaulted: a blank cache price means
                // "priced like input", and `compute_cost` is the one place that
                // reading belongs. Filling it in here would put the same rule in
                // two places, to disagree later.
                cache_read: effective.cache_read,
                cache_write: effective.cache_write,
                server_tool: effective.server_tool,
            }
        })
        .unwrap_or_default()
}

/// The four lookups, from the identifiers rather than from a row.
///
/// Takes the pieces rather than a `Message` because the review rows have no
/// `messages` row of their own — they describe spend against a message that
/// somebody else wrote.
struct Subject<'a> {
    conversation_id: &'a str,
    turn_id: Option<&'a str>,
    sender_id: Option<i64>,
    provider_id: Option<&'a str>,
    model_id: Option<&'a str>,
    /// The whole prompt, which is what decides the price tier. `None` on a
    /// user row, which has no tokens to price.
    prompt_tokens: Option<i32>,
}

fn snapshot(conn: &mut SqliteConnection, msg: &Message) -> Snapshot {
    snapshot_of(
        conn,
        Subject {
            conversation_id: &msg.conversation_id,
            turn_id: msg.turn_id.as_deref(),
            sender_id: msg.sender_id,
            provider_id: msg.provider_id.as_deref(),
            model_id: msg.model_id.as_deref(),
            prompt_tokens: msg.input_tokens,
        },
    )
}

fn snapshot_of(conn: &mut SqliteConnection, subject: Subject<'_>) -> Snapshot {
    // Every one of these is best-effort. A missing project or a turn row that has
    // not been written yet is a gap in the record, not a reason to refuse to keep
    // the record at all.
    let project: Option<(String, Option<String>)> = conversations::table
        .find(subject.conversation_id)
        .select(conversations::project_id)
        .first::<Option<String>>(conn)
        .ok()
        .flatten()
        .and_then(|pid| {
            projects::table
                .find(pid)
                .select((projects::source_type, projects::source_id))
                .first(conn)
                .ok()
        });

    // Both halves of "where did this come from" in one lookup, because they are
    // written together and reading one without the other is what leaves a bot
    // account unattributable.
    let (turn_origin, self_id) = subject
        .turn_id
        .and_then(|tid| {
            turns::table
                .find(tid)
                .select((turns::origin, turns::self_id))
                .first::<(String, Option<i64>)>(conn)
                .ok()
        })
        .map_or((None, None), |(origin, self_id)| (Some(origin), self_id));

    let sender_name = subject.sender_id.and_then(|uid| {
        let scope = crate::db::models::memory::onebot_user_scope_id(uid);
        memory_subjects::table
            .find(scope)
            .select(memory_subjects::display_name)
            .first::<Option<String>>(conn)
            .ok()
            .flatten()
    });

    Snapshot {
        source_type: project.as_ref().map(|(t, _)| t.clone()),
        source_id: project.and_then(|(_, id)| id),
        turn_origin,
        self_id,
        sender_name,
        prices: prices_for(conn, subject.provider_id, subject.model_id, subject.prompt_tokens),
    }
}

/// Copy a message into the audit log.
///
/// Called once per message, after the row it describes is final: a user message
/// as soon as it is appended, an assistant reply once the model has finished with
/// it. Never an update — an edited or regenerated message produces a second
/// record rather than replacing the first, because the question this table
/// answers is "what happened" and not "what does the transcript say now".
///
/// Returns the error rather than swallowing it so the caller can log it. No
/// caller should let it fail a turn: a database that cannot take the audit copy
/// is a problem to be shouted about, but refusing to answer the user because of
/// it would turn a bookkeeping fault into an outage.
pub fn record(conn: &mut SqliteConnection, msg: &Message) -> QueryResult<()> {
    let snap = snapshot(conn, msg);
    let id = uuid::Uuid::new_v4().to_string();
    diesel::insert_into(audit_messages::table)
        .values(&NewAuditMessage {
            id: &id,
            recorded_at: now_ms(),
            message_id: &msg.id,
            conversation_id: &msg.conversation_id,
            turn_id: msg.turn_id.as_deref(),
            source_type: snap.source_type.as_deref(),
            source_id: snap.source_id.as_deref(),
            turn_origin: snap.turn_origin.as_deref(),
            role: &msg.role,
            content: &msg.content,
            sender_id: msg.sender_id,
            sender_name: snap.sender_name.as_deref(),
            provider_id: msg.provider_id.as_deref(),
            provider_name: msg.provider_name.as_deref(),
            model_id: msg.model_id.as_deref(),
            input_tokens: msg.input_tokens,
            output_tokens: msg.output_tokens,
            cache_read_tokens: msg.cache_read_tokens,
            cache_write_tokens: msg.cache_write_tokens,
            server_tool_calls: msg.server_tool_calls,
            created_at: msg.created_at,
            input_price: snap.prices.input,
            output_price: snap.prices.output,
            cache_read_price: snap.prices.cache_read,
            cache_write_price: snap.prices.cache_write,
            server_tool_price: snap.prices.server_tool,
            self_id: snap.self_id,
        })
        .execute(conn)?;
    Ok(())
}

/// What one request the app made on its own behalf cost.
///
/// A review, a summary, a title: none of them is something a person asked for
/// directly, none has a `messages` row of its own to be copied from, and every
/// one of them is charged for. `role` is what keeps them separable — a total
/// nobody can decompose is one nobody can act on.
#[derive(Debug, Clone)]
pub struct SideRequestCost<'a> {
    /// One of the `*_ROLE` constants above.
    pub role: &'a str,
    /// The row this spend is filed against: the message a review judged, the
    /// summary a compaction wrote, the reply a title was taken from. Something
    /// real, so the record can be traced back — never invented.
    pub message_id: &'a str,
    pub conversation_id: &'a str,
    pub turn_id: Option<&'a str>,
    pub provider_id: Option<&'a str>,
    pub provider_name: Option<&'a str>,
    pub model_id: Option<&'a str>,
    /// Summed across every request the review made — a quick pass plus up to six
    /// escalating rounds.
    pub usage: crate::db::models::message::MessageUsage,
    /// The largest single request's prompt, which is what decides the price
    /// tier.
    ///
    /// **Not `usage.input_tokens`, and the difference costs real money.** That
    /// figure is a sum over as many as seven requests, so a review whose every
    /// round sat comfortably under a threshold still adds up to something above
    /// it — and billing the whole row at the long-context rate then doubles it.
    /// This is the same mistake the turn loop avoids by pricing each round as it
    /// goes; a review has one audit row to put its cost in, so the closest it can
    /// get is the tier its biggest round actually reached.
    ///
    /// `None` falls back to the base rate, which is what a review with no
    /// reported usage should cost.
    pub peak_prompt_tokens: Option<i32>,
    /// One line, for reading the log back. Never the transcript that was sent:
    /// this table is exportable and the projection carries the user's own
    /// messages.
    pub summary: &'a str,
}

/// Record what a review spent.
///
/// Separate from `record` because a review has no message row to copy — but it
/// takes the same snapshot, prices at the same moment against the same table,
/// and lands in the same place. Two ledgers would disagree the first time
/// somebody changed a rate.
pub fn record_side_request(conn: &mut SqliteConnection, cost: SideRequestCost<'_>) -> QueryResult<()> {
    let snap = snapshot_of(
        conn,
        Subject {
            conversation_id: cost.conversation_id,
            turn_id: cost.turn_id,
            // A review is something the app did, never something a person in a
            // chat said, so it is attributed to nobody.
            sender_id: None,
            provider_id: cost.provider_id,
            model_id: cost.model_id,
            // The biggest round's prompt, never the sum of all of them — see
            // `ReviewCost::peak_prompt_tokens`.
            prompt_tokens: cost.peak_prompt_tokens,
        },
    );
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    diesel::insert_into(audit_messages::table)
        .values(&NewAuditMessage {
            id: &id,
            recorded_at: now,
            message_id: cost.message_id,
            conversation_id: cost.conversation_id,
            turn_id: cost.turn_id,
            source_type: snap.source_type.as_deref(),
            source_id: snap.source_id.as_deref(),
            turn_origin: snap.turn_origin.as_deref(),
            role: cost.role,
            content: cost.summary,
            sender_id: None,
            sender_name: None,
            provider_id: cost.provider_id,
            provider_name: cost.provider_name,
            model_id: cost.model_id,
            input_tokens: cost.usage.input_tokens,
            output_tokens: cost.usage.output_tokens,
            cache_read_tokens: cost.usage.cache_read_tokens,
            cache_write_tokens: cost.usage.cache_write_tokens,
            server_tool_calls: cost.usage.server_tool_calls,
            created_at: now,
            input_price: snap.prices.input,
            output_price: snap.prices.output,
            cache_read_price: snap.prices.cache_read,
            cache_write_price: snap.prices.cache_write,
            server_tool_price: snap.prices.server_tool,
            self_id: snap.self_id,
        })
        .execute(conn)?;
    Ok(())
}

/// Newest first. Test-only: production reads the table through `db::ops::usage`,
/// but the tests that verify audit writes need the rows back verbatim.
#[cfg(test)]
pub fn list_recent(
    conn: &mut SqliteConnection,
    limit: i64,
) -> QueryResult<Vec<crate::db::models::audit::AuditMessage>> {
    use crate::db::models::audit::AuditMessage;
    audit_messages::table
        .order(audit_messages::created_at.desc())
        .limit(limit)
        .select(AuditMessage::as_select())
        .load(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ops::conversation::{create_conversation, delete_conversation};
    use crate::db::ops::message::append_message;
    use crate::db::test_db;

    fn user_row<'a>(id: &'a str, conv: &'a str) -> crate::db::models::message::NewMessage<'a> {
        crate::db::models::message::NewMessage {
            id,
            conversation_id: conv,
            role: "user",
            content: "what did you do",
            provider_id: None,
            model_id: None,
            input_tokens: None,
            output_tokens: None,
            tool_calls: None,
            tool_call_id: None,
            sort_order: 0,
            created_at: 1_000,
            reasoning_content: None,
            rating: None,
            schema_version: 2,
            is_compact_summary: 0,
            sender_id: Some(12345),
            parent_id: None,
            compact_anchor_id: None,
            source: None,
            turn_id: None,
            tool_outcome: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            server_tool_calls: None,
            provider_name: None,
        }
    }

    /// The reason the table exists. Everything else about a conversation goes
    /// when the conversation does; this does not.
    ///
    /// No explicit `record` call: appending a user message is what files it, and
    /// a test that recorded by hand would pass even if that wiring were removed.
    #[test]
    fn an_audit_record_survives_deleting_its_conversation() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        append_message(&mut conn, &user_row("m1", "c1"), None).unwrap();

        delete_conversation(&mut conn, "c1").unwrap();

        assert!(
            crate::db::ops::message::list_messages(&mut conn, "c1")
                .unwrap()
                .is_empty(),
            "the transcript really did go",
        );
        let kept = list_recent(&mut conn, 10).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].message_id, "m1");
        assert_eq!(kept[0].content, "what did you do");
        assert_eq!(kept[0].sender_id, Some(12345));
        assert_eq!(kept[0].conversation_id, "c1", "still names what it was about");
    }

    /// The write half of not repricing history. What the model cost is read once,
    /// here, and never looked up again — so editing the price afterwards moves
    /// nothing that has already happened.
    #[test]
    fn a_reply_carries_away_the_price_it_was_charged() {
        use crate::db::models::model_config::NewModelConfig;
        use crate::db::models::provider::NewProvider;

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        diesel::insert_into(crate::db::schema::providers::table)
            .values(&NewProvider {
                id: "p1",
                name: "Acme",
                provider_type: "openai",
                base_url: "https://example.invalid",
                is_enabled: 1,
                sort_order: 0,
                created_at: 0,
                updated_at: 0,
                api_format: "chat",
            })
            .execute(&mut conn)
            .unwrap();
        crate::db::ops::model_config::upsert(
            &mut conn,
            &NewModelConfig {
                id: "mc1",
                provider_id: "p1",
                model_id: "m1",
                display_name: None,
                context_window: 128_000,
                compact_threshold: 100_000,
                max_output_tokens: None,
                input_price: 3.0,
                output_price: 15.0,
                cache_price: Some(0.3),
                cache_write_price: Some(3.75),
                created_at: 0,
                updated_at: 0,
                capability_overrides: None,
                price_tiers: None,
                server_tools: None,
                server_tool_price: None,
            },
        )
        .unwrap();

        let mut reply = user_row("m1", "c1");
        reply.role = "assistant";
        reply.provider_id = Some("p1");
        reply.model_id = Some("m1");
        let reply = append_message(&mut conn, &reply, None).unwrap();
        record(&mut conn, &reply).unwrap();

        let logged = &list_recent(&mut conn, 10).unwrap()[0];
        assert_eq!(logged.input_price, Some(3.0));
        assert_eq!(logged.output_price, Some(15.0));
        assert_eq!(logged.cache_read_price, Some(0.3));
        assert_eq!(logged.cache_write_price, Some(3.75));

        // The price moves; the record does not.
        crate::db::ops::model_config::upsert(
            &mut conn,
            &NewModelConfig {
                id: "mc1",
                provider_id: "p1",
                model_id: "m1",
                display_name: None,
                context_window: 128_000,
                compact_threshold: 100_000,
                max_output_tokens: None,
                input_price: 99.0,
                output_price: 99.0,
                cache_price: None,
                cache_write_price: None,
                created_at: 0,
                updated_at: 0,
                capability_overrides: None,
                price_tiers: None,
                server_tools: None,
                server_tool_price: None,
            },
        )
        .unwrap();
        assert_eq!(list_recent(&mut conn, 10).unwrap()[0].input_price, Some(3.0));
    }

    /// A tiered model is priced against *this* reply's prompt, at write time.
    ///
    /// This is the only place that decision can be made — the reporting query
    /// sees a `SUM` over rows that are no longer one request — so what lands in
    /// the four price columns has to be the tier's own rates. Two replies from
    /// one model on opposite sides of the threshold then arrive at the report as
    /// two price sets, which is a thing it already knows how to add up.
    #[test]
    fn a_long_prompt_is_snapshotted_at_its_tier_rate() {
        use crate::db::models::model_config::NewModelConfig;
        use crate::db::models::provider::NewProvider;

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        diesel::insert_into(crate::db::schema::providers::table)
            .values(&NewProvider {
                id: "p1",
                name: "Acme",
                provider_type: "xai",
                base_url: "https://example.invalid",
                is_enabled: 1,
                sort_order: 0,
                created_at: 0,
                updated_at: 0,
                api_format: "chat",
            })
            .execute(&mut conn)
            .unwrap();
        crate::db::ops::model_config::upsert(
            &mut conn,
            &NewModelConfig {
                id: "mc1",
                provider_id: "p1",
                model_id: "grok-4.6",
                display_name: None,
                context_window: 500_000,
                compact_threshold: 400_000,
                max_output_tokens: None,
                input_price: 2.0,
                output_price: 6.0,
                cache_price: Some(0.5),
                cache_write_price: None,
                created_at: 0,
                updated_at: 0,
                server_tools: None,
                server_tool_price: None,
                capability_overrides: None,
                price_tiers: Some(r#"[{"min_prompt_tokens":200000,"input":4.0,"output":12.0,"cache_read":1.0}]"#),
            },
        )
        .unwrap();

        let mut short = user_row("m1", "c1");
        short.role = "assistant";
        short.provider_id = Some("p1");
        short.model_id = Some("grok-4.6");
        short.input_tokens = Some(100_000);
        let short = append_message(&mut conn, &short, None).unwrap();
        record(&mut conn, &short).unwrap();

        let mut long = user_row("m2", "c1");
        long.role = "assistant";
        long.provider_id = Some("p1");
        long.model_id = Some("grok-4.6");
        long.input_tokens = Some(250_000);
        long.created_at = 2_000;
        let long = append_message(&mut conn, &long, None).unwrap();
        record(&mut conn, &long).unwrap();

        let logged = list_recent(&mut conn, 10).unwrap();
        let of = |id: &str| {
            logged
                .iter()
                .find(|row| row.message_id == id && row.role == "assistant")
                .expect("recorded")
        };
        assert_eq!(of("m1").input_price, Some(2.0), "under the threshold");
        assert_eq!(of("m1").cache_read_price, Some(0.5));
        assert_eq!(of("m2").input_price, Some(4.0), "over it, and the whole prompt");
        assert_eq!(of("m2").output_price, Some(12.0));
        assert_eq!(of("m2").cache_read_price, Some(1.0));
    }

    /// A question has no model and so no price. Storing a zero would make it
    /// indistinguishable from a reply priced at nothing.
    #[test]
    fn a_message_with_no_model_is_recorded_with_no_price() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        append_message(&mut conn, &user_row("m1", "c1"), None).unwrap();

        let logged = &list_recent(&mut conn, 10).unwrap()[0];
        assert_eq!(logged.input_price, None);
        assert_eq!(logged.output_price, None);
    }

    /// A review is spend against a message somebody else wrote, and it has to
    /// be priced the same way that message was — same table, same moment, same
    /// snapshot. Two ledgers would disagree the first time a rate changed.
    #[test]
    fn a_review_is_priced_like_everything_else() {
        use crate::db::models::message::MessageUsage;
        use crate::db::models::model_config::NewModelConfig;
        use crate::db::models::provider::NewProvider;

        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        diesel::insert_into(crate::db::schema::providers::table)
            .values(&NewProvider {
                id: "p1",
                name: "Acme",
                provider_type: "openai",
                base_url: "https://example.invalid",
                is_enabled: 1,
                sort_order: 0,
                created_at: 0,
                updated_at: 0,
                api_format: "chat",
            })
            .execute(&mut conn)
            .unwrap();
        crate::db::ops::model_config::upsert(
            &mut conn,
            &NewModelConfig {
                id: "mc1",
                provider_id: "p1",
                model_id: "cheap",
                display_name: None,
                context_window: 128_000,
                compact_threshold: 100_000,
                max_output_tokens: None,
                input_price: 1.0,
                output_price: 2.0,
                cache_price: None,
                cache_write_price: None,
                created_at: 0,
                updated_at: 0,
                capability_overrides: None,
                price_tiers: None,
                server_tools: None,
                server_tool_price: None,
            },
        )
        .unwrap();
        let judged = append_message(&mut conn, &user_row("m1", "c1"), None).unwrap();

        record_side_request(
            &mut conn,
            SideRequestCost {
                role: AUTO_REVIEW_ROLE,
                message_id: &judged.id,
                conversation_id: "c1",
                turn_id: None,
                provider_id: Some("p1"),
                provider_name: Some("Acme"),
                model_id: Some("cheap"),
                usage: MessageUsage {
                    input_tokens: Some(900),
                    output_tokens: Some(20),
                    ..Default::default()
                },
                peak_prompt_tokens: Some(900),
                summary: "Deny/High: 目标不在授权范围内",
            },
        )
        .unwrap();

        let logged = list_recent(&mut conn, 10).unwrap();
        let review = logged
            .iter()
            .find(|r| r.role == AUTO_REVIEW_ROLE)
            .expect("the review should be in the log");
        assert_eq!(review.message_id, "m1", "it names the message it judged");
        assert_eq!(review.input_tokens, Some(900));
        assert_eq!(
            review.input_price,
            Some(1.0),
            "priced at write time like everything else"
        );
        assert_eq!(review.output_price, Some(2.0));
        // A review is something the app did, never something a person said.
        assert_eq!(review.sender_id, None);
    }

    /// An edit writes a second record rather than rewriting the first: the
    /// question is what happened, not what the transcript says now.
    #[test]
    fn a_second_record_for_one_message_is_kept_alongside_the_first() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        create_conversation(&mut conn, "c1", None, None, None, 1).unwrap();
        // One from the append, one from the explicit call standing in for the
        // message being edited and recorded again.
        let msg = append_message(&mut conn, &user_row("m1", "c1"), None).unwrap();
        record(&mut conn, &msg).unwrap();

        assert_eq!(list_recent(&mut conn, 10).unwrap().len(), 2);
    }
}
