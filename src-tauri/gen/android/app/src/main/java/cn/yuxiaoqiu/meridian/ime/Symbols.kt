package cn.yuxiaoqiu.meridian.ime

/**
 * The symbol panel's pages. Whatever the long-press menus on comma and full
 * stop cannot hold; each item is inserted exactly as written. `wide` pages
 * lay their items out a few to a row, for kaomoji that do not fit a key.
 */
data class SymbolPage(val name: String, val items: List<String>, val wide: Boolean = false)

private fun chars(s: String): List<String> = s.codePoints().toArray().map { String(Character.toChars(it)) }

val SYMBOL_PAGES: List<SymbolPage> = listOf(
  SymbolPage(
    "中文",
    listOf("，", "。", "、", "；", "：", "？", "！", "……", "——", "·") +
      chars("“”‘’「」『』《》〈〉（）【】〔〕～￥"),
  ),
  SymbolPage("英文", chars(",.;:?!'\"()[]{}<>@#\$%^&*_-+=/\\|`~")),
  SymbolPage("数学", chars("±×÷≈≠≤≥∞√∑∏∫∂∆π°‰∈∉⊂⊃∪∩∀∃¬∧∨⇒⇔∝∠⊥")),
  SymbolPage("单位", chars("℃℉㎡㎥㎏㎎㎞㎝㎜¥\$€£¢₩₽₹₿№™©®")),
  SymbolPage("序号", chars("←→↑↓↔↕↖↗↘↙①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ★☆●○■□◆◇▲△※✓✗")),
  SymbolPage(
    "颜文字",
    listOf(
      "(＾▽＾)", "(´・ω・`)", "(｀・ω・´)", "(＞﹏＜)", "(；′⌒`)", "(⊙_⊙)", "Σ(ﾟдﾟ)", "(・∀・)",
      "(*^▽^*)", "ヽ(✿ﾟ▽ﾟ)ノ", "(｡•́︿•̀｡)", "(T_T)", "(ಥ_ಥ)", "(￣^￣)", "( ˘ω˘ )", "(=・ω・=)",
      "(๑•̀ㅂ•́)و✧", "(ง •̀_•́)ง", "(～￣▽￣)～", "(≧∇≦)/", "¯\\_(ツ)_/¯", "(╯°□°）╯︵ ┻━┻",
      "┬─┬ノ( º _ ºノ)", "(｡･ω･｡)", "OωO", "QAQ", "orz",
    ),
    wide = true,
  ),
)
