//! What was spent, grouped by whichever thing is being asked about.
//!
//! Reads `audit_messages` rather than `messages`, for the reason that table
//! exists: a bill must not change because someone tidied their chat list.
//! Deleting a conversation removes its transcript and leaves the record of what
//! it cost, which is the only way "last month" can keep meaning the same thing
//! a month later.
//!
//! **The cost is not computed here.** Every group is handed to
//! `agent::pricing::compute_cost`, the same function the turn's own stop event
//! uses, because that formula carries a rule no summation expresses — a cached
//! token is billed at the cache rate *instead of* the input rate, not on top of
//! it. Writing `SUM(input_tokens * input_price)` in SQL would be a second
//! implementation of a thing that has already been wrong once, and the two would
//! disagree in exactly the case that matters.
//!
//! That is why the grouping carries the prices: SQL reduces millions of rows to
//! a few dozen (dimension × model × price set), and Rust prices those. A price
//! is edited a handful of times a year, so the price columns barely multiply the
//! group count — and they cannot be left out, because a rate that changed
//! mid-month has to bill each half at what it was.

use std::collections::HashMap;

use diesel::prelude::*;
use diesel::sql_types::{BigInt, Double, Nullable, Text};
use diesel::sqlite::SqliteConnection;
use serde::{Deserialize, Serialize};

use crate::agent::pricing::{BilledTokens, BillingMode, Prices, cost_of};
use crate::db::schema::{conversations, model_configs, projects};

/// Which window, and whose traffic.
///
/// Every field is optional and every one means "no restriction" when absent, so
/// the default value is the whole log.
///
/// **`conversation_id` is a scope, not a convenience.** Without it the only way
/// to look at one conversation was `UsageDimension::Conversation`, which
/// *groups* by conversation and still reads every row — so a caller that must
/// see one conversation and no other had no way to say so, and "wrap
/// [`report`]" meant handing over the whole ledger. That is exactly the caller
/// the ACP bridge is: `tools::usage` fills this in from the turn it is running
/// under and ignores anything the model asks for. Being a filter rather than a
/// grouping is what makes it hold across every dimension, including
/// `Conversation` itself — otherwise changing the dimension would be the way
/// out of the scope.
///
/// There is deliberately no `project_id` beside it. `audit_messages` has no such
/// column, so it would mean joining `conversations` — and a conversation that
/// has since moved projects, or been deleted, would answer differently from the
/// row it is about. The one caller that needs a scope needs this one.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct UsageFilter {
    pub since_ms: Option<i64>,
    pub until_ms: Option<i64>,
    /// `desktop` or `onebot`, matched against the snapshotted `turn_origin`.
    pub origin: Option<String>,
    /// One conversation and nothing else. See the note above.
    pub conversation_id: Option<String>,
}

/// What the rows are grouped by.
///
/// `Total` is the same query with a constant key, which is what keeps the
/// headline figures and the breakdown that is supposed to add up to them from
/// being computed two different ways.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageDimension {
    Total,
    Provider,
    Model,
    Bot,
    Source,
    Conversation,
    Day,
    Hour,
    /// Answering the user, versus reviewing whether a tool call was allowed to
    /// happen. The second is spend nobody asked for directly, and a total that
    /// cannot separate the two is one nobody can act on.
    Kind,
}

impl UsageDimension {
    /// The SQL that produces this dimension's key.
    ///
    /// A `&'static str` chosen by a match, never a caller's string — the value
    /// is interpolated into the statement and this is the only reason that is
    /// safe. Everything a caller supplies is bound.
    fn key_expr(self) -> &'static str {
        match self {
            UsageDimension::Total => "''",
            // The name as it was at the time, because that is what the row
            // keeps; the id only stands in when a row predates that column.
            UsageDimension::Provider => "COALESCE(provider_name, provider_id, '')",
            UsageDimension::Model => "COALESCE(model_id, '')",
            UsageDimension::Bot => "COALESCE(CAST(self_id AS TEXT), '')",
            // Type and id together: a private chat with user 12345 and a group
            // numbered 12345 are different places with the same number.
            UsageDimension::Source => "COALESCE(source_type || ':' || source_id, '')",
            UsageDimension::Conversation => "conversation_id",
            // Local time, not UTC. A day boundary eight hours off puts an
            // evening's work under the wrong date, which is immediately visible
            // and reads as the numbers being wrong rather than the grouping.
            UsageDimension::Day => "strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime')",
            UsageDimension::Hour => "strftime('%Y-%m-%dT%H', created_at / 1000, 'unixepoch', 'localtime')",
            UsageDimension::Kind => "role",
        }
    }

    /// Time reads forwards; everything else reads biggest-first.
    fn is_series(self) -> bool {
        matches!(self, UsageDimension::Day | UsageDimension::Hour)
    }
}

