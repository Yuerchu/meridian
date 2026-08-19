//! What the reviewer answers, and how that answer is read back.
//!
//! Four fields rather than a boolean, and the reason is the case a boolean
//! cannot express: an action that is genuinely dangerous *and* was explicitly
//! asked for. `rm -rf ./build` is high risk and correctly allowed; the same
//! command against a path nobody mentioned is the same risk and must not be.
//! Risk and authorization are therefore scored separately and the outcome is
//! the reviewer's own reading of the pair — the policy tells it how, but this
//! module never re-derives an outcome from the other two.
//!
//! There is no `response_format` anywhere in this codebase, so the shape is a
//! promise made in the prompt and checked here. The asymmetry that follows is
//! the whole point: **an answer that cannot be read is not a denial.** A
//! reviewer that rambles, hits its token ceiling, or returns prose costs a
//! fallback to whatever the caller does when it has no verdict — which on the
//! desktop is a card in front of the user. Reading "deny" out of an unparseable
//! reply would let a bad connection quietly become a policy.

use serde::Deserialize;

use crate::util::extract_last_json_object;

/// How much damage the action could do, taken on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

/// How well the user actually asked for *this* action against *this* target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthLevel {
    Unknown,
    Low,
    Medium,
    High,
}

/// The reviewer's verdict on the one action it was shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Allow,
    Deny,
}

/// A complete assessment, with every field filled in.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Assessment {
    pub risk: RiskLevel,
    pub authorization: AuthLevel,
    pub outcome: Outcome,
    pub rationale: String,
}

impl Assessment {
    /// Whether this verdict is confident enough to act on without a second look.
    ///
    /// An `allow` at `high` risk is the interesting case: the reviewer decided
    /// the user had authorised something dangerous, and that is exactly the
    /// judgement worth spending a second pass on when escalation is enabled.
    /// A `deny` is never settled either — the escalating pass exists to rescue
    /// false positives, which are what make an auto-review mode unusable.
    pub fn settled(&self) -> bool {
        self.outcome == Outcome::Allow && self.risk <= RiskLevel::Medium
    }
}

/// What came back, in three states rather than two.
#[derive(Debug, Clone)]
pub enum Read {
    /// A verdict that can be acted on.
    Verdict(Assessment),
    /// Nothing usable. Never a denial — see the module header.
    Unreadable(&'static str),
}

/// The wire shape. Only `outcome` is required; the policy explicitly permits
/// `{"outcome":"allow"}` alone for an action the reviewer considers routine,
/// which is most of them and where nearly all of the token savings live.
#[derive(Debug, Deserialize)]
struct Wire {
    outcome: String,
    #[serde(default)]
    risk_level: Option<String>,
    #[serde(default)]
    user_authorization: Option<String>,
    #[serde(default)]
    rationale: Option<String>,
}

/// Unknown enum values are read at their most cautious rather than rejected.
///
/// A reviewer that writes `"severe"` has still communicated something, and the
/// safe reading of a word we do not know is the worst one it could have meant.
/// `outcome` is the exception below: it is the field the whole contract rests
/// on, and guessing there would invent a decision nobody made.
fn risk_of(raw: Option<&str>, outcome: Outcome) -> RiskLevel {
    match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("low") => RiskLevel::Low,
        Some("medium") => RiskLevel::Medium,
        Some("high") => RiskLevel::High,
        Some("critical") => RiskLevel::Critical,
        Some(_) => RiskLevel::Critical,
        // Omitted. The short form is only sanctioned for `allow`, so absence
        // there means routine; absence beside a `deny` means the reviewer
        // refused something without saying how badly, which is not `low`.
        None => match outcome {
            Outcome::Allow => RiskLevel::Low,
            Outcome::Deny => RiskLevel::High,
        },
    }
}

fn auth_of(raw: Option<&str>) -> AuthLevel {
    match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("high") => AuthLevel::High,
        Some("medium") => AuthLevel::Medium,
        Some("low") => AuthLevel::Low,
        Some("unknown") => AuthLevel::Unknown,
        // Same rule as above, and `unknown` is already the cautious end of this
        // scale — it is what "nobody asked for this" is spelled as.
        Some(_) | None => AuthLevel::Unknown,
    }
}

