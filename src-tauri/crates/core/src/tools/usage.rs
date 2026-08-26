//! What one conversation has cost, for an agent that wants to know.
//!
//! **The conversation is a constructor parameter, not an argument**, which is
//! the whole of this tool's security story. `db::ops::usage::report` reads the
//! entire ledger — every conversation, every provider, back to the first row —
//! and the only thing that narrows it is [`UsageFilter::conversation_id`].
//! Taking that from the model would make the scope a suggestion: it could ask
//! about somebody else's work by naming it, and it would not even have to guess
//! an id, since `UsageDimension::Conversation` hands them out.
//!
//! So the id is baked in where the tool is built, exactly as
//! [`super::app_logs::ReadAppLogsTool`] bakes in the log directory and for the
//! same stated reason: a tool that takes no path has nothing to traverse. The
//! schema below has no field naming a conversation, a project or a user, and
//! there is nothing to validate at execution time because there is nothing the
//! model can say.
//!
//! **Not in the registry.** This is built by [`crate::acp::bridge`] and nothing
//! else. Registering it would put a spending report in every native turn's tool
//! array — a change to what the desktop offers, made in passing by a feature
//! about hosting somebody else's agent — and it would have to be unscoped there
//! to be useful, which is the thing this module exists not to be.

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{Permission, Tool, ToolContext};
use crate::db::ops::usage::{UsageBucket, UsageDimension, UsageFilter, report};

/// How far back a request may look, in days.
///
/// Not a security boundary — the scope is — but a conversation that has run for
/// months would otherwise render a row per day for all of them.
const MAX_DAYS: i64 = 90;
const DEFAULT_DAYS: i64 = 30;
/// Rows rendered. A breakdown longer than this is not being read.
const MAX_ROWS: usize = 20;

pub struct ConversationUsageTool {
    conversation_id: String,
}

impl ConversationUsageTool {
    pub fn new(conversation_id: String) -> Self {
        Self { conversation_id }
    }
}

#[async_trait]
impl Tool for ConversationUsageTool {
    fn name(&self) -> &str {
        "conversation_usage"
    }

    fn description(&self) -> &str {
        "Report the tokens and cost recorded for THIS conversation. Covers only the current \
         conversation — there is no way to ask about another one, or about the application as a \
         whole. Figures come from the billing ledger, which keeps a request's price as it was when \
         the request was made."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "group_by": {
                    "type": "string",
                    "enum": ["total", "model", "day", "kind"],
                    "description": "How to break the figures down. 'total' is one line and is the \
                                    default. 'kind' separates answering the user from the requests \
                                    the app makes on its own behalf, such as summarising."
                },
                "days": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_DAYS,
                    "description": "How far back to look. Defaults to 30."
                }
            },
            "required": []
        })
    }

    /// Read-only and confined to the conversation it is already part of, so
    /// there is nothing for a person to weigh.
    fn default_permission(&self) -> Permission {
        Permission::Always
    }

    async fn execute(&self, args: Value, context: &ToolContext) -> Result<String, String> {
        let dimension = match args.get("group_by").and_then(Value::as_str).unwrap_or("total") {
            "model" => UsageDimension::Model,
            "day" => UsageDimension::Day,
            "kind" => UsageDimension::Kind,
            // Anything unrecognised reads as the headline rather than
            // erroring: the enum is advisory to the model and a typo should
            // not cost a turn.
            _ => UsageDimension::Total,
        };
        let days = args
            .get("days")
            .and_then(Value::as_i64)
            .unwrap_or(DEFAULT_DAYS)
            .clamp(1, MAX_DAYS);

        // `self`, never `context.conversation_id` — which would look equivalent
        // and is not. The bridge builds this tool once per session, while the
        // context is rebuilt for each call out of whatever turn is running, so
        // reading the scope from there would make it depend on the moment the
        // call happened to arrive. The context is consulted for the pool alone.
        let filter = UsageFilter {
            since_ms: Some(crate::util::now_ms() - days * 86_400_000),
            conversation_id: Some(self.conversation_id.clone()),
            ..Default::default()
        };

        let pool = context
            .db_pool
            .as_ref()
            .ok_or("Usage is unavailable: no database handle")?
            .clone();
        let buckets = tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|e| e.to_string())?;
            report(&mut conn, dimension, &filter).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

        Ok(render(&buckets, dimension, days))
    }
}

