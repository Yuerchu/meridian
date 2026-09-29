package cn.yuxiaoqiu.meridian.ime

/**
 * The symbol panel's pages. Whatever the long-press menus on comma and full
 * stop cannot hold; each item is inserted exactly as written. `wide` pages
 * lay their items out a few to a row, for kaomoji that do not fit a key.
 * Emoji are not here: they have a panel of their own, which knows what the
 * device's font can draw.
 */
data class SymbolPage(val name: String, val items: List<String>, val wide: Boolean = false)

private fun chars(s: String): List<String> = s.codePoints().toArray().map { String(Character.toChars(it)) }

/** Every code point from `first` to `last`, for a block the standard lays out in order. */
private fun span(first: Int, last: Int): List<String> = (first..last).map { String(Character.toChars(it)) }

val SYMBOL_PAGES: List<SymbolPage> = listOf(
  SymbolPage(
    "中文",
    listOf("，", "。", "、", "；", "：", "？", "！", "……", "——", "·") +
      chars("“”‘’「」『』《》〈〉（）【】〔〕〖〗～￥…〃々〆〇﹏｜‖／＼＃＠＆＊％＋－＝＜＞＿＾｀＂＇"),
  ),
  SymbolPage("英文", chars(",.;:?!'\"()[]{}<>@#\$%^&*_-+=/\\|`~¡¿§¶•…–—«»‹›")),
  SymbolPage(
    "颜文字",
    listOf(
      "(＾▽＾)", "(´・ω・`)", "(｀・ω・´)", "(＞﹏＜)", "(；′⌒`)", "(⊙_⊙)", "Σ(ﾟдﾟ)", "(・∀・)",
      "(*^▽^*)", "ヽ(✿ﾟ▽ﾟ)ノ", "(｡•́︿•̀｡)", "(T_T)", "(ಥ_ಥ)", "(￣^￣)", "( ˘ω˘ )", "(=・ω・=)",
      "(๑•̀ㅂ•́)و✧", "(ง •̀_•́)ง", "(～￣▽￣)～", "(≧∇≦)/", "¯\\_(ツ)_/¯", "(╯°□°）╯︵ ┻━┻",
      "┬─┬ノ( º _ ºノ)", "(｡･ω･｡)", "OωO", "QAQ", "orz",
      "(＾＾)ｂ", "(っ´ω`c)", "(*/ω＼*)", "(〃'▽'〃)", "(✪ω✪)", "(^_−)☆", "(｡♥‿♥｡)", "(づ｡◕‿‿◕｡)づ",
      "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧", "٩(◕‿◕｡)۶", "(￣▽￣)ノ", "(・ω・)ノ", "ヾ(•ω•`)o", "(´∀｀)♡", "(´；ω；`)", "(ノへ￣、)",
      "(＃°Д°)", "(╬￣皿￣)", "(ー_ー)!!", "(￣ε(#￣)", "(°ー°〃)", "(・_・;)", "(；一_一)", "(￣～￣;)",
      "_(:з」∠)_", "(:3[▓▓]", "(￣o￣) . z Z", "(´-ω-`)", "( ・_・)ノ⌒●~*", "(ノ°ο°)ノ", "∑(っ°Д°;)っ", "(⊙ˍ⊙)",
    ),
    wide = true,
  ),
  SymbolPage(
    "数学",
    chars("+−×÷=≠≈≡≤≥<>±∓∞√∛∑∏∫∬∮∂∆∇π°′″‰‱∈∉⊂⊃⊆⊇∪∩∅∀∃¬∧∨⇒⇔∝∠⊥∥∵∴∽≌⊙⊕⊗ℵ") +
      chars("½⅓⅔¼¾⅕⅙⅛⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎"),
  ),
  SymbolPage("序号", span(0x2460, 0x2473) + span(0x2474, 0x2487) + span(0x2488, 0x249B) + span(0x3220, 0x3229) +
    span(0x2160, 0x216B) + span(0x2170, 0x217B) + span(0x2776, 0x277F) + span(0x24B6, 0x24CF) + span(0x24D0, 0x24E9)),
  SymbolPage(
    "单位",
    chars("℃℉°㎡㎥㎠㎤㎏㎎㎍㎞㎝㎜㎛㏄㎖㎗㎘㏎㏑㏒㎐㎑㎒㎓㎾㎿Ω℧µÅ№™©®℗℡") +
      chars("¥\$€£¢₩₽₹₿₫₱₴₺₸₦₪฿"),
  ),
  SymbolPage("箭头", chars("←↑→↓↔↕↖↗↘↙⇐⇑⇒⇓⇔⇕⇄⇅⇆⇇⇈⇉⇊↩↪↺↻↞↟↠↡↢↣↤↥↦↧⟵⟶⟷⟸⟹⟺➔➜➝➞➟➠➡➢➣➤➥➦➧➨")),
  SymbolPage(
    "图形",
    chars("★☆✦✧✩✪✫✬✭✮✯✰●○◎◉◐◑◒◓◆◇◈■□▢▣▤▥▦▧▨▩▪▫▲△▼▽◀▶◁▷◢◣◤◥♠♥♣♦♤♡♧♢♩♪♫♬♭♮♯") +
      chars("☀☁☂☃☄☎☏☐☑☒✓✔✕✗✘※†‡•◦☯☮☢☣♂♀⚤✿❀❁❃❋❤❥❦❧☞☜☝☟✌✍"),
  ),
  SymbolPage("拼音", chars("āáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜüêńňǹḿĀÁǍÀŌÓǑÒĒÉĚÈĪÍǏÌŪÚǓÙǕǗǙǛÜÊ")),
  SymbolPage("注音", span(0x3105, 0x3129) + chars("ˉˊˇˋ˙")),
  SymbolPage("希腊", span(0x03B1, 0x03C9) + span(0x0391, 0x03A1) + span(0x03A3, 0x03A9)),
  SymbolPage("平假名", span(0x3041, 0x3096) + chars("ゝゞー")),
  SymbolPage("片假名", span(0x30A1, 0x30FA) + chars("ヽヾー・")),
  SymbolPage("俄文", span(0x0410, 0x044F) + chars("Ёё")),
  SymbolPage("制表", span(0x2500, 0x257F) + span(0x2580, 0x259F)),
)
