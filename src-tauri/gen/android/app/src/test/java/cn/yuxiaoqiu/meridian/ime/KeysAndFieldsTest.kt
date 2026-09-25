package cn.yuxiaoqiu.meridian.ime

import android.text.InputType
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeysAndFieldsTest {
  @Test
  fun hardwareKeysMapToTheSessionsVocabulary() {
    assertEquals(EngineKey(0x41, 'a'.code, 0), hardwareKey(KeyEvent.KEYCODE_A, 'a'.code, 0))
    assertEquals(
      EngineKey(0x41, 'A'.code, Vk.MOD_SHIFT),
      hardwareKey(KeyEvent.KEYCODE_A, 'A'.code, KeyEvent.META_SHIFT_ON),
    )
    assertEquals(EngineKey.function(Vk.BACK), hardwareKey(KeyEvent.KEYCODE_DEL, 0, 0))
    assertEquals(EngineKey.function(Vk.RETURN), hardwareKey(KeyEvent.KEYCODE_NUMPAD_ENTER, 0, 0))
    assertEquals(EngineKey.char(' '.code), hardwareKey(KeyEvent.KEYCODE_SPACE, ' '.code, 0))
    assertEquals(EngineKey(0, ','.code, 0), hardwareKey(KeyEvent.KEYCODE_COMMA, ','.code, 0))
    assertEquals(
      EngineKey(0x43, 'c'.code, Vk.MOD_CTRL),
      hardwareKey(KeyEvent.KEYCODE_C, 'c'.code, KeyEvent.META_CTRL_ON),
    )
    assertNull(hardwareKey(KeyEvent.KEYCODE_VOLUME_UP, 0, 0))
    assertNull("a dead key is not text", hardwareKey(KeyEvent.KEYCODE_GRAVE, KeyCharacterMap.COMBINING_ACCENT or 0x300, 0))
  }

  @Test
  fun functionKeysGoBackAsTheirOwnKeyCodes() {
    assertEquals(KeyEvent.KEYCODE_ENTER, KEYCODE_FOR_VK[Vk.RETURN])
    assertEquals(KeyEvent.KEYCODE_DEL, KEYCODE_FOR_VK[Vk.BACK])
    assertEquals(KeyEvent.KEYCODE_DPAD_DOWN, KEYCODE_FOR_VK[Vk.DOWN])
  }

  @Test
  fun whatTheKeyboardEatsBeforeTheEngineAnswers() {
    val a = EngineKey.char('a'.code)
    val back = EngineKey.function(Vk.BACK)
    val copy = EngineKey.char('c'.code, Vk.MOD_CTRL)
    assertTrue(shouldEat(a, composing = false))
    assertFalse("Backspace outside a composition is the app's", shouldEat(back, composing = false))
    assertTrue("inside one it is the composition's", shouldEat(back, composing = true))
    assertFalse("a shortcut never", shouldEat(copy, composing = true))
  }

  @Test
  fun enterActions() {
    assertEquals(EditorInfo.IME_ACTION_SEARCH, enterActionFor(EditorInfo.IME_ACTION_SEARCH))
    assertEquals(EditorInfo.IME_ACTION_SEND, enterActionFor(EditorInfo.IME_ACTION_SEND or EditorInfo.IME_FLAG_NO_EXTRACT_UI))
    assertNull(enterActionFor(EditorInfo.IME_ACTION_SEND or EditorInfo.IME_FLAG_NO_ENTER_ACTION))
    assertNull(enterActionFor(EditorInfo.IME_ACTION_UNSPECIFIED))
    assertNull(enterActionFor(EditorInfo.IME_ACTION_NONE))
  }

  @Test
  fun privateFields() {
    val text = InputType.TYPE_CLASS_TEXT
    assertTrue(isPrivateField(text or InputType.TYPE_TEXT_VARIATION_PASSWORD, 0))
    assertTrue(isPrivateField(text or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD, 0))
    assertTrue(isPrivateField(text or InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD, 0))
    assertTrue(isPrivateField(InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD, 0))
    assertTrue(isPrivateField(text, EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING))
    assertFalse(isPrivateField(text or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 0))
    assertFalse(isPrivateField(text or InputType.TYPE_TEXT_FLAG_MULTI_LINE, 0))
    assertFalse(
      "a number field's password variation is 0x10, which in text is the URI variation",
      isPrivateField(text or InputType.TYPE_TEXT_VARIATION_URI, 0),
    )
  }
}
