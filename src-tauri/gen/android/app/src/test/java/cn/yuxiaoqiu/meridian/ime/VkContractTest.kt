package cn.yuxiaoqiu.meridian.ime

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The numbers in [Vk] against the Rust files that define them, read as text:
 * `session/src/keys.rs` for the virtual keys and `android/src/bridge.rs` for
 * the modifier bits. Neither side can change a number alone.
 */
class VkContractTest {
  private fun constants(path: String, type: String): Map<String, Int> {
    val re = Regex("""pub const (\w+): $type = (0x[0-9A-Fa-f]+|\d+);""")
    return re.findAll(rustFile(path).readText()).associate { m ->
      val v = m.groupValues[2]
      m.groupValues[1] to if (v.startsWith("0x")) v.substring(2).toInt(16) else v.toInt()
    }
  }

  @Test
  fun virtualKeysMatchTheSession() {
    val rust = constants("ime/session/src/keys.rs", "u32")
    val kotlin = mapOf(
      "VK_BACK" to Vk.BACK, "VK_TAB" to Vk.TAB, "VK_RETURN" to Vk.RETURN, "VK_SHIFT" to Vk.SHIFT,
      "VK_ESCAPE" to Vk.ESCAPE, "VK_SPACE" to Vk.SPACE, "VK_PRIOR" to Vk.PRIOR, "VK_NEXT" to Vk.NEXT,
      "VK_END" to Vk.END, "VK_HOME" to Vk.HOME, "VK_LEFT" to Vk.LEFT, "VK_UP" to Vk.UP,
      "VK_RIGHT" to Vk.RIGHT, "VK_DOWN" to Vk.DOWN, "VK_DELETE" to Vk.DELETE,
    )
    assertEquals(rust, kotlin)
  }

  @Test
  fun modifierBitsMatchTheBridge() {
    val rust = constants("ime/android/src/bridge.rs", "i32")
    assertEquals(
      mapOf("MOD_SHIFT" to Vk.MOD_SHIFT, "MOD_CTRL" to Vk.MOD_CTRL, "MOD_ALT" to Vk.MOD_ALT, "MOD_META" to Vk.MOD_META),
      rust,
    )
  }

  @Test
  fun printableVirtualKeysFollowKeysPrintable() {
    assertEquals(0x41, Vk.forChar('a'.code))
    assertEquals(0x5A, Vk.forChar('Z'.code))
    assertEquals(0x30, Vk.forChar('0'.code))
    assertEquals(Vk.SPACE, Vk.forChar(' '.code))
    assertEquals(0, Vk.forChar('，'.code))
    assertEquals(0, Vk.forChar(0xE005))
  }
}