fn render(buckets: &[UsageBucket], dimension: UsageDimension, days: i64) -> String {
    if buckets.is_empty() {
        return format!("No recorded usage for this conversation in the last {days} days.");
    }

    let mut out = format!("Usage for this conversation, last {days} days:\n");
    for bucket in buckets.iter().take(MAX_ROWS) {
        let name = bucket.label.as_deref().unwrap_or(&bucket.key);
        let label = if dimension == UsageDimension::Total {
            "total".to_string()
        } else {
            name.to_string()
        };
        out.push_str(&format!(
            "- {label}: {} replies, {} in / {} out tokens",
            bucket.messages, bucket.input_tokens, bucket.output_tokens
        ));
        if bucket.cache_read_tokens > 0 || bucket.cache_write_tokens > 0 {
            out.push_str(&format!(
                " ({} cached read, {} cached write)",
                bucket.cache_read_tokens, bucket.cache_write_tokens
            ));
        }
        out.push_str(&format!(", ${:.4}\n", bucket.cost));
    }

    if buckets.len() > MAX_ROWS {
        out.push_str(&format!("({} more rows omitted.)\n", buckets.len() - MAX_ROWS));
    }

    // Never dropped, and said as a sentence rather than a number in a column.
    // `UsageBucket` asks every caller to surface this: an unpriced reply is
    // spend of an unknown size, and a total that swallows it is smaller than
    // the truth with nothing to say so.
    let unpriced: i64 = buckets.iter().map(|b| b.unpriced_messages).sum();
    if unpriced > 0 {
        out.push_str(&format!(
            "\nNote: {unpriced} of these replies came from a model nobody has priced, so the cost \
             above is lower than what was actually spent.\n"
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bucket(key: &str, messages: i64, cost: f64, unpriced: i64) -> UsageBucket {
        UsageBucket {
            key: key.into(),
            label: None,
            messages,
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cost,
            unpriced_messages: unpriced,
        }
    }

    /// The scope is not expressible, which is the point of the whole module.
    /// A field naming a conversation, a project or an id would be a way to ask
    /// about somebody else's work.
    #[test]
    fn the_schema_offers_no_way_to_name_another_conversation() {
        let schema = ConversationUsageTool::new("c-1".into()).parameters_schema();
        let properties = schema.get("properties").and_then(Value::as_object).unwrap();
        assert_eq!(properties.len(), 2, "an unexpected parameter appeared: {properties:?}");
        for name in properties.keys() {
            assert!(
                !name.contains("conversation") && !name.contains("project") && !name.contains("id"),
                "`{name}` lets the model choose a scope"
            );
        }
    }

    #[test]
    fn an_empty_report_says_so_rather_than_erroring() {
        let out = render(&[], UsageDimension::Total, 30);
        assert!(out.contains("No recorded usage"), "{out}");
    }

    /// The one thing `UsageBucket` asks every caller to do.
    #[test]
    fn unpriced_replies_are_reported_beside_the_total() {
        let out = render(&[bucket("total", 5, 1.25, 2)], UsageDimension::Total, 30);
        assert!(out.contains("$1.2500"), "{out}");
        assert!(out.contains("2 of these replies"), "{out}");
        assert!(out.contains("lower than what was actually spent"), "{out}");
    }

    #[test]
    fn a_fully_priced_report_carries_no_warning() {
        let out = render(&[bucket("total", 5, 1.25, 0)], UsageDimension::Total, 30);
        assert!(!out.contains("nobody has priced"), "{out}");
    }

    #[test]
    fn a_long_breakdown_is_cut_and_says_how_much_it_dropped() {
        let rows: Vec<UsageBucket> = (0..MAX_ROWS + 5).map(|i| bucket(&format!("m{i}"), 1, 0.1, 0)).collect();
        let out = render(&rows, UsageDimension::Model, 30);
        assert!(out.contains("5 more rows omitted"), "{out}");
    }
}
