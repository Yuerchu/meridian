package cn.yuxiaoqiu.meridian.ime

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File

/** One thing copied: its text, when it was copied, and whether it is kept. */
@Serializable
data class Clip(val text: String, val at: Long, val pinned: Boolean = false)

/**
 * What the keyboard remembers of the clipboard, newest first, pinned before
 * the rest.
 *
 * On disk, not only in memory: a keyboard's process is one vendors kill
 * freely (MIUI among them), and a history that empties whenever that happens
 * is not one anybody can rely on. What is written is bounded instead — an
 * unpinned clip lasts [TTL_MS] and there are at most [MAX_RECENT] of them;
 * only pinning, which somebody chose, keeps one longer. What is never written
 * is decided by the caller: a clip marked sensitive, or one copied while the
 * field was private or the keyboard in incognito, never reaches [add].
 *
 * `file` null keeps everything in memory, which is what the tests use.
 */
class ClipboardHistory(private val file: File?, private val clock: () -> Long = System::currentTimeMillis) {
  /**
   * False once the file failed to parse. Pinned clips are the person's own,
   * so an unreadable file is left for somebody to look at and the history
   * carries on in memory — the learner's rule, never an empty list written
   * over what was there.
   */
  private var writable = true

  var clips: List<Clip> = load()
    private set

  /**
   * Remembers `text`, copied at `at`. The same text again moves to the top
   * and keeps its pin. Blank or oversized text is not remembered; false when
   * nothing changed.
   */
  fun add(text: String, at: Long = clock()): Boolean {
    if (text.isBlank() || text.length > MAX_CHARS) return false
    val existing = clips.firstOrNull { it.text == text }
    if (existing != null && existing.at >= at) return false
    val rest = clips.filter { it.text != text }
    clips = order(listOf(Clip(text, at, existing?.pinned ?: false)) + rest)
    save()
    return true
  }

  fun pin(text: String, pinned: Boolean) {
    clips = order(clips.map { if (it.text == text) it.copy(pinned = pinned) else it })
    save()
  }

  fun remove(text: String) {
    clips = clips.filter { it.text != text }
    save()
  }

  /** Forgets everything not pinned. */
  fun clearUnpinned() {
    clips = clips.filter { it.pinned }
    save()
  }

  /** Drops what has outlived [TTL_MS]; true when that was anything. */
  fun expire(): Boolean {
    val kept = order(clips)
    if (kept == clips) return false
    clips = kept
    save()
    return true
  }

  /** The newest clip if it was copied within `withinMs`, for the paste chip. */
  fun fresh(withinMs: Long): Clip? = clips.maxByOrNull { it.at }?.takeIf { clock() - it.at in 0..withinMs }

  /**
   * Pinned first, each part newest first; the unpinned part expired and
   * capped. A clip dated after now — the clock was set back, or a build that
   * misread the clipboard's time stamps wrote it — is taken as copied now;
   * left as it is it would sit on top and never expire.
   */
  private fun order(all: List<Clip>): List<Clip> {
    val now = clock()
    val dated = all.map { if (it.at > now) it.copy(at = now) else it }
    val pinned = dated.filter { it.pinned }.sortedByDescending { it.at }
    val recent = dated.filter { !it.pinned && now - it.at < TTL_MS }.sortedByDescending { it.at }.take(MAX_RECENT)
    return pinned + recent
  }

  private fun load(): List<Clip> {
    val f = file ?: return emptyList()
    if (!f.exists()) return emptyList()
    val read = runCatching { EngineJson.decodeFromString(ListSerializer(Clip.serializer()), f.readText()) }
    return read.fold({ order(it) }) {
      writable = false
      emptyList()
    }
  }

  private fun save() {
    val f = file ?: return
    if (!writable) return
    runCatching {
      f.parentFile?.mkdirs()
      val tmp = File(f.parentFile, ".${f.name}.tmp")
      tmp.writeText(EngineJson.encodeToString(ListSerializer(Clip.serializer()), clips))
      if (!tmp.renameTo(f)) {
        f.delete()
        tmp.renameTo(f)
      }
    }
  }

  companion object {
    const val TTL_MS = 60 * 60 * 1000L
    const val MAX_RECENT = 20
    /** Longer than this is a document, not a clip; the system clipboard still has it. */
    const val MAX_CHARS = 5000
  }
}
