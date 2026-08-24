//! 语料的目录、单 writer 锁，和采集授权。
//!
//! 三件事放在一起，因为它们回答的是同一个问题：这段音频**能不能**落盘，
//! 以及落到哪里。
//!
//! 这一层不认识 OneBot 的会话类型——它拿到的是 `(bot 账号, 会话字符串)`，
//! 也就是用户在设置里打出来的那个形式。白名单是用户写的，所以用户写的形式
//! 就是这里的键。

pub mod manage;
pub mod recover;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use hmac::{Hmac, Mac};
use sha2::Sha256;
use tokio::sync::watch;

use crate::db::DbPool;

/// 语料根目录。**不放 `files/<conversation_id>/`**：删会话会把那个目录整个
/// `remove_dir_all` 掉（`commands/conversation.rs`），`/new` 会把一个群的语料
/// 切散到 N 个会话目录里，而且 `files/` 是 `resolve_attachment_uri` 与 remote
/// `/assets` 的信任根——声纹不该进那里。
pub fn corpus_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("voice_corpus")
}

/// 临时文件。只有一个 writer（见 [`CorpusLock`]），所以恢复器可以无条件清空
/// 这个目录：能拿到锁就说明里面剩下的必然是上次崩溃的残骸。
pub fn staging_dir(app_data_dir: &Path) -> PathBuf {
    corpus_dir(app_data_dir).join(".staging")
}

/// 一个会话的语料目录，名字是假名化过的——见 [`session_pseudonym`]。
pub fn session_dir(app_data_dir: &Path, pseudonym: &str) -> PathBuf {
    corpus_dir(app_data_dir).join(pseudonym)
}

/// 语料目录的独占锁。
///
/// 拿不到就**整个采集功能停用**，而不是退化成"多个 writer 小心翼翼地协调"。
/// 后者要 DB-backed 的 grant epoch、实例心跳、跨进程删除屏障，外加一个没法
/// 回答的问题：磁盘上那个 `.part` 是别人正在写的，还是上次崩溃剩的。
///
/// Meridian 是桌面应用，正常部署就是一个实例；"同时开两个"本来也不是任何人
/// 想要的状态。用 OS 的 advisory lock 而不是自己写一个 PID 文件，就为了那个
/// 自己写不出来的性质：**进程崩溃时由内核释放**，所以不会留下需要人来判断的
/// stale lock。
///
/// `std::fs::File::try_lock` 自 Rust 1.89 稳定，所以这里不需要依赖。
pub struct CorpusLock {
    _file: std::fs::File,
}

impl CorpusLock {
    /// `Ok(None)` 是"别人拿着"，不是错误——调用方据此停用采集并告诉用户。
    pub fn acquire(app_data_dir: &Path) -> Result<Option<Self>, String> {
        let dir = corpus_dir(app_data_dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join(".writer.lock"))
            .map_err(|e| e.to_string())?;
        match file.try_lock() {
            Ok(()) => Ok(Some(Self { _file: file })),
            Err(std::fs::TryLockError::WouldBlock) => Ok(None),
            Err(std::fs::TryLockError::Error(e)) => Err(e.to_string()),
        }
    }
}

/// 目录与导出里代替真实 id 的名字。
///
/// **假名化，不是匿名化**——同一次安装内稳定（同一个人的样本能聚到一起），
/// 跨安装不可关联，也回不到 QQ 号。
///
/// 三件事都是必须的：`bot_self_id` 要进去，否则两个账号同群会指向同一个目录；
/// 长度前缀分隔各段，否则 `("ab","c")` 与 `("a","bc")` 撞成同一个名字；
/// domain 让"会话的假名"和"发送者的假名"即使 id 相同也不相等——私聊的
/// `source_id` **就是对方的 QQ 号**，只哈希发送者等于没做。
fn pseudonym(storage_key: &[u8], domain: &str, parts: &[&str]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(storage_key).expect("HMAC takes a key of any length");
    mac.update(domain.as_bytes());
    mac.update(&(domain.len() as u64).to_le_bytes());
    for part in parts {
        mac.update(part.as_bytes());
        mac.update(&(part.len() as u64).to_le_bytes());
    }
    mac.finalize().into_bytes()[..8]
        .iter()
        .fold(String::new(), |mut acc, b| {
            use std::fmt::Write;
            let _ = write!(acc, "{b:02x}");
            acc
        })
}