/// One row of a report.
#[derive(Debug, Clone, Serialize)]
pub struct UsageBucket {
    pub key: String,
    /// A name for `key`, when one can still be found. `None` means the thing it
    /// refers to has been deleted — which is a fact worth showing rather than a
    /// row worth dropping.
    pub label: Option<String>,
    /// Replies, not messages. Only assistant rows carry tokens, and a count that
    /// included the questions would not divide into anything beside it.
    pub messages: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost: f64,
    /// How many of `messages` were produced by a model nobody has priced.
    ///
    /// Not an error and not zero-cost: it is traffic whose cost is unknown, and
    /// a total that absorbs it silently is a smaller number than the truth with
    /// nothing to say so. Every caller is expected to surface this.
    pub unpriced_messages: i64,
}

impl UsageBucket {
    fn empty(key: String) -> Self {
        Self {
            key,
            label: None,
            messages: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cost: 0.0,
            unpriced_messages: 0,
        }
    }
}

/// A group exactly as the database returns it: one row per key, model and set of
/// prices. Not public — the prices are an implementation detail of getting the
/// cost right, and nothing downstream should be tempted to re-derive it.
#[derive(Debug, QueryableByName)]
struct GroupRow {
    #[diesel(sql_type = Text)]
    bucket_key: String,
    #[diesel(sql_type = Nullable<Text>)]
    provider_id: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    model_id: Option<String>,
    #[diesel(sql_type = Nullable<Double>)]
    input_price: Option<f64>,
    #[diesel(sql_type = Nullable<Double>)]
    output_price: Option<f64>,
    #[diesel(sql_type = Nullable<Double>)]
    cache_read_price: Option<f64>,
    #[diesel(sql_type = Nullable<Double>)]
    cache_write_price: Option<f64>,
    #[diesel(sql_type = Nullable<Double>)]
    server_tool_price: Option<f64>,
    /// Grouped on, not just carried: the same model under the same rates can be
    /// billed two ways over its life — an API key today, a subscription
    /// tomorrow — and merging those into one group would price the subscription
    /// half at the metered half's rates.
    #[diesel(sql_type = Text)]
    billing_mode: String,
    #[diesel(sql_type = BigInt)]
    messages: i64,
    #[diesel(sql_type = BigInt)]
    input_tokens: i64,
    #[diesel(sql_type = BigInt)]
    output_tokens: i64,
    #[diesel(sql_type = BigInt)]
    cache_read_tokens: i64,
    #[diesel(sql_type = BigInt)]
    cache_write_tokens: i64,
    /// Provider-side invocations, which bill per call rather than per token.
    #[diesel(sql_type = BigInt)]
    server_tool_calls: i64,
}

/// Group the log, price each group, and add the groups up.
pub fn report(
    conn: &mut SqliteConnection,
    dimension: UsageDimension,
    filter: &UsageFilter,
) -> QueryResult<Vec<UsageBucket>> {
    let groups = grouped(conn, dimension, filter)?;
    let current = current_prices(conn)?;

    let mut buckets: HashMap<String, UsageBucket> = HashMap::new();
    for group in groups {
        let prices = resolve(&group, &current);
        let entry = buckets
            .entry(group.bucket_key.clone())
            .or_insert_with(|| UsageBucket::empty(group.bucket_key.clone()));

        entry.messages += group.messages;
        entry.input_tokens += group.input_tokens;
        entry.output_tokens += group.output_tokens;
        entry.cache_read_tokens += group.cache_read_tokens;
        entry.cache_write_tokens += group.cache_write_tokens;

        match prices {
            Some(prices) => {
                let tokens = BilledTokens::from_totals(
                    group.input_tokens,
                    group.output_tokens,
                    group.cache_read_tokens,
                    group.cache_write_tokens,
                    group.server_tool_calls,
                );
                entry.cost += cost_of(&tokens, &prices).total_cost;
            }
            // Only the modes that expect a rate can be missing one. Counting a
            // subscription's requests here would report a shortfall that can
            // never be closed — there is no price to go and fill in.
            None if billing_mode_of(&group).expects_a_price() => entry.unpriced_messages += group.messages,
            None => {}
        }
    }

    let mut out: Vec<UsageBucket> = buckets.into_values().collect();
    if dimension.is_series() {
        out.sort_by(|a, b| a.key.cmp(&b.key));
    } else {
        // Tokens break the tie, so unpriced rows — every one of which costs 0 —
        // still come back in an order that puts the largest first.
        out.sort_by(|a, b| {
            b.cost
                .partial_cmp(&a.cost)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then((b.input_tokens + b.output_tokens).cmp(&(a.input_tokens + a.output_tokens)))
        });
    }
    label(conn, dimension, &mut out)?;
    Ok(out)
}

