//! 把一条语音留下来。
//!
//! 这条通道**在群门禁之前**，和贴纸采集并列。挂在 `process_media` 上只能抓到
//! @ 过 bot 的那些——群里绝大多数语音不会 @ bot，采到的会是一个被严重扭曲的
//! 子集，而那正是要拿去训练的数据。
//!
//! 它也不碰产品侧的任何东西：不 `get_or_create` 会话（不为录音在侧边栏凭空
//! 长出一个对话），不复用 `process_media`（那要 conversation_id、图片预算、
//! vision 判断，采集一个都不需要）。代价是 @ 过 bot 的语音会被转写两次，多一次
//! API 调用换一条干净的边界。

use std::sync::Arc;
use std::sync::OnceLock;

use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use super::format::MediaRef;
use super::protocol::OneBotAction;
use super::{DirectedCallOutcome, SharedState};
use crate::db::models::voice_corpus::VoiceBlob;
use crate::db::ops::voice_corpus as ops;
use crate::voice_corpus::{self, CapturePermit, CaptureScope};

/// 单条语音的上限。一分钟的 SILK 是几十 KB，10 MiB 给的是"这显然不是语音"
/// 的边界，不是正常结果的余量。
const MAX_RECORD_BYTES: u64 = 10 * 1024 * 1024;
/// 并发采集数。比贴纸的 8 小：语音条数远少而单条更大，再高只是在抢同一根
/// websocket。
const CAPTURE_SLOTS: usize = 4;
/// lease 长度。下载超过它就要续租，见 `ops::renew_lease`。
const LEASE_MS: i64 = 60_000;
const FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const TRANSCRIBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// 一条语音的来源，与产品侧的任何上下文无关。
#[derive(Debug, Clone)]
pub struct RecordSource {
    pub scope: CaptureScope,
    pub source_type: &'static str,
    pub source_id: String,
    /// 消息的发送者。**已经排除过所有本地 bot 账号**——只查当前连接的 self_id
    /// 不够：bot A 发的 TTS 会被同群的 bot B 当成真人语音采集。
    pub sender_id: i64,
    pub message_id: Option<i64>,
    /// 回应要走回它来的那条连接。广播会让另一个适配器抢答一个它没听说过的
    /// message_id。
    pub conn_id: u64,
}

/// 排在后台，不挡住本轮。
pub fn capture_in_background(state: Arc<SharedState>, source: RecordSource, records: Vec<MediaRef>) {
    if records.is_empty() {
        return;
    }
    let Some(permit) = state
        .services
        .corpus
        .acquire(&source.scope, &source.sender_id.to_string())
    else {
        return;
    };
    static SLOTS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let slots = SLOTS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(CAPTURE_SLOTS)))
        .clone();
    tokio::spawn(async move {
        let Ok(_slot) = slots.acquire_owned().await else { return };
        // permit 一路带进来：撤权要等它归还，而它归还之前这个 scope 不会被撤。
        capture_all(&state, &source, &records, &permit).await;
    });
}

async fn capture_all(state: &Arc<SharedState>, source: &RecordSource, records: &[MediaRef], permit: &CapturePermit) {
    // 转写按**消息**作答，所以只有单段时它能被归给某一段。多段时一律留空:
    // 把一次结果复制到每一段，产出的是自信的错误标签。
    let transcript = match records.len() {
        1 => transcribe(state, source).await,
        _ => {
            tracing::debug!(
                segments = records.len(),
                "voice: several record segments in one message; transcripts left empty"
            );
            None
        }
    };
    for (index, record) in records.iter().enumerate() {
        if let Err(error) = capture_one(state, source, record, index as i32, transcript.as_deref(), permit).await {
            tracing::warn!(%error, session = %source.scope, "voice capture failed");
        }
    }
}

async fn transcribe(state: &Arc<SharedState>, source: &RecordSource) -> Option<String> {
    let message_id = source.message_id?;
    let action = OneBotAction::voice_msg_to_text(message_id, String::new());
    match super::call_api_to_conn(state, source.conn_id, action, TRANSCRIBE_TIMEOUT).await {
        DirectedCallOutcome::AdapterAccepted(data) => data
            .get("text")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from),
        _ => None,
    }
}

/// 落盘的字节，以及它们的身份。
struct Staged {
    path: std::path::PathBuf,
    sha256: String,
    size: i64,
    format: &'static str,
}