pub fn session_pseudonym(storage_key: &[u8], bot_self_id: i64, source_type: &str, source_id: &str) -> String {
    pseudonym(
        storage_key,
        "voice-session",
        &[&bot_self_id.to_string(), source_type, source_id],
    )
}

pub fn sender_pseudonym(storage_key: &[u8], sender_id: &str) -> String {
    pseudonym(storage_key, "voice-sender", &[sender_id])
}

/// 假名化用的密钥，取出来或者建一个。
///
/// **必须在第一次采集之前存在**，因为目录名在那时就要算出来。而且**不可静默
/// 轮换**：换了 key，磁盘上已有的目录名全部对不上。轮换是一个要重写全部目录
/// 的显式操作，本次不提供。
pub const STORAGE_KEY_PREF: &str = "onebot.voice_storage_key";

pub fn storage_key(pool: &DbPool) -> Result<Vec<u8>, String> {
    let mut conn = crate::util::get_conn(pool)?;
    if let Some(existing) = crate::db::ops::preference::get_preference(&mut conn, STORAGE_KEY_PREF)
        .map_err(|e| e.to_string())?
        .filter(|v| !v.trim().is_empty())
    {
        return hex_decode(&existing);
    }
    // uuid 的随机性来自 getrandom,这里要的就是"没人能猜到"。两个 v4 拼起来
    // 是 256 位。
    let fresh = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    crate::db::ops::preference::set_preference(&mut conn, STORAGE_KEY_PREF, &fresh, crate::util::now_ms())
        .map_err(|e| e.to_string())?;
    hex_decode(&fresh)
}

fn hex_decode(raw: &str) -> Result<Vec<u8>, String> {
    (0..raw.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(raw.get(i..i + 2).ok_or("odd-length key")?, 16).map_err(|e| e.to_string()))
        .collect()
}

/// 一个 bot 账号在一个会话里的采集授权范围。
///
/// 账号是其中一维而不是附注：两个 bot 各自被拉进同一个群是两次独立的同意。
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct CaptureScope {
    pub bot_self_id: i64,
    /// `SessionKey` 的字符串形式，`group:123` / `private:456`。
    pub session: String,
}

impl CaptureScope {
    pub fn new(bot_self_id: i64, session: impl Into<String>) -> Self {
        Self {
            bot_self_id,
            session: session.into(),
        }
    }

    /// 白名单里的写法：`<bot>@<session>`。用户在设置里打的就是这个。
    pub fn parse(raw: &str) -> Option<Self> {
        let (bot, session) = raw.split_once('@')?;
        let bot_self_id = bot.trim().parse().ok()?;
        let session = session.trim();
        (!session.is_empty()).then(|| Self::new(bot_self_id, session))
    }
}

impl std::fmt::Display for CaptureScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}@{}", self.bot_self_id, self.session)
    }
}

/// drain 最多等这么久。
///
/// 一次采集的上限是下载超时加落盘，正常远快于此。给它一个上限是因为另一端是
/// 一个人：设置页按下保存之后无限转，比"撤权生效了，但有一个在途任务还在写完
/// 它那一条"更糟——而后者恰恰是 permit 语义本来就承诺的。
const DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

#[derive(Default)]
struct Grants {
    generation: u64,
    capture: HashSet<CaptureScope>,
    optouts: HashSet<String>,
    in_flight: HashMap<CaptureScope, usize>,
    /// 撤权/删除期间挡住新 permit。与"不在白名单里"分开，因为删除结束后白名单
    /// 可能仍然有效——屏障是临时的，撤权是永久的。
    barriers: HashSet<CaptureScope>,
}

