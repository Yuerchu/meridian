use std::collections::HashMap;

use crate::db::DbPool;
use crate::{get_conn, now_ms};

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct SessionKey {
    pub kind: SessionKind,
    pub id: i64,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub enum SessionKind {
    Private,
    Group,
}

impl SessionKey {
    pub fn private(user_id: i64) -> Self {
        Self { kind: SessionKind::Private, id: user_id }
    }

    pub fn group(group_id: i64) -> Self {
        Self { kind: SessionKind::Group, id: group_id }
    }

    pub fn pref_key(&self) -> String {
        match self.kind {
            SessionKind::Private => format!("onebot.session.private:{}", self.id),
            SessionKind::Group => format!("onebot.session.group:{}", self.id),
        }
    }
}

impl std::fmt::Display for SessionKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.kind {
            SessionKind::Private => write!(f, "private:{}", self.id),
            SessionKind::Group => write!(f, "group:{}", self.id),
        }
    }
}

pub struct SessionManager {
    cache: HashMap<String, String>,
    pool: DbPool,
}

impl SessionManager {
    pub fn new(pool: DbPool) -> Self {
        Self { cache: HashMap::new(), pool }
    }

    /// Get or create a conversation_id for the given session key.
    /// `title` is used only when creating a new conversation.
    pub fn get_or_create(
        &mut self,
        key: &SessionKey,
        title: &str,
        assistant_id: Option<&str>,
    ) -> Result<String, String> {
        let pref_key = key.pref_key();

        let mut conn = get_conn(&self.pool)?;

        // Check in-memory cache, verify conversation still exists
        if let Some(conv_id) = self.cache.get(&pref_key).cloned() {
            if crate::db::ops::conversation::get_conversation(&mut conn, &conv_id).is_ok() {
                return Ok(conv_id);
            }
            self.cache.remove(&pref_key);
        }

        // Check preferences (persisted sessions)
        if let Ok(Some(conv_id)) =
            crate::db::ops::preference::get_preference(&mut conn, &pref_key)
        {
            if crate::db::ops::conversation::get_conversation(&mut conn, &conv_id).is_ok() {
                self.cache.insert(pref_key, conv_id.clone());
                return Ok(conv_id);
            }
        }

        // Create new conversation
        let conv_id = uuid::Uuid::new_v4().to_string();
        let now = now_ms();
        crate::db::ops::conversation::create_conversation(
            &mut conn,
            &conv_id,
            Some(title),
            assistant_id,
            None,
            now,
        )
        .map_err(|e| format!("Failed to create conversation: {e}"))?;

        // Persist the mapping
        crate::db::ops::preference::set_preference(&mut conn, &pref_key, &conv_id, now)
            .map_err(|e| format!("Failed to save session mapping: {e}"))?;

        self.cache.insert(pref_key, conv_id.clone());
        Ok(conv_id)
    }
}
