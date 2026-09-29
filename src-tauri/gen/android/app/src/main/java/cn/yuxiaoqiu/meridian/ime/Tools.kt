package cn.yuxiaoqiu.meridian.ime

import android.view.KeyEvent

/** What takes the place of the keys when the toolbar opens something. */
enum class Panel { EDIT, CLIPBOARD }

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

/** A clip on one line: newlines and runs of blank space read as one space. */
internal fun oneLine(text: String): String = text.trim().replace(Regex("\\s+"), " ")
