package cn.yuxiaoqiu.meridian.ime

import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OutcomeApplierTest {
  /** Records every edit, and models the composing region well enough to read back. */
  private class FakeField : TextTarget {
    val calls = mutableListOf<String>()
    var text = ""
    var region = ""
    var selection = false
    var deleteWorks = true

    val shown: String get() = text + region

    override fun beginBatch() { calls += "begin" }
    override fun endBatch() { calls += "end" }
    override fun commit(text: String) {
      calls += "commit($text)"
      this.text += text
      region = ""
    }
    override fun setComposing(text: String) {
      calls += "compose($text)"
      region = text
    }
    override fun finishComposing() {
      calls += "finish"
      text += region
      region = ""
    }
    override fun hasSelection() = selection
    override fun deleteBefore(): Boolean {
      calls += "delete"
      if (deleteWorks) text = text.dropLast(1)
      return deleteWorks
    }
    override fun sendKey(keyCode: Int) { calls += "key($keyCode)" }
    override fun performEditorAction(action: Int) { calls += "action($action)" }
  }

  private fun frame(preedit: String = "", vararg candidates: String) = Frame(
    preedit = if (preedit.isEmpty()) emptyList() else listOf(PreeditSegment(preedit, PreeditKind.SYLLABLE)),
    candidates = candidates.map { CandidateItem(it, CandidateSource.DICT) },
    page = 0,
    pageCount = if (candidates.isEmpty()) 0 else 1,
    highlight = 0,
    mode = InputMode.CHINESE,
    notice = null,
  )

  private fun eaten(preedit: String, commit: String? = null) = KeyOutcome(true, commit, frame(preedit))
  private fun declined() = KeyOutcome(false, null, frame())

  private val n = EngineKey.char('n'.code)
  private val i = EngineKey.char('i'.code)
  private val backspace = EngineKey.function(Vk.BACK)
  private val enter = EngineKey.function(Vk.RETURN)

  @Test
  fun typingComposesAndACommitReplacesTheRegion() {
    val field = FakeField()
    val a = OutcomeApplier(field)
    a.apply(n, eaten("n"), null)
    a.apply(i, eaten("ni"), null)
    assertEquals("ni", field.region)
    assertTrue(a.composing)
    a.apply(EngineKey.char(' '.code), eaten("", commit = "你"), null)
    assertEquals("你", field.shown)
    assertFalse(a.composing)
  }

  /** The Windows text service left the last letter behind; this one may not. */
  @Test
  fun deletingTheLastLetterClearsTheRegion() {
    val field = FakeField()
    val a = OutcomeApplier(field)
    a.apply(n, eaten("n"), null)
    a.apply(backspace, eaten(""), null)
    assertEquals("", field.shown)
    assertFalse(a.composing)
    assertEquals(listOf("begin", "compose(n)", "end", "begin", "compose()", "finish", "end"), field.calls)
  }

  @Test
  fun aPartialChoiceCommitsAndKeepsComposing() {
    val field = FakeField()
    val a = OutcomeApplier(field)
    a.apply(n, eaten("nihao"), null)
    a.apply(null, eaten("hao", commit = "你"), null)
    assertEquals("你", field.text)
    assertEquals("hao", field.region)
    assertTrue(a.composing)
  }

  @Test
  fun aDeclinedCharacterIsInsertedAsTyped() {
    val field = FakeField()
    OutcomeApplier(field).apply(EngineKey.char('7'.code), declined(), null)
    assertEquals("7", field.text)
    OutcomeApplier(field).apply(EngineKey.char(0x1F600), declined(), null)
    assertEquals("7😀", field.text)
  }

  @Test
  fun aDeclinedBackspaceDeletesOrClearsTheSelection() {
    val field = FakeField().apply { text = "ab" }
    OutcomeApplier(field).apply(backspace, declined(), null)
    assertEquals("a", field.text)

    val selected = FakeField().apply { selection = true }
    OutcomeApplier(selected).apply(backspace, declined(), null)
    assertTrue("commit()" in selected.calls)
    assertFalse("delete" in selected.calls)

    val stubborn = FakeField().apply { deleteWorks = false }
    OutcomeApplier(stubborn).apply(backspace, declined(), null)
    assertTrue("key(${KeyEvent.KEYCODE_DEL})" in stubborn.calls)
  }

  @Test
  fun aDeclinedEnterRunsTheFieldsActionOrIsANewLine() {
    val search = FakeField()
    OutcomeApplier(search).apply(enter, declined(), EditorInfo.IME_ACTION_SEARCH)
    assertTrue("action(${EditorInfo.IME_ACTION_SEARCH})" in search.calls)

    val note = FakeField()
    OutcomeApplier(note).apply(enter, declined(), null)
    assertTrue("key(${KeyEvent.KEYCODE_ENTER})" in note.calls)
  }

  @Test
  fun aDeclinedArrowIsSentOnAndAnEatenOneIsNot() {
    val field = FakeField()
    OutcomeApplier(field).apply(EngineKey.function(Vk.LEFT), declined(), null)
    assertTrue("key(${KeyEvent.KEYCODE_DPAD_LEFT})" in field.calls)

    val composing = FakeField()
    OutcomeApplier(composing).apply(EngineKey.function(Vk.LEFT), eaten("ni"), null)
    assertFalse(composing.calls.any { it.startsWith("key(") })
  }

  @Test
  fun aResetFrameClearsARegionAndForgettingDoesNot() {
    val field = FakeField()
    val a = OutcomeApplier(field)
    a.apply(n, eaten("n"), null)
    a.apply(frame())
    assertEquals("", field.shown)

    val gone = FakeField()
    val b = OutcomeApplier(gone)
    b.apply(n, eaten("n"), null)
    b.forget()
    b.apply(frame())
    assertFalse("finish" in gone.calls)
  }
}
