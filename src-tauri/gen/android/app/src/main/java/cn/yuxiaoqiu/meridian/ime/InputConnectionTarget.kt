package cn.yuxiaoqiu.meridian.ime

import android.view.KeyEvent
import android.view.inputmethod.InputConnection

/** [TextTarget] over the field's `InputConnection`, fetched fresh each call. */
class InputConnectionTarget(private val connection: () -> InputConnection?) : TextTarget {
  override fun beginBatch() {
    connection()?.beginBatchEdit()
  }

  override fun endBatch() {
    connection()?.endBatchEdit()
  }

  override fun commit(text: String) {
    connection()?.commitText(text, 1)
  }

  override fun hasSelection(): Boolean = !connection()?.getSelectedText(0).isNullOrEmpty()

  /** Code points, so an emoji is one Backspace (minSdk 24 has the call). */
  override fun deleteBefore(): Boolean = connection()?.deleteSurroundingTextInCodePoints(1, 0) ?: false

  override fun sendKey(keyCode: Int) {
    val ic = connection() ?: return
    ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
    ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
  }

  override fun performEditorAction(action: Int) {
    connection()?.performEditorAction(action)
  }
}
