package cn.yuxiaoqiu.meridian.ime

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ToolsTest {
  @Test
  fun arrowsMoveTheCursorAndExtendTheSelectionWhileSelecting() {
    assertEquals(EditCommand.Key(KeyEvent.KEYCODE_DPAD_LEFT, 0), commandFor(EditAction.LEFT, selecting = false))
    val extended = commandFor(EditAction.END, selecting = true) as EditCommand.Key
    assertEquals(KeyEvent.KEYCODE_MOVE_END, extended.keyCode)
    assertTrue("Shift is held", extended.meta and KeyEvent.META_SHIFT_ON != 0)
  }

  @Test
  fun clipboardWorkGoesThroughTheFieldsOwnMenu() {
    assertEquals(EditCommand.Menu(android.R.id.copy), commandFor(EditAction.COPY, selecting = true))
    assertEquals(EditCommand.Menu(android.R.id.paste), commandFor(EditAction.PASTE, selecting = false))
    assertEquals(EditCommand.Menu(android.R.id.selectAll), commandFor(EditAction.SELECT_ALL, selecting = false))
  }

  @Test
  fun undoAndRedoAreShortcutsAndSelectOnlyChangesTheKeyboard() {
    val redo = commandFor(EditAction.REDO, selecting = false) as EditCommand.Key
    assertEquals(KeyEvent.KEYCODE_Z, redo.keyCode)
    assertTrue(redo.meta and KeyEvent.META_CTRL_ON != 0 && redo.meta and KeyEvent.META_SHIFT_ON != 0)
    val undo = commandFor(EditAction.UNDO, selecting = true) as EditCommand.Key
    assertEquals("undo carries no Shift even while selecting", 0, undo.meta and KeyEvent.META_SHIFT_ON)
    assertNull(commandFor(EditAction.SELECT, selecting = false))
  }

  @Test
  fun copyingEndsASelectionAndSelectAllStartsOne() {
    assertTrue(selectingAfter(EditAction.SELECT, selecting = false))
    assertFalse(selectingAfter(EditAction.SELECT, selecting = true))
    assertTrue(selectingAfter(EditAction.SELECT_ALL, selecting = false))
    assertFalse(selectingAfter(EditAction.COPY, selecting = true))
    assertTrue("moving keeps selecting", selectingAfter(EditAction.LEFT, selecting = true))
  }

  @Test
  fun aClipIsRememberedOnlyWhenNothingForbidsIt() {
    assertTrue(mayRemember(sensitive = false, privateField = false, incognito = false, recording = true))
    assertFalse(mayRemember(sensitive = true, privateField = false, incognito = false, recording = true))
    assertFalse(mayRemember(sensitive = false, privateField = true, incognito = false, recording = true))
    assertFalse(mayRemember(sensitive = false, privateField = false, incognito = true, recording = true))
    assertFalse(mayRemember(sensitive = false, privateField = false, incognito = false, recording = false))
  }

  /** Both time bases a clipboard stamp is found in, and what is neither. */
  @Test
  fun aCopyIsDatedWhicheverClockItsStampWasReadFrom() {
    val now = 1_790_000_000_000L
    val sinceBoot = 3_600_000L
    assertEquals("a stamp counting from boot", now - 60_000, copiedAt(sinceBoot - 60_000, sinceBoot, now))
    assertEquals("a wall-clock stamp", now - 60_000, copiedAt(now - 60_000, sinceBoot, now))
    assertNull("from the future", copiedAt(now + 1, sinceBoot, now))
    assertNull("no stamp at all", copiedAt(0, sinceBoot, now))
  }

  @Test
  fun aOneTimeCodeIsFoundInWhatAMessageOrItsCopyButtonLeaves() {
    assertEquals("482913", codeIn(" 482913\n"))
    assertEquals("4829", codeIn("4829"))
    assertEquals("582041", codeIn("【某银行】您的验证码为582041，5分钟内有效，请勿泄露。"))
    assertEquals("773310", codeIn("Your verification code is 773310."))
  }

  @Test
  fun digitsAloneOrTwoCandidatesAreNotACode() {
    assertNull("a phone number", codeIn("13800138000"))
    assertNull("three digits", codeIn("123"))
    assertNull("no word saying so", codeIn("订单 58213 已发货"))
    assertNull("two numbers, which one?", codeIn("验证码 1234，订单号 99887766"))
    assertNull("prose that happens to hold one", codeIn("明天 2026 年会议"))
  }

  @Test
  fun aClipOnTheToolbarIsOneLine() {
    assertEquals("a b c", oneLine("  a\n\tb   c \n"))
  }
}
