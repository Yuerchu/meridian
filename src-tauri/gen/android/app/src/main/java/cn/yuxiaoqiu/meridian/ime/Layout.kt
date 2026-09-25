package cn.yuxiaoqiu.meridian.ime

/**
 * The keyboard's layers as data. A key says what it does and how wide it is;
 * what a grid key sends and how it is labelled comes from the engine's token
 * table (`GridToken`), looked up by name, so the layout places keys and the
 * engine defines them. LayoutTest checks every token is placed exactly once.
 */
enum class Layer { GRID, QWERTY, NUMBER }

sealed interface KeyAction {
  /** A grid key, by token name (`ai`, `ng`, `t3`). */
  data class Token(val name: String) : KeyAction
  /** A QWERTY letter; Shift makes it a capital. */
  data class Letter(val ch: Char) : KeyAction
  /** Text inserted exactly as given (number layer, menu items). */
  data class Text(val text: String) : KeyAction
  /** `,` or `.` sent as a key, so the engine gives it the mode's width. */
  data class Punct(val ch: Char) : KeyAction
  data object Backspace : KeyAction
  data object Space : KeyAction
  data object Enter : KeyAction
  data object Shift : KeyAction
  /** 中/英 on the QWERTY layer: the engine's mode switch. */
  data object ToggleMode : KeyAction
  /** Tap: grid ↔ QWERTY. Long press: the system's keyboard picker. */
  data object Globe : KeyAction
  data class ToLayer(val layer: Layer) : KeyAction
  /** Back to whichever letter layer the number layer was opened from. */
  data object BackToLetters : KeyAction
  /** Empty space, for the half-key inset of a staggered row. */
  data object Spacer : KeyAction
}

/**
 * A key: its action, an optional fixed label, its width in columns, its
 * long-press menu, and an optional corner hint (otherwise the hint says what
 * the long press chiefly offers).
 */
data class KeySpec(
  val action: KeyAction,
  val label: String? = null,
  val width: Float = 1f,
  val menu: List<KeyAction> = emptyList(),
  val hint: String? = null,
)

typealias Row = List<KeySpec>

private fun t(name: String, vararg menu: KeyAction) = KeySpec(KeyAction.Token(name), menu = menu.toList())

/** The medials, hinted with the vowel each stands for in pinyin: y is i, w is u, v is ü. */
private fun medial(name: String, vowel: String) = KeySpec(KeyAction.Token(name), hint = vowel)
private fun text(s: String) = KeySpec(KeyAction.Text(s), label = s)
private val backspace = KeySpec(KeyAction.Backspace)

/** Tone keys by the name the engine gives them. */
private const val T1 = "t1"
private const val T2 = "t2"
private const val T3 = "t3"
private const val T4 = "t4"
private const val T5 = "t5"

/**
 * The grid, nine columns, as the prototype drew it with two later changes:
 * Backspace is one column wide and the first tone takes the column it gave
 * up, and Space only commits (no digit under it). The first row's long press
 * also offers its column's digit, 1 to 9.
 */
val GRID_LETTER_ROWS: List<Row> = listOf(
  listOf("b", "d", T4, T3, "z", T5, T2, "ai", "ao").mapIndexed { i, name -> t(name, KeyAction.Text("${i + 1}")) },
  listOf(t("p"), t("t"), t("g"), t("j"), t("c"), medial("y", "i"), t("a"), t("ei"), t("ou")),
  listOf(t("m"), t("n"), t("k"), t("q"), t("s"), medial("w", "u"), t("o"), t("er"), t("ng")),
  listOf(t("f"), t("l"), t("h"), t("x"), t("r"), medial("v", "ü"), t("e"), t(T1), backspace),
)

private fun letters(s: String, digits: String? = null) = s.mapIndexed { i, c ->
  KeySpec(KeyAction.Letter(c), menu = digits?.let { listOf(KeyAction.Text(it[i].toString())) } ?: emptyList())
}

/** Pinyin and English. Ten columns; the second row is inset by half a key. */
val QWERTY_LETTER_ROWS: List<Row> = listOf(
  letters("qwertyuiop", "1234567890"),
  listOf(KeySpec(KeyAction.Spacer, width = 0.5f)) + letters("asdfghjkl") +
    KeySpec(KeyAction.Spacer, width = 0.5f),
  listOf(KeySpec(KeyAction.Shift, width = 1.5f)) + letters("zxcvbnm") + backspace.copy(width = 1.5f),
)

