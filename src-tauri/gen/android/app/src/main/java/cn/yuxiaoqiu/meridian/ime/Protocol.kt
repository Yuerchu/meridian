package cn.yuxiaoqiu.meridian.ime

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// What libmeridian_ime.so answers in: the session's own types, serialised by
// serde on the Rust side (`meridian-ime-proto`'s Frame, the session's
// KeyOutcome, the grid token table). Field names are the wire names. The
// fixtures under src-tauri/ime/android/fixtures pin both sides to the same
// bytes; EngineBridgeContractTest decodes them with these classes.

/** Unknown fields are an error: the library and this file ship together. */
internal val EngineJson = Json { ignoreUnknownKeys = false }

@Serializable
enum class PreeditKind {
  @SerialName("syllable") SYLLABLE,
  @SerialName("partial") PARTIAL,
  @SerialName("separator") SEPARATOR,
  /** Chosen but not yet committed. */
  @SerialName("fixed") FIXED,
}

@Serializable
data class PreeditSegment(val text: String, val kind: PreeditKind)

@Serializable
enum class CandidateSource {
  @SerialName("dict") DICT,
  @SerialName("user") USER,
  @SerialName("sentence") SENTENCE,
}

@Serializable
data class CandidateItem(val text: String, val source: CandidateSource)

@Serializable
enum class InputMode {
  @SerialName("chinese") CHINESE,
  @SerialName("english") ENGLISH,
}

/** Everything the candidate bar draws; the candidates are one page. */
@Serializable
data class Frame(
  val preedit: List<PreeditSegment>,
  val candidates: List<CandidateItem>,
  val page: Int,
  @SerialName("page_count") val pageCount: Int,
  val highlight: Int,
  val mode: InputMode,
  val notice: String?,
) {
  val isEmpty: Boolean get() = preedit.isEmpty() && candidates.isEmpty() && notice == null
  val preeditText: String get() = preedit.joinToString("") { it.text }
}

/** What one key did: eaten or not, text to commit, the frame to show. */
@Serializable
data class KeyOutcome(val consumed: Boolean, val commit: String?, val frame: Frame)

@Serializable
enum class GridRole {
  @SerialName("initial") INITIAL,
  @SerialName("medial") MEDIAL,
  @SerialName("final") FINAL,
  @SerialName("nasal") NASAL,
  @SerialName("tone") TONE,
}

/**
 * One key of the grid layout. `key` is the one character it sends (a
 * private-use code point for the multi-letter keys); `variants` names the
 * keys a long press offers first, ahead of the key's digit or symbol.
 */
@Serializable
data class GridToken(
  val key: String,
  val name: String,
  val label: String,
  val role: GridRole,
  val variants: List<String>,
)