/// Read the reviewer's answer.
///
/// Takes the *last* JSON object rather than the first, for the reason
/// `hooks::verdict` takes it: a reviewer quoting the arguments it is judging
/// puts a `{` on screen well before it puts its own verdict there.
pub fn parse(reply: &str) -> Read {
    let Some(raw) = extract_last_json_object(reply, |c| serde_json::from_str::<Wire>(c).is_ok()) else {
        return Read::Unreadable("审查回复里没有可用的裁决对象");
    };
    // The predicate above already proved this parses.
    let Ok(wire) = serde_json::from_str::<Wire>(&raw) else {
        return Read::Unreadable("审查回复里没有可用的裁决对象");
    };

    let outcome = match wire.outcome.trim().to_ascii_lowercase().as_str() {
        "allow" => Outcome::Allow,
        "deny" => Outcome::Deny,
        // The one field with no safe guess. "block", "reject", "maybe" — every
        // one of them is a reviewer that did not follow the contract, and
        // reading any of them as a decision would put words in its mouth.
        other => {
            tracing::warn!(outcome = %other, "auto review returned an outcome that is neither allow nor deny");
            return Read::Unreadable("审查裁决里的 outcome 不是 allow 或 deny");
        }
    };

    let rationale = wire
        .rationale
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .unwrap_or(match outcome {
            Outcome::Allow => "（未给出理由）",
            // Shown to the user on a card and handed to the model as the reason
            // its call failed, so it cannot be blank.
            Outcome::Deny => "审查判定风险不可接受，但未给出具体理由",
        })
        .to_string();

    Read::Verdict(Assessment {
        risk: risk_of(wire.risk_level.as_deref(), outcome),
        authorization: auth_of(wire.user_authorization.as_deref()),
        outcome,
        rationale,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verdict(reply: &str) -> Assessment {
        match parse(reply) {
            Read::Verdict(a) => a,
            Read::Unreadable(why) => panic!("expected a verdict, got: {why}"),
        }
    }

    fn unreadable(reply: &str) -> &'static str {
        match parse(reply) {
            Read::Verdict(a) => panic!("expected no verdict, got: {a:?}"),
            Read::Unreadable(why) => why,
        }
    }

    #[test]
    fn a_full_assessment_is_read_field_for_field() {
        let a = verdict(
            r#"分析略。
```json
{"risk_level":"high","user_authorization":"low","outcome":"deny","rationale":"目标不在用户提过的范围内"}
```"#,
        );
        assert_eq!(a.risk, RiskLevel::High);
        assert_eq!(a.authorization, AuthLevel::Low);
        assert_eq!(a.outcome, Outcome::Deny);
        assert_eq!(a.rationale, "目标不在用户提过的范围内");
    }

    /// The short form the policy sanctions for routine actions, and where
    /// nearly all of the token saving lives.
    #[test]
    fn the_short_allow_form_needs_nothing_else() {
        let a = verdict(r#"{"outcome":"allow"}"#);
        assert_eq!(a.outcome, Outcome::Allow);
        assert_eq!(a.risk, RiskLevel::Low);
        assert_eq!(a.authorization, AuthLevel::Unknown);
        assert!(a.settled(), "a routine allow should not need a second pass");
    }

    /// A refusal with no risk level attached is not a low-risk one. The short
    /// form was only ever sanctioned for `allow`.
    #[test]
    fn a_bare_deny_is_not_low_risk() {
        let a = verdict(r#"{"outcome":"deny"}"#);
        assert_eq!(a.risk, RiskLevel::High);
        assert!(!a.rationale.is_empty(), "a denial must always carry something to show");
    }

    /// A word we do not know is read as the worst thing it could have meant,
    /// on every field except the one the contract rests on.
    #[test]
    fn an_unknown_risk_word_is_read_at_its_worst() {
        let a = verdict(r#"{"outcome":"allow","risk_level":"severe","user_authorization":"probably"}"#);
        assert_eq!(a.risk, RiskLevel::Critical);
        assert_eq!(a.authorization, AuthLevel::Unknown);
        assert!(!a.settled(), "critical risk is never settled by the first pass");
    }

    /// The property the whole module exists for: an answer nobody can read is
    /// not a denial. Reading one out of a truncated reply would let a bad
    /// connection quietly become a policy.
    #[test]
    fn nothing_readable_is_never_a_denial() {
        for reply in [
            "",
            "我觉得这个操作有点危险，建议不要执行。",
            r#"{"outcome":"block"}"#,
            r#"{"outcome":"deny""#,
            "{}",
        ] {
            assert!(!unreadable(reply).is_empty(), "reply = {reply:?}");
        }
    }

    /// A reviewer quoting the arguments it is judging puts a `{` on screen well
    /// before its own verdict.
    #[test]
    fn the_last_object_wins_over_a_quoted_one() {
        let a = verdict(
            r#"这个调用的参数是 {"path":"/etc/passwd","outcome":"allow"}，看起来是要读系统文件。
```json
{"outcome":"deny","risk_level":"critical","rationale":"读取系统凭据文件"}
```"#,
        );
        assert_eq!(a.outcome, Outcome::Deny);
        assert_eq!(a.risk, RiskLevel::Critical);
    }

    /// An allow at high risk means the reviewer decided a dangerous thing was
    /// authorised — the single judgement most worth a second opinion.
    #[test]
    fn a_dangerous_allow_is_not_settled() {
        let a = verdict(r#"{"outcome":"allow","risk_level":"high","user_authorization":"high"}"#);
        assert_eq!(a.outcome, Outcome::Allow);
        assert!(!a.settled());
    }
}
