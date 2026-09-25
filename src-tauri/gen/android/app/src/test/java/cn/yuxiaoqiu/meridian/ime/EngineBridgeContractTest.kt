package cn.yuxiaoqiu.meridian.ime

import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decodes the JSON the Rust side pins in `ime/android/fixtures` with the
 * classes the keyboard uses. The Rust tests assert the library still
 * produces these bytes; these assert the keyboard still reads them.
 */
class EngineBridgeContractTest {
  @Test
  fun outcomesDecode() {
    val text = rustFile("ime/android/fixtures/outcomes.json").readText()
    val (composing, committed) = EngineJson.decodeFromString(ListSerializer(KeyOutcome.serializer()), text)
    assertTrue(composing.consumed)
    assertNull(composing.commit)
    assertEquals("ni", composing.frame.preeditText)
    assertEquals(PreeditKind.SYLLABLE, composing.frame.preedit[0].kind)
    assertEquals(listOf("你", "泥"), composing.frame.candidates.map { it.text })
    assertEquals(CandidateSource.DICT, composing.frame.candidates[0].source)
    assertEquals(1, composing.frame.pageCount)
    assertEquals(InputMode.CHINESE, composing.frame.mode)
    assertEquals("你", committed.commit)
    assertTrue(committed.frame.isEmpty)
  }

  @Test
  fun gridTokensDecodeAndVariantsNameKeys() {
    val text = rustFile("ime/android/fixtures/grid-tokens.json").readText()
    val tokens = EngineJson.decodeFromString(ListSerializer(GridToken.serializer()), text)
    val names = tokens.map { it.name }.toSet()
    tokens.forEach { t ->
      assertEquals("one key is one code point: ${t.name}", 1, t.key.codePointCount(0, t.key.length))
      t.variants.forEach { assertTrue("${t.name} offers unknown $it", it in names) }
    }
    val ng = tokens.single { it.name == "ng" }
    assertEquals("", ng.key)
    assertEquals(GridRole.NASAL, ng.role)
    assertEquals(listOf("er", "-n", "-ng"), ng.variants)
  }

  @Test(expected = SerializationException::class)
  fun anUnknownFieldIsAnError() {
    EngineJson.decodeFromString(
      CandidateItem.serializer(),
      """{"text":"你","source":"dict","extra":1}""",
    )
  }
}