/// The snapshot if there is one, today's configuration if there is not, and
/// `None` when nobody has ever said what this model costs.
///
/// The middle case is the retroactive pricing migration 30 exists to end, and it
/// only applies to rows written before it. Reporting those at today's rate is
/// wrong in a way that cannot be fixed — there is no other number — but it beats
/// reporting them as free.
///
/// **The mode is checked before any of that**, and it has to be: the fallback
/// looks the request's model up in today's `model_configs`, so a subscription
/// request through a provider that happens to have rates on file would be priced
/// at them. "No rate was stored" and "no rate exists" are the same shape in the
/// row and opposite in meaning, and only `billing_mode` tells them apart.
fn resolve(group: &GroupRow, current: &HashMap<(String, String), Prices>) -> Option<Prices> {
    if !billing_mode_of(group).is_priced() {
        return None;
    }
    let snapshot = match (group.input_price, group.output_price) {
        (Some(input), Some(output)) => Some(Prices {
            input,
            output,
            cache_read: group.cache_read_price,
            cache_write: group.cache_write_price,
            server_tool: group.server_tool_price,
        }),
        _ => None,
    };
    let prices = snapshot.or_else(|| {
        let provider = group.provider_id.as_ref()?;
        let model = group.model_id.as_ref()?;
        current.get(&(provider.clone(), model.clone())).copied()
    })?;
    prices.known().then_some(prices)
}

/// An unreadable mode reads as `Metered`, which keeps the request in the ledger
/// and, if it has no rate, visible as unpriced. The alternative — treating junk
/// as "not billable" — would make spend disappear silently.
fn billing_mode_of(group: &GroupRow) -> BillingMode {
    group.billing_mode.parse().unwrap_or_default()
}

fn current_prices(conn: &mut SqliteConnection) -> QueryResult<HashMap<(String, String), Prices>> {
    let rows = model_configs::table
        .select((
            model_configs::provider_id,
            model_configs::model_id,
            model_configs::input_price,
            model_configs::output_price,
            model_configs::cache_price,
            model_configs::cache_write_price,
            model_configs::server_tool_price,
        ))
        .load::<(String, String, f64, f64, Option<f64>, Option<f64>, Option<f64>)>(conn)?;
    Ok(rows
        .into_iter()
        .map(
            |(provider, model, input, output, cache_read, cache_write, server_tool)| {
                (
                    (provider, model),
                    Prices {
                        input,
                        output,
                        cache_read,
                        cache_write,
                        server_tool,
                    },
                )
            },
        )
        .collect())
}

fn grouped(conn: &mut SqliteConnection, dimension: UsageDimension, filter: &UsageFilter) -> QueryResult<Vec<GroupRow>> {
    // The two roles that carry tokens. A question carries none and has no
    // model, so every user row would land in a single group keyed on nothing
    // and inflate the reply count the other figures are read against.
    //
    // `auto_review` rows are traffic the user never asked for directly, and
    // leaving them out would report a smaller number than was actually spent —
    // the same failure as counting unpriced messages as free. They are told
    // apart by `UsageDimension::Kind`.
    //
    // Each filter is bound twice against the same `?`-pair rather than being
    // appended conditionally: one statement, one shape, and no arm of a builder
    // that can be reached only by a combination nobody tested.
    let sql = format!(
        "SELECT {key} AS bucket_key,
                provider_id, model_id,
                input_price, output_price, cache_read_price, cache_write_price,
                server_tool_price, billing_mode,
                COUNT(*) AS messages,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                COALESCE(SUM(server_tool_calls), 0) AS server_tool_calls
           FROM audit_messages
          WHERE role IN ({roles})
            AND (? IS NULL OR created_at >= ?)
            AND (? IS NULL OR created_at < ?)
            AND (? IS NULL OR turn_origin = ?)
            AND (? IS NULL OR conversation_id = ?)
       GROUP BY bucket_key, provider_id, model_id,
                input_price, output_price, cache_read_price, cache_write_price,
                server_tool_price, billing_mode",
        key = dimension.key_expr(),
        // A `&'static str` built from a constant, never a caller's string — the
        // same rule the key expression follows.
        roles = crate::db::ops::audit::BILLED_ROLES
            .iter()
            .map(|role| format!("'{role}'"))
            .collect::<Vec<_>>()
            .join(", "),
    );

    diesel::sql_query(sql)
        .bind::<Nullable<BigInt>, _>(filter.since_ms)
        .bind::<Nullable<BigInt>, _>(filter.since_ms)
        .bind::<Nullable<BigInt>, _>(filter.until_ms)
        .bind::<Nullable<BigInt>, _>(filter.until_ms)
        .bind::<Nullable<Text>, _>(filter.origin.clone())
        .bind::<Nullable<Text>, _>(filter.origin.clone())
        .bind::<Nullable<Text>, _>(filter.conversation_id.clone())
        .bind::<Nullable<Text>, _>(filter.conversation_id.clone())
        .load::<GroupRow>(conn)
}