/**
 * The number layer on the grid's geometry: the dial pad in the right three
 * columns (1 2 3 on top, 0 under 8), symbols to the left, Backspace where the
 * letter layer has it. Everything here is inserted as given — a digit typed
 * while composing must not select a candidate.
 */
val NUMBER_ROWS: List<Row> = listOf(
  listOf("+", "-", "*", "/", "=", "%", "1", "2", "3").map(::text),
  listOf("@", "#", "&", "_", ":", "(", "4", "5", "6").map(::text),
  listOf("~", "^", "<", ">", ";", ")", "7", "8", "9").map(::text),
  listOf("!", "?", "\"", "'", "…", ".", ",", "0").map(::text) + backspace,
)

/**
 * The comma and full stop keys' menus. The comma holds what goes inside a
 * sentence and what opens; the full stop what ends one and what closes, in
 * mirrored order so an opening mark and its closing one sit at the same
 * place in the two menus. The first item is always the key's own mark in
 * the other width, the commonest reason to long-press it.
 */
fun commaMenu(chinese: Boolean): List<KeyAction> =
  (listOf(if (chinese) "," else "，") + COMMA_REST).map { KeyAction.Text(it) }

fun stopMenu(chinese: Boolean): List<KeyAction> =
  (listOf(if (chinese) "." else "。") + STOP_REST).map { KeyAction.Text(it) }

internal val COMMA_REST = listOf("、", "；", "：", "“", "‘", "《", "（", "【", "「", "<", "(", "[")
internal val STOP_REST = listOf("？", "！", "……", "”", "’", "》", "）", "】", "」", ">", ")", "]")

/** Where the opening marks start in both menus (after the width item and three others). */
internal const val BRACKETS_FROM = 4

/** The bottom row, which every layer shares apart from its layer key and the letters' 中/英. */
fun bottomRow(layer: Layer): Row {
  val layerKey = when (layer) {
    Layer.NUMBER -> KeySpec(KeyAction.BackToLetters, label = "ABC")
    else -> KeySpec(KeyAction.ToLayer(Layer.NUMBER), label = "123")
  }
  val comma = KeySpec(KeyAction.Punct(','))
  val stop = KeySpec(KeyAction.Punct('.'))
  return if (layer == Layer.QWERTY) {
    listOf(
      layerKey.copy(width = 1.5f),
      KeySpec(KeyAction.Globe),
      KeySpec(KeyAction.ToggleMode, width = 1f),
      comma,
      KeySpec(KeyAction.Space, width = 3f),
      stop,
      KeySpec(KeyAction.Enter, width = 1.5f),
    )
  } else {
    listOf(
      layerKey,
      KeySpec(KeyAction.Globe),
      comma,
      KeySpec(KeyAction.Space, width = 3f),
      stop,
      KeySpec(KeyAction.Enter, width = 2f),
    )
  }
}

fun rows(layer: Layer): List<Row> = when (layer) {
  Layer.GRID -> GRID_LETTER_ROWS
  Layer.QWERTY -> QWERTY_LETTER_ROWS
  Layer.NUMBER -> NUMBER_ROWS
} + listOf(bottomRow(layer))

/** A grid key's long-press menu: the precise keys behind it first, then its own extras. */
fun gridMenu(spec: KeySpec, tokens: Map<String, GridToken>): List<KeyAction> {
  val name = (spec.action as? KeyAction.Token)?.name ?: return spec.menu
  val variants = tokens[name]?.variants.orEmpty().map { KeyAction.Token(it) }
  return variants + spec.menu
}

/** What Enter says in a field whose editor action is `action`. */
fun enterLabel(action: Int?): String = when (action) {
  android.view.inputmethod.EditorInfo.IME_ACTION_GO -> "前往"
  android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH -> "搜索"
  android.view.inputmethod.EditorInfo.IME_ACTION_SEND -> "发送"
  android.view.inputmethod.EditorInfo.IME_ACTION_NEXT -> "下一项"
  android.view.inputmethod.EditorInfo.IME_ACTION_DONE -> "完成"
  android.view.inputmethod.EditorInfo.IME_ACTION_PREVIOUS -> "上一项"
  else -> "⏎"
}
