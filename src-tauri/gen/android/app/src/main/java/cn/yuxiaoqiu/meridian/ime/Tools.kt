package cn.yuxiaoqiu.meridian.ime

import android.view.KeyEvent

/** What takes the place of the keys, opened from the toolbar or the candidate bar. */
enum class Panel {
  EDIT,
  CLIPBOARD,
  SYMBOLS,
  /** Every candidate as a grid, over the keys; closes once nothing is left to choose. */
  CANDIDATES,
}

/** A key of the editing panel. */
enum class EditAction {
  LEFT, RIGHT, UP, DOWN, HOME, END,
  /** Arrows extend the selection until it is pressed again, or something is copied. */
  SELECT,
  SELECT_ALL, COPY, CUT, PASTE, UNDO, REDO, BACKSPACE,
}

/** How an editing key reaches the field. */
sealed interface EditCommand {
  /** A key event; arrows carry Shift while selecting. */
  data class Key(val keyCode: Int, val meta: Int = 0) : EditCommand

  /**
   * `InputConnection.performContextMenuAction`: what the field's own menu
   * would do, which a WebView honours as well as an EditText — a Ctrl+C key
   * event is not something every field listens for.
   */
  data class Menu(val id: Int) : EditCommand
}

private const val SHIFT = KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON
private const val CTRL = KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON

/**
 * What `action` sends, given whether a selection is being extended; null for
 * [EditAction.SELECT], which only changes the keyboard's own state. Undo and
 * redo are Ctrl+Z and Ctrl+Shift+Z: an EditText answers them as shortcuts, and
 * so does a WebView, where the context-menu ids for them mean nothing.
 */
fun commandFor(action: EditAction, selecting: Boolean): EditCommand? {
  val extend = if (selecting) SHIFT else 0
  return when (action) {
    EditAction.LEFT -> EditCommand.Key(KeyEvent.KEYCODE_DPAD_LEFT, extend)
    EditAction.RIGHT -> EditCommand.Key(KeyEvent.KEYCODE_DPAD_RIGHT, extend)
    EditAction.UP -> EditCommand.Key(KeyEvent.KEYCODE_DPAD_UP, extend)
    EditAction.DOWN -> EditCommand.Key(KeyEvent.KEYCODE_DPAD_DOWN, extend)
    EditAction.HOME -> EditCommand.Key(KeyEvent.KEYCODE_MOVE_HOME, extend)
    EditAction.END -> EditCommand.Key(KeyEvent.KEYCODE_MOVE_END, extend)
    EditAction.SELECT -> null
    EditAction.SELECT_ALL -> EditCommand.Menu(android.R.id.selectAll)
    EditAction.COPY -> EditCommand.Menu(android.R.id.copy)
    EditAction.CUT -> EditCommand.Menu(android.R.id.cut)
    EditAction.PASTE -> EditCommand.Menu(android.R.id.paste)
    EditAction.UNDO -> EditCommand.Key(KeyEvent.KEYCODE_Z, CTRL)
    EditAction.REDO -> EditCommand.Key(KeyEvent.KEYCODE_Z, CTRL or SHIFT)
    EditAction.BACKSPACE -> EditCommand.Key(KeyEvent.KEYCODE_DEL)
  }
}

/**
 * Whether selecting continues after `action`. Select All leaves a selection
 * to extend; copying or cutting it ends the job, as does deleting it.
 */
fun selectingAfter(action: EditAction, selecting: Boolean): Boolean = when (action) {
  EditAction.SELECT -> !selecting
  EditAction.SELECT_ALL -> true
  EditAction.COPY, EditAction.CUT, EditAction.PASTE, EditAction.BACKSPACE, EditAction.UNDO, EditAction.REDO -> false
  else -> selecting
}

/**
 * Whether a clip may be remembered: not one its source marked sensitive (a
 * password manager does, and Android 13 asks every app to), and not while
 * the field in front of the keyboard is private, the keyboard is incognito,
 * or recording is off.
 */
fun mayRemember(sensitive: Boolean, privateField: Boolean, incognito: Boolean, recording: Boolean): Boolean =
  !sensitive && !privateField && !incognito && recording