impl Staged {
    /// 只删自己写的那个临时文件。**绝不碰最终文件**——那可能正被另一个任务
    /// 或既有行引用着。
    fn discard(self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

async fn capture_one(
    state: &Arc<SharedState>,
    source: &RecordSource,
    record: &MediaRef,
    segment_index: i32,
    transcript: Option<&str>,
    permit: &CapturePermit,
) -> Result<(), String> {
    let data_dir = state.services.paths.data_dir.clone();
    let staged = fetch_to_staging(record, &data_dir).await?;

    // 一次采集可能跑几十秒，而这中间用户可能把这个会话从白名单里拿掉。permit
    // 保证撤权会等我们结束，但不保证写下去的东西还是用户想要的。
    if !permit.still_authorised() {
        staged.discard();
        tracing::info!(session = %source.scope, "voice capture dropped: the grant moved while it was running");
        return Ok(());
    }

    let key_bytes = voice_corpus::storage_key(&state.services.db)?;
    let pseudonym = voice_corpus::session_pseudonym(
        &key_bytes,
        source.scope.bot_self_id,
        source.source_type,
        &source.source_id,
    );
    let dir = voice_corpus::session_dir(&data_dir, &pseudonym);
    let file_name = format!("{}.{}", staged.sha256, staged.format);
    let final_path = dir.join(&file_name);

    let pool = state.services.db.clone();
    let source = source.clone();
    let transcript = transcript.map(str::to_string);
    let staged_path = staged.path.clone();
    let sha = staged.sha256.clone();
    let format = staged.format;
    let size = staged.size;

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut conn = crate::util::get_conn(&pool)?;
        let now = crate::util::now_ms();
        let key = ops::BlobKey {
            bot_self_id: source.scope.bot_self_id,
            source_type: source.source_type,
            source_id: &source.source_id,
            sha256: &sha,
            file_format: format,
        };

        let blob = match settle_blob(&mut conn, &key, &file_name, size, &staged_path, &final_path, now)? {
            Some(blob) => blob,
            // 已经有人在写同一段音频，或者它正在被删除。两种情况下这次都不写。
            None => {
                let _ = std::fs::remove_file(&staged_path);
                return Ok(());
            }
        };

        ops::record_clip(
            &mut conn,
            &blob,
            &uuid::Uuid::new_v4().to_string(),
            &source.sender_id.to_string(),
            source.message_id,
            segment_index,
            transcript.as_deref(),
            transcript.as_deref().map(|_| "llonebot.voice_msg_to_text"),
            now,
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 抢所有权、发布文件，返回可以挂 clip 的那一行。
///
/// `None` 表示这次不写：有人正在写同一段音频，或者它是墓碑（用户刚要求删掉，
/// 此时再存一份是违背意图），或者它已经被标坏了。
#[allow(clippy::too_many_arguments)]
fn settle_blob(
    conn: &mut diesel::SqliteConnection,
    key: &ops::BlobKey<'_>,
    file_name: &str,
    size: i64,
    staged_path: &std::path::Path,
    final_path: &std::path::Path,
    now: i64,
) -> Result<Option<VoiceBlob>, String> {
    // 有界：每一轮都要么拿到所有权、要么认输，不会无限转。走到下一轮的唯一
    // 路径是接管失败（别人抢先了），而那种情况下重读一次就会看到新状态。
    for _ in 0..4 {
        let id = uuid::Uuid::new_v4().to_string();
        let token = uuid::Uuid::new_v4().to_string();
        match ops::claim_blob(conn, key, &id, &token, file_name, size, now, LEASE_MS).map_err(|e| e.to_string())? {
            ops::ClaimOutcome::Owned { id, token, epoch } => {
                publish_file(staged_path, final_path)?;
                // fencing:返回 false 就是所有权在下载期间被接管了。这个任务
                // 既不发布也不写 clip——文件已经在位,让接管者去 publish。
                if !ops::publish_blob(conn, &id, &token, epoch, now).map_err(|e| e.to_string())? {
                    return Ok(None);
                }
                return read_blob(conn, key);
            }
            ops::ClaimOutcome::Ready(blob) => {
                // 已经有一份。校验磁盘上那个确实对得上——大小不符就是它坏了,
                // 标出来而不是把新 clip 挂到一个坏文件上。
                let matches = std::fs::metadata(final_path).map(|m| m.len() as i64 == blob.file_size);
                if matches.unwrap_or(false) {
                    return Ok(Some(blob));
                }
                ops::mark_damaged(conn, &blob.id, now).map_err(|e| e.to_string())?;
                return Ok(None);
            }
            ops::ClaimOutcome::Takeable(blob) => {
                let token = uuid::Uuid::new_v4().to_string();
                let taken = ops::takeover_blob(
                    conn,
                    &blob.id,
                    blob.owner_token.as_deref(),
                    blob.fence_epoch,
                    &token,
                    now,
                    LEASE_MS,
                )
                .map_err(|e| e.to_string())?;
                let Some(epoch) = taken else { continue };
                publish_file(staged_path, final_path)?;
                if !ops::publish_blob(conn, &blob.id, &token, epoch, now).map_err(|e| e.to_string())? {
                    return Ok(None);
                }
                return read_blob(conn, key);
            }
            ops::ClaimOutcome::PendingElsewhere(_) => return Ok(None),
            ops::ClaimOutcome::Damaged(_) => return Ok(None),
            ops::ClaimOutcome::Deleting(_) => {
                tracing::debug!("voice capture skipped: these bytes are being deleted");
                return Ok(None);
            }
        }
    }
    Ok(None)
}

fn read_blob(conn: &mut diesel::SqliteConnection, key: &ops::BlobKey<'_>) -> Result<Option<VoiceBlob>, String> {
    use crate::db::schema::voice_blobs;
    use diesel::prelude::*;
    voice_blobs::table
        .filter(voice_blobs::bot_self_id.eq(key.bot_self_id))
        .filter(voice_blobs::source_type.eq(key.source_type))
        .filter(voice_blobs::source_id.eq(key.source_id))
        .filter(voice_blobs::file_format.eq(key.file_format))
        .filter(voice_blobs::sha256.eq(key.sha256))
        .select(VoiceBlob::as_select())
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())
}

/// 把临时文件挪到最终位置。
///
/// **Windows 上 `rename` 在目标已存在时会失败**（Unix 是覆盖），所以先看目标
/// 在不在：在就直接用它（内容寻址保证字节相同，这里的 TOCTOU 无害）。
/// 剩下的失败——权限、磁盘满、父目录缺失——要报出来，不能伪装成"别人赢了"。
fn publish_file(staged: &std::path::Path, final_path: &std::path::Path) -> Result<(), String> {
    if final_path.exists() {
        let _ = std::fs::remove_file(staged);
        return Ok(());
    }
    match std::fs::rename(staged, final_path) {
        Ok(()) => Ok(()),
        Err(_) if final_path.exists() => {
            let _ = std::fs::remove_file(staged);
            Ok(())
        }
        Err(e) => Err(format!("could not publish the audio: {e}")),
    }
}

/// 两档获取，边下边算 sha。
///
/// **`get_record` 不在其中**：它的 `out_format` 是必填的（必然转码，与"原样
/// 落盘"矛盾），返回的是**运行适配器那台机器**上的路径（反向 WS 在另一台机器
/// 时读不到），而"是否同机"没有可靠依据——`onebot.host` 是监听地址不是 peer。
/// 做对它要引入"授权根目录"让 WS 对端指定 Meridian 去读本机文件，那是一个新的
/// 攻击面，换一档必然转码的数据。
async fn fetch_to_staging(record: &MediaRef, data_dir: &std::path::Path) -> Result<Staged, String> {
    let staging = voice_corpus::staging_dir(data_dir);
    tokio::fs::create_dir_all(&staging).await.map_err(|e| e.to_string())?;
    let path = staging.join(format!("{}.part", uuid::Uuid::new_v4()));

    let url = record
        .url
        .as_deref()
        .filter(|u| u.starts_with("http"))
        .or_else(|| record.file.as_deref().filter(|f| f.starts_with("http")));
    let inline = record
        .file
        .as_deref()
        .and_then(|f| f.strip_prefix("base64://"))
        .filter(|s| !s.is_empty());

    let bytes_written = if let Some(url) = url {
        match stream_to_file(url, &path).await {
            Ok(written) => written,
            // 第 1 档失败回退第 2 档，两档都不成立才放弃。
            Err(error) => match inline {
                Some(payload) => {
                    tracing::debug!(%error, "voice: url fetch failed, falling back to the inline payload");
                    write_base64(payload, &path).await?
                }
                None => {
                    let _ = tokio::fs::remove_file(&path).await;
                    return Err(error);
                }
            },
        }
    } else if let Some(payload) = inline {
        write_base64(payload, &path).await?
    } else {
        let _ = tokio::fs::remove_file(&path).await;
        // 计数而不是静默：如果某个适配器全落在这里，这个功能对它就是不可用的，
        // 那要早点知道，而不是等着看空空如也的语料目录。
        tracing::warn!("voice capture skipped: the segment carries neither a url nor an inline payload");
        return Err("no fetchable audio in the record segment".into());
    };

    let (sha256, format) = tokio::task::spawn_blocking({
        let path = path.clone();
        move || -> Result<(String, &'static str), String> {
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            let digest = Sha256::digest(&bytes);
            let sha = digest.iter().fold(String::new(), |mut acc, b| {
                use std::fmt::Write;
                let _ = write!(acc, "{b:02x}");
                acc
            });
            Ok((sha, magic_format(&bytes)))
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(Staged {
        path,
        sha256,
        size: bytes_written as i64,
        format,
    })
}

async fn stream_to_file(url: &str, path: &std::path::Path) -> Result<u64, String> {
    let response = super::media::http_client()?
        .get(url)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let mut response = response;
    let mut file = tokio::fs::File::create(path).await.map_err(|e| e.to_string())?;
    let mut written: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        written += chunk.len() as u64;
        if written > MAX_RECORD_BYTES {
            let _ = tokio::fs::remove_file(path).await;
            return Err("the audio is too large".into());
        }
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(written)
}

async fn write_base64(payload: &str, path: &std::path::Path) -> Result<u64, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err("the audio is too large".into());
    }
    tokio::fs::write(path, &bytes).await.map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

/// 格式**由字节判定**，不信 URL、文件名或 Content-Type——三者都由对端控制，
/// 而这个值决定文件落进哪个去重桶。认不出来就叫 `bin`：存下来总比丢掉好，
/// 而一个诚实的"不知道"比一个猜错的扩展名有用。
fn magic_format(bytes: &[u8]) -> &'static str {
    const SILK: &[u8] = b"#!SILK";
    if bytes.starts_with(SILK) || (bytes.len() > 1 && bytes[1..].starts_with(SILK)) {
        return "silk";
    }
    if bytes.starts_with(b"#!AMR") {
        return "amr";
    }
    if bytes.starts_with(b"OggS") {
        return "ogg";
    }
    if bytes.starts_with(b"RIFF") && bytes.len() >= 12 && &bytes[8..12] == b"WAVE" {
        return "wav";
    }
    if bytes.starts_with(b"ID3") || (bytes.len() >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0) {
        return "mp3";
    }
    "bin"
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 格式认的是字节。QQ 的 SILK 常带一个前导字节，所以第二个位置也要看。
    #[test]
    fn the_format_comes_from_the_bytes() {
        assert_eq!(magic_format(b"#!SILK_V3xxxx"), "silk");
        assert_eq!(magic_format(b"\x02#!SILK_V3xxx"), "silk");
        assert_eq!(magic_format(b"#!AMR\n\x00\x00"), "amr");
        assert_eq!(magic_format(b"OggS\x00\x02\x00\x00"), "ogg");
        assert_eq!(magic_format(b"RIFF\x24\x08\x00\x00WAVEfmt "), "wav");
        assert_eq!(magic_format(b"ID3\x03\x00\x00\x00"), "mp3");
        assert_eq!(magic_format(b"\xff\xfb\x90\x00"), "mp3");
    }

    /// 认不出来不等于丢掉。
    #[test]
    fn an_unknown_container_is_still_kept() {
        assert_eq!(magic_format(b"whatever this is"), "bin");
        assert_eq!(magic_format(b""), "bin");
    }

    /// 一个骗人的扩展名改变不了它落进哪个桶。
    #[test]
    fn a_lying_file_name_does_not_decide_the_format() {
        assert_eq!(magic_format(b"#!AMR\n\x00\x00"), "amr", "叫 .mp3 也还是 amr");
    }
}
