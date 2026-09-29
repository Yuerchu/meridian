package cn.yuxiaoqiu.meridian.ime

import android.text.InputType
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo

/**
 * The edits a keyboard makes to a text field. `InputConnectionTarget` is the
 * real one; tests record the calls. Kept this small so the rules in
 * [OutcomeApplier] can be checked without a device.
 */
interface TextTarget {
  fun beginBatch()
  fun endBatch()
  /** Inserts `text` at the cursor, over any selection. */
  fun commit(text: String)
  fun hasSelection(): Boolean
  /** Deletes one code point before the cursor; false if the field refused. */
  fun deleteBefore(): Boolean
  /** Sends an Android key code as a down and an up. */
  fun sendKey(keyCode: Int)
  fun performEditorAction(action: Int)
}

/**
 * Applies what the engine answered to the field, which is given commits and
 * nothing else. What is being typed is drawn in the keyboard's candidate bar,
 * never in the field as a composing region: the field's own editor records
 * every change to such a region, so its undo turned 我不知道 back into
 * `wo bu zhi dao` (found on the device), a search box searched for the
 * letters as they were typed, and a chat app could save them as a draft.
 * `composing` is the keyboard's own record that a preedit exists, which is
 * what decides whether a hardware key belongs to it.
 */
class OutcomeApplier(private val target: TextTarget) {
  var composing: Boolean = false
    private set

  /**
   * `key` is what was sent, or null for a tap on a candidate. `enterAction`
   * is what Enter does in this field when the engine declines it
   * ([enterActionFor]).
   */
  fun apply(key: EngineKey?, outcome: KeyOutcome, enterAction: Int?) {
    target.beginBatch()
    try {
      showFrame(outcome.commit, outcome.frame)
      if (!outcome.consumed && key != null) passThrough(key, enterAction)
    } finally {
      target.endBatch()
    }
  }

  /** A frame with nothing to commit: a reset, a new field. The field is not touched. */
  fun apply(frame: Frame) {
    composing = frame.preeditText.isNotEmpty()
  }

  /** The field went away or moved on. */
  fun forget() {
    composing = false
  }

  private fun showFrame(commit: String?, frame: Frame) {
    commit?.let { target.commit(it) }
    composing = frame.preeditText.isNotEmpty()
  }

  /** What the application would have got had there been no keyboard. */
  private fun passThrough(key: EngineKey, enterAction: Int?) {
    when {
      key.vk == Vk.BACK -> when {
        target.hasSelection() -> target.commit("")
        !target.deleteBefore() -> target.sendKey(KeyEvent.KEYCODE_DEL)
      }
      key.vk == Vk.RETURN ->
        if (enterAction != null) target.performEditorAction(enterAction) else target.sendKey(KeyEvent.KEYCODE_ENTER)
      key.isPrintable -> target.commit(String(Character.toChars(key.ch)))
      else -> KEYCODE_FOR_VK[key.vk]?.let(target::sendKey)
    }
  }
}

/**
 * The editor action Enter performs in a field, or null when Enter is a new
 * line. A field that says `IME_FLAG_NO_ENTER_ACTION` (a chat box that sends
 * with its own button) always gets the new line.
 */
fun enterActionFor(imeOptions: Int): Int? {
  if (imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION != 0) return null
  return when (val action = imeOptions and EditorInfo.IME_MASK_ACTION) {
    EditorInfo.IME_ACTION_GO,
    EditorInfo.IME_ACTION_SEARCH,
    EditorInfo.IME_ACTION_SEND,
    EditorInfo.IME_ACTION_NEXT,
    EditorInfo.IME_ACTION_DONE,
    EditorInfo.IME_ACTION_PREVIOUS -> action
    else -> null
  }
}

/**
 * A field the engine must not learn from or read around: any password
 * variation, or one that asked for no personalised learning (incognito tabs,
 * most banking apps).
 */
fun isPrivateField(inputType: Int, imeOptions: Int): Boolean {
  if (imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0) return true
  val variation = inputType and InputType.TYPE_MASK_VARIATION
  return when (inputType and InputType.TYPE_MASK_CLASS) {
    InputType.TYPE_CLASS_TEXT -> variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
    InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
    else -> false
  }
}