/**
 * When a clip found on the clipboard was copied, as wall-clock time, from
 * `ClipDescription.getTimestamp()` (`stamp`), the time since boot and now;
 * null when the stamp says nothing usable.
 *
 * The stamp's time base is not something to rely on. It was first read as
 * time since boot only, and a wall-clock stamp read that way dates a clip
 * decades ahead — shown in the list, never expiring, and never offered as
 * just copied. A stamp larger than the time since boot cannot be one, so both
 * readings are accepted; one past now is neither.
 */
fun copiedAt(stamp: Long, sinceBoot: Long, now: Long): Long? = when {
  stamp <= 0 -> null
  stamp <= sinceBoot -> now - (sinceBoot - stamp)
  stamp <= now -> stamp
  else -> null
}

/**
 * Which field an engine answer belongs to. The engine answers on its own
 * thread, later; by then focus may have moved and `currentInputConnection`
 * be another field's, and an answer applied there puts one field's commit
 * (or, after an engine error, the typed character) into another. Every
 * lifecycle change moves the generation on, and an answer asked for under an
 * older one is dropped.
 */
class InputGeneration {
  var current = 0L
    private set

  fun advance() {
    current += 1
  }

  /** `block`, run only if nothing has moved on since this call. */
  fun <T> guard(block: (T) -> Unit): (T) -> Unit {
    val asked = current
    return { value -> if (asked == current) block(value) }
  }
}

/**
 * Whether a clip read from the clipboard is one already handled. Only the
 * catch-up read asks: the listener firing is itself proof of a new copy, and
 * before Android 8 the identity is the text's hash, so the same text copied
 * again would look like the old copy.
 */
fun isRepeatedClip(live: Boolean, identity: Long, lastSeen: Long): Boolean = !live && identity == lastSeen

/**
 * The scheme a key is read in. A physical key is pinyin whatever the touch
 * layer (it cannot produce the grid's keys); a tap is the touch layer's.
 */
fun schemeForKey(physical: Boolean, lettersLayer: Layer): String =
  if (physical || lettersLayer != Layer.GRID) "pinyin" else "grid"

/** Where 中/英 takes the letters: English is QWERTY, Chinese the chosen layout. */
fun lettersAfterToggle(mode: InputMode, chineseLayout: Layer): Layer =
  if (mode == InputMode.CHINESE) Layer.QWERTY else chineseLayout

/** Two Shift taps closer than this lock the capitals. */
const val DOUBLE_TAP_MS = 350L

/** Shift's two states after a tap, `sinceLast` ms after the previous one. */
data class ShiftState(val shifted: Boolean, val capsLock: Boolean)

/**
 * A tap turns the next letter's capital on or off; a second tap soon after
 * the first locks it; any tap while locked lets go of both.
 */
fun shiftAfterTap(state: ShiftState, sinceLast: Long): ShiftState = when {
  state.capsLock -> ShiftState(shifted = false, capsLock = false)
  state.shifted && sinceLast < DOUBLE_TAP_MS -> ShiftState(shifted = false, capsLock = true)
  else -> ShiftState(shifted = !state.shifted, capsLock = false)
}

/** Words a message carrying a one-time code says it with. */
private val CODE_WORDS = listOf("验证码", "校验码", "动态码", "确认码", "认证码", "安全码", "code", "otp")
private val CODE_DIGITS = Regex("(?<![0-9])[0-9]{4,8}(?![0-9])")

/**
 * The one-time code in a clip, if it is one: the clip is the code (what an
 * SMS notification's "copy code" button puts there), or a short message
 * that says it carries one and has exactly one run of four to eight digits.
 * A code is offered on the toolbar and never kept in the history — it is
 * spent in a minute, and a list of them is a list of accounts.
 */
fun codeIn(text: String): String? {
  val t = text.trim()
  if (t.length in 4..8 && t.all { it in '0'..'9' }) return t
  if (t.length > 300 || CODE_WORDS.none { t.contains(it, ignoreCase = true) }) return null
  return CODE_DIGITS.findAll(t).map { it.value }.distinct().singleOrNull()
}

/** A clip on one line: newlines and runs of blank space read as one space. */
internal fun oneLine(text: String): String = text.trim().replace(Regex("\\s+"), " ")
