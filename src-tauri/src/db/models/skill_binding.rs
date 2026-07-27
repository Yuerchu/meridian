use diesel::prelude::*;
use serde::Serialize;

use crate::db::schema::{skill_bindings_assistant, skill_bindings_global, skill_bindings_project};

/// Which anchor a skill binding hangs off. Bindings are layered rather than
/// collected into one central set: a skill pinned globally stays available even
/// on an assistant the user cannot (or does not want to) edit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillLayer {
    Global,
    Project,
    Assistant,
}

impl SkillLayer {
    pub fn as_str(&self) -> &'static str {
        match self {
            SkillLayer::Global => "global",
            SkillLayer::Project => "project",
            SkillLayer::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable, Serialize)]
#[diesel(table_name = skill_bindings_global)]
pub struct GlobalSkillBinding {
    pub dir_name: String,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable, Serialize)]
#[diesel(table_name = skill_bindings_project)]
pub struct ProjectSkillBinding {
    pub project_id: String,
    pub dir_name: String,
}

#[derive(Debug, Clone, Queryable, Selectable, Insertable, Serialize)]
#[diesel(table_name = skill_bindings_assistant)]
pub struct AssistantSkillBinding {
    pub assistant_id: String,
    pub dir_name: String,
}