/// 谁现在可以往语料里写。
///
/// 放在 `Services` 上而不是 OneBot 的 `SharedState` 里，因为 `start_onebot`
/// 会整个重建那个 state：一个跟着重建的协调器，会把正在进行的采集和刚刚做出
/// 的撤权一起忘掉。
pub struct CorpusCoordinator {
    grants: Mutex<Grants>,
    /// permit 释放的计数。drain 等它变化，而不是轮询——在循环外 clone 一个
    /// receiver 就不会丢掉通知。
    release_tx: watch::Sender<u64>,
    release_rx: watch::Receiver<u64>,
    /// `None` = 锁在别人手里，采集整个停用。
    lock: Option<CorpusLock>,
}

impl CorpusCoordinator {
    /// 拿不到锁不是错误：返回的协调器一律拒绝发 permit，调用方据此告诉用户
    /// 采集停用了。
    pub fn new(app_data_dir: &Path) -> Self {
        let lock = match CorpusLock::acquire(app_data_dir) {
            Ok(Some(lock)) => Some(lock),
            Ok(None) => {
                tracing::warn!("voice corpus directory is locked by another instance; capture is off");
                None
            }
            Err(error) => {
                tracing::warn!(%error, "could not lock the voice corpus directory; capture is off");
                None
            }
        };
        let (release_tx, release_rx) = watch::channel(0);
        Self {
            grants: Mutex::new(Grants::default()),
            release_tx,
            release_rx,
            lock: None.or(lock),
        }
    }

    /// 这个进程能不能采集。
    pub fn writable(&self) -> bool {
        self.lock.is_some()
    }

    pub fn generation(&self) -> u64 {
        self.grants.lock().map(|g| g.generation).unwrap_or(0)
    }

    /// 换掉白名单与 opt-out 名单，并让 generation 前进一格。
    ///
    /// **先 drain 再换**：见 [`Self::revoke_and_drain`]。这个入口用于设置页保存，
    /// 它可能同时新增和移除，所以移除的那些要走屏障。
    pub async fn apply(&self, capture: HashSet<CaptureScope>, optouts: HashSet<String>) {
        let removed: Vec<CaptureScope> = {
            let Ok(grants) = self.grants.lock() else { return };
            grants.capture.difference(&capture).cloned().collect()
        };
        if !removed.is_empty() {
            self.revoke_and_drain(&removed).await;
        }
        if let Ok(mut grants) = self.grants.lock() {
            grants.capture = capture;
            grants.optouts = optouts;
            grants.generation += 1;
        }
    }