/// Put a name to the keys that are ids.
///
/// Provider, model and bot are already readable — the key *is* the name, either
/// snapshotted or a number. The other two point at rows that may be gone, which
/// is why this leaves `label` as `None` rather than substituting the id: a
/// deleted conversation should read as deleted, not as a title nobody chose.
fn label(conn: &mut SqliteConnection, dimension: UsageDimension, buckets: &mut [UsageBucket]) -> QueryResult<()> {
    match dimension {
        UsageDimension::Conversation => {
            let ids: Vec<&str> = buckets.iter().map(|b| b.key.as_str()).collect();
            let titles: HashMap<String, Option<String>> = conversations::table
                .filter(conversations::id.eq_any(&ids))
                .select((conversations::id, conversations::title))
                .load::<(String, Option<String>)>(conn)?
                .into_iter()
                .collect();
            for bucket in buckets.iter_mut() {
                bucket.label = titles.get(&bucket.key).cloned().flatten();
            }
        }
        UsageDimension::Source => {
            let named: HashMap<String, String> = projects::table
                .filter(projects::source_id.is_not_null())
                .select((projects::source_type, projects::source_id, projects::name))
                .load::<(String, Option<String>, String)>(conn)?
                .into_iter()
                .filter_map(|(kind, id, name)| Some((format!("{kind}:{}", id?), name)))
                .collect();
            for bucket in buckets.iter_mut() {
                bucket.label = named.get(&bucket.key).cloned();
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::audit::NewAuditMessage;
    use crate::db::schema::audit_messages;
    use crate::db::test_db;

    /// Straight into the table. `record` is exercised by its own module's tests;
    /// what these need is control over prices and timestamps, which a real turn
    /// does not offer.
    #[allow(clippy::too_many_arguments)]
    fn reply(
        conn: &mut SqliteConnection,
        id: &str,
        model: &str,
        created_at: i64,
        tokens: (i32, i32, i32, i32),
        prices: Option<(f64, f64)>,
        origin: &str,
    ) {
        let (input, output, cache_read, cache_write) = tokens;
        diesel::insert_into(audit_messages::table)
            .values(&NewAuditMessage {
                id,
                recorded_at: created_at,
                message_id: id,
                conversation_id: "c1",
                turn_id: None,
                source_type: Some("onebot_group"),
                source_id: Some("900"),
                turn_origin: Some(origin),
                role: "assistant",
                content: "",
                sender_id: None,
                sender_name: None,
                provider_id: Some("p1"),
                provider_name: Some("Acme"),
                model_id: Some(model),
                input_tokens: Some(input),
                output_tokens: Some(output),
                cache_read_tokens: Some(cache_read),
                cache_write_tokens: Some(cache_write),
                created_at,
                input_price: prices.map(|p| p.0),
                output_price: prices.map(|p| p.1),
                cache_read_price: None,
                cache_write_price: None,
                server_tool_calls: None,
                server_tool_price: None,
                billing_mode: "metered",
                self_id: Some(10001),
            })
            .execute(conn)
            .unwrap();
    }

    /// A provider and a priced model, so the fallback in `resolve` has something
    /// to find. Without this the tests below could not tell "refused to price"
    /// from "had no price to use".
    fn seed_model(conn: &mut SqliteConnection, model: &str, input: f64, output: f64) {
        use crate::db::models::model_config::NewModelConfig;
        use crate::db::models::provider::NewProvider;

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
                catalog_id: None,
                credential_kind: "api_key",
                transport_profile: "standard",
            })
            .execute(conn)
            .unwrap();
        crate::db::ops::model_config::upsert(
            conn,
            &NewModelConfig {
                id: "mc1",
                provider_id: "p1",
                model_id: model,
                display_name: None,
                context_window: 1,
                compact_threshold: 1,
                max_output_tokens: None,
                input_price: input,
                output_price: output,
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
    }

    /// A reply under a given billing mode, with no snapshotted rates — the shape
    /// that makes the price fallback reachable.
    fn reply_billed(conn: &mut SqliteConnection, id: &str, model: &str, mode: &str, tokens: (i32, i32)) {
        diesel::insert_into(audit_messages::table)
            .values(&NewAuditMessage {
                id,
                recorded_at: 1,
                message_id: id,
                conversation_id: "c1",
                turn_id: None,
                source_type: None,
                source_id: None,
                turn_origin: Some("desktop"),
                role: "assistant",
                content: "",
                sender_id: None,
                sender_name: None,
                provider_id: Some("p1"),
                provider_name: Some("Acme"),
                model_id: Some(model),
                input_tokens: Some(tokens.0),
                output_tokens: Some(tokens.1),
                cache_read_tokens: Some(0),
                cache_write_tokens: Some(0),
                created_at: 1,
                input_price: None,
                output_price: None,
                cache_read_price: None,
                cache_write_price: None,
                server_tool_calls: None,
                server_tool_price: None,
                billing_mode: mode,
                self_id: None,
            })
            .execute(conn)
            .unwrap();
    }

    /// The same shape as [`reply_billed`], in a conversation of its own.
    ///
    /// Separate because every other fixture here writes `c1`, and a scope test
    /// needs at least two conversations to mean anything.
    fn reply_in(conn: &mut SqliteConnection, id: &str, conversation: &str, tokens: (i32, i32)) {
        diesel::insert_into(audit_messages::table)
            .values(&NewAuditMessage {
                id,
                recorded_at: 1,
                message_id: id,
                conversation_id: conversation,
                turn_id: None,
                source_type: None,
                source_id: None,
                turn_origin: Some("desktop"),
                role: "assistant",
                content: "",
                sender_id: None,
                sender_name: None,
                provider_id: Some("p1"),
                provider_name: Some("Acme"),
                model_id: Some("m1"),
                input_tokens: Some(tokens.0),
                output_tokens: Some(tokens.1),
                cache_read_tokens: Some(0),
                cache_write_tokens: Some(0),
                created_at: 1,
                input_price: None,
                output_price: None,
                cache_read_price: None,
                cache_write_price: None,
                server_tool_calls: None,
                server_tool_price: None,
                billing_mode: "metered",
                self_id: None,
            })
            .execute(conn)
            .unwrap();
    }

    /// The scope the ACP bridge rests on: one conversation, nothing else.
    #[test]
    fn a_conversation_filter_excludes_every_other_conversation() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        seed_model(&mut conn, "m1", 1.0, 2.0);
        reply_in(&mut conn, "a1", "mine", (10, 10));
        reply_in(&mut conn, "b1", "theirs", (500, 500));
        reply_in(&mut conn, "b2", "theirs", (500, 500));

        let scoped = report(
            &mut conn,
            UsageDimension::Total,
            &UsageFilter {
                conversation_id: Some("mine".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(scoped[0].messages, 1, "somebody else's replies were counted");
        assert_eq!(scoped[0].input_tokens, 10);

        let unscoped = report(&mut conn, UsageDimension::Total, &UsageFilter::default()).unwrap();
        assert_eq!(unscoped[0].messages, 3, "an absent filter still means the whole log");
    }

    /// Changing the grouping must not be the way out of the scope.
    ///
    /// `Conversation` is the dimension that would do it if the scope were a
    /// grouping rather than a filter: asked to break the ledger down by
    /// conversation, a scoped report may answer with exactly one row and no
    /// other conversation may appear in it — not even as a key.
    #[test]
    fn no_dimension_widens_a_scoped_report() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        seed_model(&mut conn, "m1", 1.0, 2.0);
        reply_in(&mut conn, "a1", "mine", (10, 10));
        reply_in(&mut conn, "b1", "theirs", (10, 10));

        let filter = UsageFilter {
            conversation_id: Some("mine".into()),
            ..Default::default()
        };
        for dimension in [
            UsageDimension::Total,
            UsageDimension::Provider,
            UsageDimension::Model,
            UsageDimension::Bot,
            UsageDimension::Source,
            UsageDimension::Conversation,
            UsageDimension::Day,
            UsageDimension::Hour,
            UsageDimension::Kind,
        ] {
            let out = report(&mut conn, dimension, &filter).unwrap();
            let messages: i64 = out.iter().map(|b| b.messages).sum();
            assert_eq!(messages, 1, "{dimension:?} let another conversation's rows in");
            assert!(
                !out.iter().any(|b| b.key == "theirs"),
                "{dimension:?} named a conversation outside the scope"
            );
        }
    }

    /// The one that would have been silently wrong: a subscription request must
    /// not be priced off today's `model_configs`.
    ///
    /// Both rows here carry no snapshotted rate, so both reach the fallback —
    /// and the fixture's model *is* priced in `model_configs`. Told apart only
    /// by `billing_mode`, the metered one bills and the subscription one does
    /// not. Without the mode check they would bill identically, which is how a
    /// plan the user already paid for would appear a second time on this bill.
    #[test]
    fn a_subscription_is_not_priced_from_todays_configuration() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        seed_model(&mut conn, "m1", 1.0, 2.0);

        reply_billed(&mut conn, "a1", "m1", "metered", (1_000_000, 1_000_000));
        let metered = report(&mut conn, UsageDimension::Total, &UsageFilter::default()).unwrap();
        assert_eq!(metered[0].cost, 3.0, "a metered row still falls back to today's rates");

        let pool2 = test_db();
        let mut conn2 = pool2.get().unwrap();
        seed_model(&mut conn2, "m1", 1.0, 2.0);
        reply_billed(&mut conn2, "b1", "m1", "subscription", (1_000_000, 1_000_000));
        let sub = report(&mut conn2, UsageDimension::Total, &UsageFilter::default()).unwrap();
        assert_eq!(sub[0].cost, 0.0, "a subscription must not be priced");
        assert_eq!(sub[0].input_tokens, 1_000_000, "its tokens are still counted");
    }

    /// A subscription has no rate to go and find, so reporting it as a shortfall
    /// produces a warning nobody can clear.
    #[test]
    fn only_metered_traffic_can_be_unpriced() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        // No `seed_model`, so nothing is priced anywhere.
        reply_billed(&mut conn, "a1", "unpriced", "metered", (10, 10));
        reply_billed(&mut conn, "b1", "unpriced", "subscription", (10, 10));
        reply_billed(&mut conn, "c1", "unpriced", "external", (10, 10));

        let out = report(&mut conn, UsageDimension::Total, &UsageFilter::default()).unwrap();
        assert_eq!(out[0].messages, 3, "all three are still counted as replies");
        assert_eq!(out[0].unpriced_messages, 1, "only the metered one is a missing price");
    }

    /// Junk in the column reads as `metered`, which keeps the request in the
    /// ledger. Treating it as unbillable would make spend disappear silently.
    #[test]
    fn an_unreadable_billing_mode_is_treated_as_metered() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        seed_model(&mut conn, "m1", 1.0, 2.0);
        reply_billed(&mut conn, "a1", "m1", "who knows", (1_000_000, 0));

        let out = report(&mut conn, UsageDimension::Total, &UsageFilter::default()).unwrap();
        assert_eq!(out[0].cost, 1.0);
    }

    /// The same model billed two ways over its life must not be merged into one
    /// group — the subscription half would be priced at the metered half's rates.
    #[test]
    fn the_two_modes_are_grouped_apart() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        seed_model(&mut conn, "m1", 1.0, 2.0);
        reply_billed(&mut conn, "a1", "m1", "metered", (1_000_000, 0));
        reply_billed(&mut conn, "b1", "m1", "subscription", (1_000_000, 0));

        let out = report(&mut conn, UsageDimension::Total, &UsageFilter::default()).unwrap();
        assert_eq!(out[0].messages, 2);
        assert_eq!(out[0].input_tokens, 2_000_000, "both rows' tokens are reported");
        assert_eq!(out[0].cost, 1.0, "but only the metered million is charged for");
    }

    /// The same, filed as an automatic review rather than as an answer.
    fn review(conn: &mut SqliteConnection, id: &str, created_at: i64, input: i32, price: f64) {
        diesel::insert_into(audit_messages::table)
            .values(&NewAuditMessage {
                id,
                recorded_at: created_at,
                message_id: id,
                conversation_id: "c1",
                turn_id: None,
                source_type: None,
                source_id: None,
                turn_origin: Some("desktop"),
                role: crate::db::ops::audit::AUTO_REVIEW_ROLE,
                content: "",
                sender_id: None,
                sender_name: None,
                provider_id: Some("p1"),
                provider_name: Some("Acme"),
                model_id: Some("cheap"),
                input_tokens: Some(input),
                output_tokens: Some(0),
                cache_read_tokens: Some(0),
                cache_write_tokens: Some(0),
                created_at,
                input_price: Some(price),
                output_price: Some(0.0),
                cache_read_price: None,
                cache_write_price: None,
                server_tool_calls: None,
                server_tool_price: None,
                billing_mode: "metered",
                self_id: None,
            })
            .execute(conn)
            .unwrap();
    }

    fn total(conn: &mut SqliteConnection, filter: &UsageFilter) -> UsageBucket {
        report(conn, UsageDimension::Total, filter)
            .unwrap()
            .pop()
            .unwrap_or_else(|| UsageBucket::empty(String::new()))
    }

    /// The whole point of snapshotting: a rate that changed mid-window bills
    /// each half at what it was, so the two halves cannot be added at one price.
    #[test]
    fn each_half_of_a_price_change_is_billed_at_its_own_rate() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        // A million input tokens at 10/M, then another million at 20/M.
        reply(
            &mut conn,
            "a",
            "m",
            1_000,
            (1_000_000, 0, 0, 0),
            Some((10.0, 0.0)),
            "desktop",
        );
        reply(
            &mut conn,
            "b",
            "m",
            2_000,
            (1_000_000, 0, 0, 0),
            Some((20.0, 0.0)),
            "desktop",
        );

        let all = total(&mut conn, &UsageFilter::default());
        assert_eq!(all.messages, 2);
        assert!((all.cost - 30.0).abs() < 0.001, "10 + 20, not 2 x either");
        assert_eq!(all.unpriced_messages, 0);
    }

    /// A model with tiered rates reaches this query as two price sets, and needs
    /// no special handling because of it.
    ///
    /// The tier was resolved when each row was written, from that request's own
    /// prompt — the one place it can be. Here there is only a `SUM` over rows
    /// that were separate requests, so re-deciding would mean inventing a prompt
    /// size, and the report would then disagree with the stop event the user was
    /// already shown.
    #[test]
    fn a_tiered_model_bills_each_side_of_the_threshold_at_its_own_rate() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        // grok-4.6: 100k under the 200k threshold at 2/M, then 250k over it at
        // 4/M — the whole prompt, not the excess.
        reply(
            &mut conn,
            "a",
            "grok-4.6",
            1_000,
            (100_000, 0, 0, 0),
            Some((2.0, 6.0)),
            "desktop",
        );
        reply(
            &mut conn,
            "b",
            "grok-4.6",
            2_000,
            (250_000, 0, 0, 0),
            Some((4.0, 12.0)),
            "desktop",
        );

        let all = total(&mut conn, &UsageFilter::default());
        assert_eq!(all.messages, 2);
        assert!((all.cost - 1.2).abs() < 1e-9, "0.2 + 1.0, got {}", all.cost);
        // And the model is still one row in the breakdown: the tier is a price,
        // not an identity.
        let by_model = report(&mut conn, UsageDimension::Model, &UsageFilter::default()).unwrap();
        assert_eq!(by_model.len(), 1);
        assert_eq!(by_model[0].input_tokens, 350_000);
    }

    /// Reviews are spend the user did not ask for directly, so a total that
    /// leaves them out is smaller than the truth — the same failure as
    /// reporting unpriced traffic as free.
    #[test]
    fn a_review_counts_towards_the_total() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        reply(
            &mut conn,
            "a",
            "m",
            1_000,
            (1_000_000, 0, 0, 0),
            Some((10.0, 0.0)),
            "desktop",
        );
        review(&mut conn, "r", 1_100, 1_000_000, 2.0);

        let all = total(&mut conn, &UsageFilter::default());
        assert_eq!(all.messages, 2);
        assert!((all.cost - 12.0).abs() < 0.001, "the review is part of what was spent");
    }

    /// And they have to be separable, or the total is a number nobody can act
    /// on: turning the reviewer off is only a decision you can make if you can
    /// see what it costs.
    #[test]
    fn the_two_kinds_of_spend_can_be_told_apart() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        reply(
            &mut conn,
            "a",
            "m",
            1_000,
            (1_000_000, 0, 0, 0),
            Some((10.0, 0.0)),
            "desktop",
        );
        review(&mut conn, "r", 1_100, 1_000_000, 2.0);

        let by_kind = report(&mut conn, UsageDimension::Kind, &UsageFilter::default()).unwrap();
        let of = |key: &str| by_kind.iter().find(|b| b.key == key).map(|b| b.cost).unwrap_or(0.0);
        assert!((of("assistant") - 10.0).abs() < 0.001);
        assert!((of("auto_review") - 2.0).abs() < 0.001);
    }

    /// A cached token is billed once. The same rule `compute_cost` is tested for
    /// has to survive being reached through a `GROUP BY`.
    #[test]
    fn the_cache_discount_survives_aggregation() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        // 900k of the million prompt tokens came from the cache, and the cache
        // read price is blank — so they bill at the input rate, once.
        reply(
            &mut conn,
            "a",
            "m",
            1_000,
            (1_000_000, 0, 900_000, 0),
            Some((10.0, 0.0)),
            "desktop",
        );

        let all = total(&mut conn, &UsageFilter::default());
        assert!((all.cost - 10.0).abs() < 0.001, "the prompt is charged once over");
        assert_eq!(all.cache_read_tokens, 900_000);
    }

    /// Traffic on an unpriced model is counted and reported as unpriced. It must
    /// not be dropped — that loses the tokens — and must not be billed at zero
    /// without saying so.
    #[test]
    fn traffic_with_no_price_is_counted_apart_rather_than_billed_at_nothing() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        reply(
            &mut conn,
            "a",
            "priced",
            1_000,
            (100, 200, 0, 0),
            Some((10.0, 30.0)),
            "desktop",
        );
        reply(&mut conn, "b", "free", 2_000, (500, 500, 0, 0), None, "desktop");

        let all = total(&mut conn, &UsageFilter::default());
        assert_eq!(all.messages, 2);
        assert_eq!(all.unpriced_messages, 1);
        assert_eq!(all.input_tokens, 600, "the tokens are still counted");
        assert!(all.cost > 0.0, "the priced half still bills");
    }

    /// A row from before migration 30 has no price on it. Today's configuration
    /// is the only number that exists for it, and reporting the traffic as free
    /// would be a worse answer than a retroactive one.
    #[test]
    fn a_row_recorded_before_prices_were_kept_falls_back_to_the_current_one() {
        use crate::db::models::model_config::NewModelConfig;
        use crate::db::models::provider::NewProvider;

        let pool = test_db();
        let mut conn = pool.get().unwrap();
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
                catalog_id: None,
                credential_kind: "api_key",
                transport_profile: "standard",
            })
            .execute(&mut conn)
            .unwrap();
        crate::db::ops::model_config::upsert(
            &mut conn,
            &NewModelConfig {
                id: "mc1",
                provider_id: "p1",
                model_id: "m",
                display_name: None,
                context_window: 1,
                compact_threshold: 1,
                max_output_tokens: None,
                input_price: 10.0,
                output_price: 0.0,
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

        reply(&mut conn, "a", "m", 1_000, (1_000_000, 0, 0, 0), None, "desktop");

        let all = total(&mut conn, &UsageFilter::default());
        assert_eq!(all.unpriced_messages, 0, "there is a price, just not on the row");
        assert!((all.cost - 10.0).abs() < 0.001);
    }

    /// A model priced at 0/0 is one nobody has filled in — the editor opens that
    /// way — not one that is free.
    #[test]
    fn a_model_left_at_zero_reads_as_unpriced() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        reply(
            &mut conn,
            "a",
            "m",
            1_000,
            (100, 200, 0, 0),
            Some((0.0, 0.0)),
            "desktop",
        );

        assert_eq!(total(&mut conn, &UsageFilter::default()).unpriced_messages, 1);
    }

    /// The window is half-open, so two adjacent reports over adjacent windows
    /// count every reply exactly once.
    #[test]
    fn the_window_excludes_its_upper_bound() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        reply(&mut conn, "a", "m", 1_000, (10, 0, 0, 0), Some((1.0, 1.0)), "desktop");
        reply(&mut conn, "b", "m", 2_000, (10, 0, 0, 0), Some((1.0, 1.0)), "desktop");

        let first = UsageFilter {
            until_ms: Some(2_000),
            ..Default::default()
        };
        let second = UsageFilter {
            since_ms: Some(2_000),
            ..Default::default()
        };
        assert_eq!(total(&mut conn, &first).messages, 1);
        assert_eq!(total(&mut conn, &second).messages, 1);
    }

    #[test]
    fn origin_separates_bot_traffic_from_the_desktop() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        reply(&mut conn, "a", "m", 1_000, (10, 0, 0, 0), Some((1.0, 1.0)), "desktop");
        reply(&mut conn, "b", "m", 2_000, (20, 0, 0, 0), Some((1.0, 1.0)), "onebot");
        reply(&mut conn, "c", "m", 3_000, (30, 0, 0, 0), Some((1.0, 1.0)), "onebot");

        let bots = UsageFilter {
            origin: Some("onebot".into()),
            ..Default::default()
        };
        assert_eq!(total(&mut conn, &bots).messages, 2);
        assert_eq!(total(&mut conn, &bots).input_tokens, 50);
    }

    /// Every breakdown has to add up to the headline it sits under. They are the
    /// same query with a different key for exactly this reason.
    #[test]
    fn a_breakdown_adds_up_to_the_total_above_it() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        reply(
            &mut conn,
            "a",
            "big",
            1_000,
            (1_000, 500, 0, 0),
            Some((10.0, 30.0)),
            "desktop",
        );
        reply(
            &mut conn,
            "b",
            "small",
            2_000,
            (300, 100, 0, 0),
            Some((2.0, 6.0)),
            "onebot",
        );
        reply(
            &mut conn,
            "c",
            "big",
            3_000,
            (700, 200, 0, 0),
            Some((10.0, 30.0)),
            "onebot",
        );

        let all = total(&mut conn, &UsageFilter::default());
        let by_model = report(&mut conn, UsageDimension::Model, &UsageFilter::default()).unwrap();

        assert_eq!(by_model.len(), 2);
        assert_eq!(by_model.iter().map(|b| b.messages).sum::<i64>(), all.messages);
        let summed: f64 = by_model.iter().map(|b| b.cost).sum();
        assert!((summed - all.cost).abs() < 1e-9);
        assert_eq!(by_model[0].key, "big", "the expensive one comes first");
    }

    /// A conversation that has been deleted still owes its share of the bill,
    /// and says so by having no title rather than by disappearing.
    #[test]
    fn a_deleted_conversation_keeps_its_row_and_loses_its_name() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        crate::db::ops::conversation::create_conversation(&mut conn, "c1", Some("Named"), None, None, 1).unwrap();
        reply(&mut conn, "a", "m", 1_000, (100, 0, 0, 0), Some((10.0, 0.0)), "desktop");

        let named = report(&mut conn, UsageDimension::Conversation, &UsageFilter::default()).unwrap();
        assert_eq!(named[0].label.as_deref(), Some("Named"));

        crate::db::ops::conversation::delete_conversation(&mut conn, "c1").unwrap();

        let orphaned = report(&mut conn, UsageDimension::Conversation, &UsageFilter::default()).unwrap();
        assert_eq!(orphaned.len(), 1, "the cost outlives the transcript");
        assert_eq!(orphaned[0].key, "c1");
        assert_eq!(orphaned[0].label, None);
    }

    /// A private chat and a group can carry the same number. Keying on the id
    /// alone would add two different places together.
    #[test]
    fn a_source_key_carries_its_kind() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        reply(&mut conn, "a", "m", 1_000, (100, 0, 0, 0), Some((10.0, 0.0)), "onebot");

        let sources = report(&mut conn, UsageDimension::Source, &UsageFilter::default()).unwrap();
        assert_eq!(sources[0].key, "onebot_group:900");
    }

    #[test]
    fn a_series_reads_forwards_and_splits_on_the_local_day() {
        let pool = test_db();
        let mut conn = pool.get().unwrap();
        // Two days apart, so no timezone puts them in the same bucket.
        reply(
            &mut conn,
            "a",
            "m",
            1_700_000_000_000,
            (10, 0, 0, 0),
            Some((1.0, 1.0)),
            "desktop",
        );
        reply(
            &mut conn,
            "b",
            "m",
            1_700_180_000_000,
            (20, 0, 0, 0),
            Some((1.0, 1.0)),
            "desktop",
        );

        let days = report(&mut conn, UsageDimension::Day, &UsageFilter::default()).unwrap();
        assert_eq!(days.len(), 2);
        assert!(days[0].key < days[1].key, "oldest first");
        assert_eq!(days[0].input_tokens, 10);
    }
}
