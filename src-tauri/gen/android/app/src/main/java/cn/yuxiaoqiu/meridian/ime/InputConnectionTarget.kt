package cn.yuxiaoqiu.meridian.ime

import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.UnderlineSpan
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

  override fun setComposing(text: String) {
    val styled = SpannableString(text)
    if (text.isNotEmpty()) {
      styled.setSpan(UnderlineSpan(), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE or Spanned.SPAN_COMPOSING)
      styled.setSpan(BackgroundColorSpan(COMPOSING_WASH), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    connection()?.setComposingText(styled, 1)
  }

  override fun finishComposing() {
    connection()?.finishComposingText()
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

  private companion object {
    /** A faint wash under the composing text, readable on light and dark fields. */
    val COMPOSING_WASH = Color.argb(0x28, 0x80, 0x80, 0x80)
  }
}
