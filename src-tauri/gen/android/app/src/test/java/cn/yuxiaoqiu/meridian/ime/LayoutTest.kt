package cn.yuxiaoqiu.meridian.ime

import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LayoutTest {
  private val tokens = EngineJson.decodeFromString(
    ListSerializer(GridToken.serializer()),
    rustFile("ime/android/fixtures/grid-tokens.json").readText(),
  )

  private fun placedTokens(): List<String> =
    GRID_LETTER_ROWS.flatten().mapNotNull { (it.action as? KeyAction.Token)?.name }

  @Test
  fun everyGridKeyIsPlacedOnceAndEveryOtherIsALongPress() {
    val placed = placedTokens()
    assertEquals("placed twice: ${placed.groupBy { it }.filter { it.value.size > 1 }.keys}", placed.toSet().size, placed.size)
    val variants = tokens.flatMap { it.variants }.toSet()
    val all = tokens.map { it.name }.toSet()
    // 平声 is Space, so t1 is not on the board; Backspace took that column.
    val spaceTone = setOf("t1")
    assertEquals("a token reachable by no key", all, placed.toSet() + variants + spaceTone)
    assertTrue("a placed name the engine does not know", all.containsAll(placed))
    assertEquals(34, placed.size)
    assertEquals(2f, GRID_LETTER_ROWS[3].last().width)
  }

  @Test
  fun rowsFillTheirColumns() {
    fun widths(layer: Layer) = rows(layer).map { row -> row.sumOf { it.width.toDouble() } }
    assertEquals(List(5) { 9.0 }, widths(Layer.GRID))
    assertEquals(List(4) { 3.0 } + listOf(9.0), widths(Layer.NUMBER))
    assertEquals(List(4) { 10.0 }, widths(Layer.QWERTY))
  }

  /** One tap to English from either Chinese layout, and the choice between them on its long press. */
  @Test
  fun bothLetterLayersSwitchLanguageInOneKey() {
    for (layer in listOf(Layer.GRID, Layer.QWERTY)) {
      val toggle = bottomRow(layer).single { it.action == KeyAction.ToggleMode }
      assertEquals(CHINESE_LAYOUTS, toggle.menu)
    }
    assertTrue(bottomRow(Layer.NUMBER).none { it.action == KeyAction.ToggleMode })
  }

  @Test
  fun theDialPadIsComplete() {
    val digits = NUMBER_DIAL_ROWS.flatten().mapNotNull { (it.action as? KeyAction.Text)?.text }.filter { it.single().isDigit() }
    assertEquals((0..9).map { "$it" }.sorted(), digits.sorted())
    assertEquals(listOf("1", "2", "3"), NUMBER_DIAL_ROWS[0].map { it.label })
    assertEquals("0", NUMBER_DIAL_ROWS[3][1].label)
  }

  @Test
  fun theNumberSymbolsLeadWithPriceTimeAndDecimal() {
    assertEquals(listOf("￥", "$", ".", ":"), NUMBER_SYMBOLS.take(4).map { it.label })
    assertTrue(NUMBER_SYMBOLS.size > 4)
    assertEquals(KeyAction.Backspace, NUMBER_BACKSPACE.action)
    assertEquals(KeyAction.Enter, NUMBER_ENTER.action)
    assertTrue(bottomRow(Layer.NUMBER).none { it.action == KeyAction.Enter })
  }

  @Test
  fun backspaceStaysPutAcrossLayers() {
    assertEquals(KeyAction.Backspace, GRID_LETTER_ROWS[3].last().action)
    assertEquals(KeyAction.Backspace, NUMBER_BACKSPACE.action)
  }

  @Test
  fun thePunctuationMenusMirrorEachOther() {
    val pairs = mapOf(
      "“" to "”", "‘" to "’", "《" to "》", "（" to "）", "【" to "】", "「" to "」",
      "<" to ">", "(" to ")", "[" to "]",
    )
    assertEquals(COMMA_REST.size, STOP_REST.size)
    for (i in (BRACKETS_FROM - 1) until COMMA_REST.size) {
      assertEquals("position ${i + 1}", pairs[COMMA_REST[i]], STOP_REST[i])
    }
    assertEquals(KeyAction.Text(","), commaMenu(chinese = true).first())
    assertEquals(KeyAction.Text("，"), commaMenu(chinese = false).first())
    assertEquals(KeyAction.Text("."), stopMenu(chinese = true).first())
    assertEquals(KeyAction.Text("。"), stopMenu(chinese = false).first())
  }

  @Test
  fun theMedialsSayWhichVowelTheyAre() {
    val hints = GRID_LETTER_ROWS.flatten()
      .filter { (it.action as? KeyAction.Token)?.name in setOf("y", "w", "v") }
      .associate { (it.action as KeyAction.Token).name to it.hint }
    assertEquals(mapOf("y" to "i", "w" to "u", "v" to "ü"), hints)
  }

  @Test
  fun aFuzzyKeyOffersItsPreciseKeysFirst() {
    val byName = tokens.associateBy { it.name }
    val z = GRID_LETTER_ROWS.flatten().single { it.action == KeyAction.Token("z") }
    assertEquals(
      listOf(KeyAction.Token("z_"), KeyAction.Token("zh"), KeyAction.Text("5")),
      gridMenu(z, byName),
    )
    val ng = GRID_LETTER_ROWS.flatten().single { it.action == KeyAction.Token("ng") }
    assertEquals(listOf("-n", "-ng").map { KeyAction.Token(it) }, gridMenu(ng, byName))
  }

  @Test
  fun spaceTookTheSwitcherColumn() {
    assertEquals(6, bottomRow(Layer.GRID).size)
    assertEquals(6, bottomRow(Layer.QWERTY).size)
    assertEquals(4, bottomRow(Layer.NUMBER).size)
    val gridSpace = bottomRow(Layer.GRID).single { it.action == KeyAction.Space }
    assertEquals(3f, gridSpace.width)
    assertEquals("ˉ", gridSpace.hint)
    assertEquals(4f, bottomRow(Layer.QWERTY).single { it.action == KeyAction.Space }.width)
    assertEquals(6f, bottomRow(Layer.NUMBER).single { it.action == KeyAction.Space }.width)
  }
}
