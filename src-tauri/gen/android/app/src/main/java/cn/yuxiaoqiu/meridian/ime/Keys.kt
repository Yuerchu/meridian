package cn.yuxiaoqiu.meridian.ime

import android.view.KeyCharacterMap
import android.view.KeyEvent

/**
 * The session's key vocabulary: Windows virtual-key codes for function keys
 * and a character for everything printable, as `meridian-ime-session`'s
 * `keys.rs` defines them, plus the modifier bits `bridge.rs` decodes.
 * VkContractTest reads both Rust files and fails if a number here drifts.
 */
object Vk {
  const val BACK = 0x08
  const val TAB = 0x09
  const val RETURN = 0x0D
  const val SHIFT = 0x10
  const val ESCAPE = 0x1B
  const val SPACE = 0x20
  const val PRIOR = 0x21
  const val NEXT = 0x22
  const val END = 0x23
  const val HOME = 0x24
  const val LEFT = 0x25
  const val UP = 0x26
  const val RIGHT = 0x27
  const val DOWN = 0x28
  const val DELETE = 0x2E

  const val MOD_SHIFT = 1
  const val MOD_CTRL = 2
  const val MOD_ALT = 4
  const val MOD_META = 8

  /** The virtual key a printable character is typed with, as `keys::printable`. */
  fun forChar(ch: Int): Int = when (ch) {
    in 'a'.code..'z'.code -> ch - 'a'.code + 0x41
    in 'A'.code..'Z'.code -> ch - 'A'.code + 0x41
    in '0'.code..'9'.code -> ch - '0'.code + 0x30
    ' '.code -> SPACE
    else -> 0
  }
}

/** One key for the engine: a virtual key, a code point or -1, modifier bits. */
data class EngineKey(val vk: Int, val ch: Int, val mods: Int) {
  val isPrintable: Boolean get() = ch >= 0
  val isShortcut: Boolean get() = mods and (Vk.MOD_CTRL or Vk.MOD_ALT or Vk.MOD_META) != 0

  companion object {
    fun char(ch: Int, mods: Int = 0) = EngineKey(Vk.forChar(ch), ch, mods)
    fun function(vk: Int, mods: Int = 0) = EngineKey(vk, -1, mods)
  }
}

private val FUNCTION_KEYS = mapOf(
  KeyEvent.KEYCODE_DEL to Vk.BACK,
  KeyEvent.KEYCODE_FORWARD_DEL to Vk.DELETE,
  KeyEvent.KEYCODE_TAB to Vk.TAB,
  KeyEvent.KEYCODE_ENTER to Vk.RETURN,
  KeyEvent.KEYCODE_NUMPAD_ENTER to Vk.RETURN,
  KeyEvent.KEYCODE_ESCAPE to Vk.ESCAPE,
  KeyEvent.KEYCODE_PAGE_UP to Vk.PRIOR,
  KeyEvent.KEYCODE_PAGE_DOWN to Vk.NEXT,
  KeyEvent.KEYCODE_MOVE_HOME to Vk.HOME,
  KeyEvent.KEYCODE_MOVE_END to Vk.END,
  KeyEvent.KEYCODE_DPAD_LEFT to Vk.LEFT,
  KeyEvent.KEYCODE_DPAD_UP to Vk.UP,
  KeyEvent.KEYCODE_DPAD_RIGHT to Vk.RIGHT,
  KeyEvent.KEYCODE_DPAD_DOWN to Vk.DOWN,
)

/** The Android key code a function key is sent back to the application as. */
val KEYCODE_FOR_VK: Map<Int, Int> = FUNCTION_KEYS.entries
  .filter { it.key != KeyEvent.KEYCODE_NUMPAD_ENTER }
  .associate { (code, vk) -> vk to code }

fun modsOf(metaState: Int): Int {
  var mods = 0
  if (metaState and KeyEvent.META_SHIFT_ON != 0) mods = mods or Vk.MOD_SHIFT
  if (metaState and KeyEvent.META_CTRL_ON != 0) mods = mods or Vk.MOD_CTRL
  if (metaState and KeyEvent.META_ALT_ON != 0) mods = mods or Vk.MOD_ALT
  if (metaState and KeyEvent.META_META_ON != 0) mods = mods or Vk.MOD_META
  return mods
}

/**
 * A hardware key as the engine sees it, or null for a key the keyboard never
 * handles (volume, media, a bare modifier). `unicodeChar` is what
 * `KeyEvent.getUnicodeChar(metaState)` answered; 0 means none.
 */
fun hardwareKey(keyCode: Int, unicodeChar: Int, metaState: Int): EngineKey? {
  val mods = modsOf(metaState)
  FUNCTION_KEYS[keyCode]?.let { return EngineKey.function(it, mods) }
  if (keyCode == KeyEvent.KEYCODE_SPACE) return EngineKey.char(' '.code, mods)
  // A dead key (accent) arrives with the combining bit set; it is not text.
  if (unicodeChar == 0 || unicodeChar and KeyCharacterMap.COMBINING_ACCENT != 0) return null
  return EngineKey.char(unicodeChar, mods)
}

/**
 * Whether a hardware key goes to the engine, decided now because `onKeyDown`
 * has to answer before the engine has. A shortcut never does. While composing
 * everything else does (the composition owns Backspace, Enter, the arrows);
 * otherwise printable keys do, and a key the engine then declines is inserted
 * by the keyboard itself. Function keys outside a composition go straight to
 * the application, so its own repeat and navigation are untouched.
 */
fun shouldEat(key: EngineKey, composing: Boolean): Boolean = when {
  key.isShortcut -> false
  composing -> true
  else -> key.isPrintable
}
