//! The register behind `commands::system_notice`: notices held in memory for
//! as long as this process runs, and published to the window as they change.
//!
//! In memory on purpose. A notice says what the app did since it started;
//! after a restart the next run either has something to say or it does not,
//! and a failure that still stands is found again by whatever produced it.

use std::sync::Mutex;

use crate::commands::system_notice::{SystemNoticeDetail, SystemNoticeEvent, SystemNoticeInfoResponse};

type Publish = Box<dyn Fn(&SystemNoticeEvent) + Send + Sync>;

pub struct SystemNotices {
    notices: Mutex<Vec<SystemNoticeInfoResponse>>,
    publish: Publish,
}

impl SystemNotices {
    /// `publish` is how a change reaches the window; the app passes an
    /// `AppHandle::emit`, a test a recorder.
    pub fn new(publish: impl Fn(&SystemNoticeEvent) + Send + Sync + 'static) -> Self {
        Self {
            notices: Mutex::new(Vec::new()),
            publish: Box::new(publish),
        }
    }

    /// Emits to the window, and logs rather than fails when it cannot: a
    /// notice nobody saw is still in the register for the next `list`.
    pub fn to_window(app: tauri::AppHandle) -> Self {
        use tauri::Emitter;
        Self::new(move |event| {
            if let Err(e) = app.emit(crate::commands::system_notice::SYSTEM_NOTICE_CHANNEL, event) {
                tracing::warn!(error = %e, "system notice not delivered to the window");
            }
        })
    }

    pub fn list(&self) -> Vec<SystemNoticeInfoResponse> {
        self.lock().clone()
    }

    /// Starts a notice and returns its id.
    pub fn start(&self, detail: SystemNoticeDetail) -> String {
        let started_at = now_ms();
        let notice = SystemNoticeInfoResponse {
            id: uuid::Uuid::new_v4().to_string(),
            started_at,
            finished_at: None,
            detail,
        };
        let id = notice.id.clone();
        self.upsert(notice);
        id
    }

    /// Replaces what a notice says; `finished` stamps it done.
    pub fn update(&self, id: &str, detail: SystemNoticeDetail, finished: bool) {
        let Some(mut notice) = self.lock().iter().find(|n| n.id == id).cloned() else {
            return;
        };
        notice.detail = detail;
        if finished {
            notice.finished_at = Some(now_ms());
        }
        self.upsert(notice);
    }

    pub fn dismiss(&self, id: &str) -> Result<(), String> {
        {
            let mut notices = self.lock();
            let Some(at) = notices.iter().position(|n| n.id == id) else {
                return Err(format!("no notice {id}"));
            };
            if notices[at].finished_at.is_none() {
                return Err("that is still going".into());
            }
            notices.remove(at);
        }
        (self.publish)(&SystemNoticeEvent::Dismiss { id: id.to_string() });
        Ok(())
    }

    fn upsert(&self, notice: SystemNoticeInfoResponse) {
        {
            let mut notices = self.lock();
            match notices.iter_mut().find(|n| n.id == notice.id) {
                Some(slot) => *slot = notice.clone(),
                None => notices.push(notice.clone()),
            }
        }
        (self.publish)(&SystemNoticeEvent::Upsert { notice });
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<SystemNoticeInfoResponse>> {
        // A panic while holding it left a list of whole notices behind; the
        // register has no invariant a half-done write could break.
        self.notices.lock().unwrap_or_else(|p| p.into_inner())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::commands::system_notice::ImeDictionaryUpgradeState;

    fn detail(state: ImeDictionaryUpgradeState) -> SystemNoticeDetail {
        SystemNoticeDetail::ImeDictionaryUpgrade {
            state,
            dictionaries: vec!["雾凇拼音".into()],
            upgraded: 0,
            failures: Vec::new(),
        }
    }

    #[test]
    fn a_notice_is_published_as_it_changes_and_dismissed_only_when_done() {
        let seen: Arc<Mutex<Vec<SystemNoticeEvent>>> = Arc::default();
        let recorder = seen.clone();
        let notices = SystemNotices::new(move |e| recorder.lock().unwrap().push(e.clone()));

        let id = notices.start(detail(ImeDictionaryUpgradeState::Running));
        assert!(notices.dismiss(&id).is_err(), "a running notice stays");
        notices.update(&id, detail(ImeDictionaryUpgradeState::Succeeded), true);
        let list = notices.list();
        assert_eq!(list.len(), 1, "an update replaces, it does not add");
        assert!(list[0].finished_at.is_some());
        notices.dismiss(&id).unwrap();
        assert!(notices.list().is_empty());
        assert!(notices.dismiss(&id).is_err());

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 3, "start, update, dismiss");
        assert!(matches!(&seen[2], SystemNoticeEvent::Dismiss { id: d } if *d == id));
    }
}