    /// 现在被授权的全部范围。删除要用它——按人删跨会话，屏障得覆盖所有地方。
    pub fn granted_scopes(&self) -> Vec<CaptureScope> {
        self.grants
            .lock()
            .map(|grants| grants.capture.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// 只立屏障并等 drain，**不动白名单**。
    ///
    /// 删除历史用这个：删掉已有数据不等于撤销以后的授权，那是两件事（一个处理
    /// 已经存在的，一个拒绝将来的）。合并它们意味着一次删除会顺手把这个群永久
    /// 停录，而没人要求过那个。
    pub async fn revoke_and_drain_temporarily(&self, scopes: &[CaptureScope]) {
        self.raise_barriers(scopes);
        self.drain(scopes).await;
    }

    /// 撤掉屏障。删除结束时调用——授权本身从没被动过。
    pub fn lift_barriers(&self, scopes: &[CaptureScope]) {
        if let Ok(mut grants) = self.grants.lock() {
            for scope in scopes {
                grants.barriers.remove(scope);
            }
        }
    }

    fn raise_barriers(&self, scopes: &[CaptureScope]) {
        if let Ok(mut grants) = self.grants.lock() {
            for scope in scopes {
                grants.barriers.insert(scope.clone());
            }
        }
    }

    /// 立屏障、等在途采集结束、然后真正撤销。
    ///
    /// 已经拿到 permit 的任务**允许跑完**——那是 permit 的正常语义，也是唯一
    /// 能简单推理的。所以这个函数返回之后的保证是"不再新增"，不是"磁盘上没有
    /// 刚写的东西"。
    pub async fn revoke_and_drain(&self, scopes: &[CaptureScope]) {
        self.raise_barriers(scopes);
        self.drain(scopes).await;
        if let Ok(mut grants) = self.grants.lock() {
            for scope in scopes {
                grants.capture.remove(scope);
                grants.barriers.remove(scope);
            }
            grants.generation += 1;
        }
    }

    /// 等这些范围上的在途采集全部归还 permit。
    async fn drain(&self, scopes: &[CaptureScope]) {
        // receiver 在循环外 clone：它记着自己见过的版本，所以两次检查之间的
        // 释放不会被漏掉。
        let mut release = self.release_rx.clone();
        let drained = tokio::time::timeout(DRAIN_TIMEOUT, async {
            loop {
                let busy = {
                    let Ok(grants) = self.grants.lock() else { break };
                    scopes
                        .iter()
                        .any(|scope| grants.in_flight.get(scope).copied().unwrap_or(0) > 0)
                };
                if !busy {
                    break;
                }
                if release.changed().await.is_err() {
                    break;
                }
            }
        })
        .await;
        if drained.is_err() {
            // 屏障已经立着，所以"不再新增"仍然成立——超时只意味着有一个在途
            // 任务比预期慢。等下去的代价是设置页那个按下保存的人无限等，而他
            // 等的那件事已经保证了。
            tracing::warn!(
                scopes = scopes.len(),
                "voice capture drain timed out; the revocation stands and one capture may still be finishing"
            );
        }
    }

    /// 要采集就得先拿到这个。`None` 表示不许——锁没拿到、屏障中、不在白名单里，
    /// 或者这个人拒绝过留存。
    pub fn acquire(self: &Arc<Self>, scope: &CaptureScope, sender_id: &str) -> Option<CapturePermit> {
        self.lock.as_ref()?;
        let mut grants = self.grants.lock().ok()?;
        if grants.barriers.contains(scope) || !grants.capture.contains(scope) || grants.optouts.contains(sender_id) {
            return None;
        }
        let generation = grants.generation;
        *grants.in_flight.entry(scope.clone()).or_insert(0) += 1;
        Some(CapturePermit {
            coordinator: Arc::clone(self),
            scope: scope.clone(),
            generation,
        })
    }
}

/// 一次采集的许可。持有期间它的 scope 不会被撤销——撤销要等所有 permit 归还。
///
/// **在最终提交之前要问一次 [`Self::still_authorised`]**：一次采集可能跑几十
/// 秒，而这中间用户可能把这个会话从白名单里拿掉。permit 保证撤权会等它结束，
/// 但不保证它写下去的东西还是用户想要的。
pub struct CapturePermit {
    coordinator: Arc<CorpusCoordinator>,
    scope: CaptureScope,
    generation: u64,
}

impl CapturePermit {
    pub fn scope(&self) -> &CaptureScope {
        &self.scope
    }

    /// 授权自这个 permit 发出以来没有变过，而且这个 scope 现在仍在白名单里。
    pub fn still_authorised(&self) -> bool {
        let Ok(grants) = self.coordinator.grants.lock() else {
            return false;
        };
        grants.generation == self.generation && grants.capture.contains(&self.scope)
    }
}

impl Drop for CapturePermit {
    fn drop(&mut self) {
        let Ok(mut grants) = self.coordinator.grants.lock() else {
            return;
        };
        if let Some(count) = grants.in_flight.get_mut(&self.scope) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                grants.in_flight.remove(&self.scope);
            }
        }
        drop(grants);
        // 唤醒 drain。send_modify 保证版本号一定前进，哪怕没有接收者。
        self.coordinator.release_tx.send_modify(|n| *n += 1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coordinator() -> (tempfile::TempDir, Arc<CorpusCoordinator>) {
        let dir = tempfile::tempdir().unwrap();
        let c = Arc::new(CorpusCoordinator::new(dir.path()));
        (dir, c)
    }

    fn scope() -> CaptureScope {
        CaptureScope::new(1, "group:123")
    }

    #[tokio::test]
    async fn nothing_is_captured_without_an_allowlist_entry() {
        let (_dir, c) = coordinator();
        assert!(c.acquire(&scope(), "alice").is_none());

        c.apply(HashSet::from([scope()]), HashSet::new()).await;
        assert!(c.acquire(&scope(), "alice").is_some());
    }

    /// 另一个账号在同一个群里是另一份授权。少了这一条，把 bot A 加进白名单
    /// 会顺手让 bot B 也开始录同一个群。
    #[tokio::test]
    async fn another_account_in_the_same_group_is_not_covered() {
        let (_dir, c) = coordinator();
        c.apply(HashSet::from([scope()]), HashSet::new()).await;
        assert!(c.acquire(&CaptureScope::new(2, "group:123"), "alice").is_none());
    }

    #[tokio::test]
    async fn someone_who_opted_out_is_never_captured() {
        let (_dir, c) = coordinator();
        c.apply(HashSet::from([scope()]), HashSet::from(["bob".to_string()]))
            .await;
        assert!(c.acquire(&scope(), "alice").is_some());
        assert!(c.acquire(&scope(), "bob").is_none());
    }

    /// 撤权返回之后不再发新的 permit。已经发出去的那个允许跑完——所以这里
    /// 断言的是"不再新增"，而不是"磁盘上什么都没有"。
    #[tokio::test]
    async fn revoking_waits_for_what_is_already_running() {
        let (_dir, c) = coordinator();
        c.apply(HashSet::from([scope()]), HashSet::new()).await;
        let permit = c.acquire(&scope(), "alice").expect("granted");

        let revoker = {
            let c = Arc::clone(&c);
            tokio::spawn(async move { c.revoke_and_drain(&[scope()]).await })
        };

        // permit 还在手上，撤权应该还没结束。
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert!(!revoker.is_finished(), "撤权不该在 permit 归还前返回");

        drop(permit);
        revoker.await.unwrap();
        assert!(c.acquire(&scope(), "alice").is_none(), "撤权之后不再发 permit");
    }

    /// 一次长采集跨过了一次撤权：permit 让它跑完，但它在提交前问一次就知道
    /// 自己写下去的东西已经不是用户想要的了。
    #[tokio::test]
    async fn a_permit_can_tell_that_its_grant_moved_underneath_it() {
        let (_dir, c) = coordinator();
        c.apply(HashSet::from([scope()]), HashSet::new()).await;
        let permit = c.acquire(&scope(), "alice").expect("granted");
        assert!(permit.still_authorised());

        // 用**新增**另一个会话来推进 generation，不是移除这一个：移除会等这个
        // permit 归还，而它正握在手上——那是在等自己。这也是这个断言想说的事，
        // 授权换过一版，permit 看到的那一版就不再是现在这一版了。
        c.apply(
            HashSet::from([scope(), CaptureScope::new(1, "group:999")]),
            HashSet::new(),
        )
        .await;
        assert!(!permit.still_authorised());
    }

    #[test]
    fn a_second_holder_of_the_directory_lock_gets_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let first = CorpusCoordinator::new(dir.path());
        assert!(first.writable());

        let second = CorpusCoordinator::new(dir.path());
        assert!(!second.writable(), "同一个目录只允许一个 writer");
        assert!(
            Arc::new(second).acquire(&scope(), "alice").is_none(),
            "拿不到锁就一律不采集"
        );
    }

    /// 假名化要把账号算进去，否则两个 bot 同群会共用一个目录；
    /// 而会话和发送者即使 id 相同也必须不同——私聊的 source_id 就是对方的号。
    #[test]
    fn a_pseudonym_separates_accounts_and_domains() {
        let key = b"k";
        let a = session_pseudonym(key, 1, "onebot_private", "999");
        let b = session_pseudonym(key, 2, "onebot_private", "999");
        assert_ne!(a, b, "两个账号同一个对手方不能撞到一起");
        assert_ne!(a, sender_pseudonym(key, "999"), "会话与发送者要分开");

        // 长度前缀：拼接歧义不能变成同一个名字。
        assert_ne!(
            session_pseudonym(key, 1, "ab", "c"),
            session_pseudonym(key, 1, "a", "bc")
        );
    }
}
