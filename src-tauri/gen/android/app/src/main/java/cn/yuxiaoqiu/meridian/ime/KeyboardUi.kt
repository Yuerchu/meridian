package cn.yuxiaoqiu.meridian.ime

import android.content.res.Configuration
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateOffsetAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.changedToUpIgnoreConsumed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.emoji2.emojipicker.RecentEmojiProvider
import cn.yuxiaoqiu.meridian.R

/** What the keyboard draws; written by the service, read by Compose. */
@Stable
class KeyboardState {
  var frame by mutableStateOf<Frame?>(null)
  var layer by mutableStateOf(Layer.GRID)
  /** The letter layer the number layer returns to. */
  var lettersLayer by mutableStateOf(Layer.GRID)
  var mode by mutableStateOf(InputMode.CHINESE)
  /** Which layer Chinese is typed on (GRID or QWERTY); English is QWERTY. */
  var chineseLayout by mutableStateOf(Layer.GRID)
  /** The next letter is a capital. */
  var shifted by mutableStateOf(false)
  /** Every letter is a capital, until Shift is pressed again. */
  var capsLock by mutableStateOf(false)
  /** The key under the finger, drawn enlarged above it. */
  var preview by mutableStateOf<KeyPreview?>(null)
  var tokens by mutableStateOf<Map<String, GridToken>>(emptyMap())
  var enterAction by mutableStateOf<Int?>(null)
  var menu by mutableStateOf<OpenMenu?>(null)
  /** MiSans once the app has written it out; null is the system font. */
  var font by mutableStateOf<androidx.compose.ui.text.font.FontFamily?>(null)
  /** What the toolbar opened in place of the keys; null is the keys. */
  var panel by mutableStateOf<Panel?>(null)
  /** The editing panel's arrows extend the selection. */
  var selecting by mutableStateOf(false)
  /** Nothing is learned or remembered, whatever the field says. */
  var incognito by mutableStateOf(false)
  var clips by mutableStateOf<List<Clip>>(emptyList())
  /** Just copied, offered on the toolbar until it is pasted or goes stale. */
  var chip by mutableStateOf<Clip?>(null)
  /** Whether copies are being remembered at all. */
  var recording by mutableStateOf(true)
  /** A one-time code just copied ([codeIn]); offered before [chip], never kept. */
  var code by mutableStateOf<Clip?>(null)
  /**
   * An autofill service's suggestions for this field, as the views it drew
   * (`InlineContentView`, Android 11+). Opaque on purpose: a tap fills the
   * field through the system and the keyboard never reads the value.
   */
  var inline by mutableStateOf<List<View>>(emptyList())
}

/** A pressed key's label and where the key is, in the keyboard's coordinates. */
data class KeyPreview(val label: String, val left: Float, val right: Float, val top: Float)

/** A long-press menu on screen, with the item the finger is over. */
data class OpenMenu(val items: List<KeyAction>, val geometry: MenuGeometry, val highlight: Int)

interface KeyboardActions {
  fun onKey(action: KeyAction)
  fun onChoose(index: Int)
  fun onPage(forward: Boolean)
  fun onHide()
  /** The globe key: the system's list of keyboards. */
  fun onPicker()
  fun onPanel(panel: Panel?)
  fun onEdit(action: EditAction)
  fun onPasteClip(clip: Clip)
  fun onPinClip(clip: Clip, pinned: Boolean)
  fun onRemoveClip(clip: Clip)
  fun onClearClips()
  fun onRecording(on: Boolean)
  fun onIncognito()
  fun onOpenSettings()
  /** The emoji panel's recently used row, recorded only where learning is on. */
  val emojiRecents: RecentEmojiProvider
}

private const val FULL_ROWS = 5

/** The candidate bar, and the bar over an open panel, which must match it. */
internal val BAR_HEIGHT = 56.dp
private const val LONG_PRESS_MS = 300L
private const val REPEAT_DELAY_MS = 400L
private const val REPEAT_EVERY_MS = 50L

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ImeTheme(content: @Composable () -> Unit) {
  val context = LocalContext.current
  val dark = isSystemInDarkTheme()
  val colors = when {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
      if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    dark -> darkColorScheme()
    else -> lightColorScheme()
  }
  MaterialExpressiveTheme(colorScheme = colors, motionScheme = MotionScheme.expressive(), content = content)
}

/** The label a key or a menu item shows. */
fun labelOf(action: KeyAction, state: KeyboardState): String = when (action) {
  is KeyAction.Token -> state.tokens[action.name]?.label ?: action.name
  is KeyAction.Letter -> if (state.shifted || state.capsLock) action.ch.uppercase() else action.ch.toString()
  is KeyAction.Text -> action.text
  is KeyAction.Punct -> when {
    state.mode == InputMode.ENGLISH -> action.ch.toString()
    action.ch == ',' -> "，"
    else -> "。"
  }
  KeyAction.Backspace -> "⌫"
  KeyAction.Space -> if (state.incognito) "无痕" else "空格"
  KeyAction.Enter -> enterLabel(state.enterAction)
  KeyAction.Shift -> "⇧"
  KeyAction.ToggleMode -> if (state.mode == InputMode.CHINESE) "中" else "英"
  is KeyAction.ChineseLayout -> if (action.layer == Layer.GRID) "九宫格" else "拼音"
  KeyAction.Globe -> "🌐"
  is KeyAction.ToLayer -> "123"
  KeyAction.BackToLetters -> "ABC"
  KeyAction.Spacer -> ""
}

/**
 * The keys drawn as keyline two-tone icons (res/drawable/ime_*.xml, the
 * app's icon set) rather than as text: a glyph like ⌫ or an emoji globe comes
 * out in whatever font the device has. Enter keeps a word when the field has
 * an action for it.
 */
private fun iconOf(action: KeyAction, state: KeyboardState): Int? = when (action) {
  KeyAction.Backspace -> R.drawable.ime_backspace
  KeyAction.Shift -> if (state.capsLock) R.drawable.ime_shift_lock else R.drawable.ime_shift
  KeyAction.Globe -> R.drawable.ime_globe
  KeyAction.Enter -> if (state.enterAction == null) R.drawable.ime_enter else null
  else -> null
}

/** The long-press menu a key opens in the current state. */
fun menuOf(spec: KeySpec, state: KeyboardState): List<KeyAction> {
  val chinese = state.mode == InputMode.CHINESE
  return when (val a = spec.action) {
    is KeyAction.Punct -> if (a.ch == ',') commaMenu(chinese) else stopMenu(chinese)
    is KeyAction.Token -> gridMenu(spec, state.tokens)
    else -> spec.menu
  }
}

/** The small hint in a key's corner: what its long press chiefly offers. */
private fun hintOf(spec: KeySpec, state: KeyboardState): String? {
  spec.hint?.let { return it }
  val own = labelOf(spec.action, state)
  val menu = menuOf(spec, state)
  menu.filterIsInstance<KeyAction.Text>().lastOrNull()?.let { if (it.text.length == 1 && it.text[0].isDigit()) return it.text }
  return menu.filterIsInstance<KeyAction.Token>().map { labelOf(it, state) }.firstOrNull { it != own }
}

private enum class Role { CHARACTER, TONE, FUNCTION, ACTION }

private fun roleOf(spec: KeySpec, state: KeyboardState): Role = when (val a = spec.action) {
  KeyAction.Enter -> Role.ACTION
  is KeyAction.Token -> if (state.tokens[a.name]?.role == GridRole.TONE) Role.TONE else Role.CHARACTER
  is KeyAction.Letter, is KeyAction.Text, is KeyAction.Punct, KeyAction.Space -> Role.CHARACTER
  KeyAction.Shift -> if (state.shifted || state.capsLock) Role.ACTION else Role.FUNCTION
  else -> Role.FUNCTION
}

@Composable
fun KeyboardScreen(state: KeyboardState, actions: KeyboardActions) {
  val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
  // Every layer is as tall as the five-row grid, so switching layers does not
  // move the application above the keyboard: QWERTY's four rows grow instead.
  val layerRows = rows(state.layer)
  val rowHeight = (if (landscape) 40.dp else 52.dp) * FULL_ROWS / layerRows.size
  var viewWidth by remember { mutableStateOf(0f) }
  // Everything on the keyboard is drawn at 500, in MiSans when it is there.
  val text = LocalTextStyle.current.merge(TextStyle(fontFamily = state.font, fontWeight = FontWeight.Medium))
  CompositionLocalProvider(LocalTextStyle provides text) {
  Box(
    Modifier
      .fillMaxWidth()
      .background(MaterialTheme.colorScheme.surfaceContainer)
      .onGloballyPositioned { viewWidth = it.size.width.toFloat() }
      .navigationBarsPadding(),
  ) {
    // A panel and the keys cross-fade, the one arriving growing in slightly.
    // Both are the same height, so nothing above moves while they do.
    val panelIn = fadeIn(defaultEffects()) + scaleIn(defaultSpatial(), initialScale = 0.94f)
    val panelOut = fadeOut(fastEffects())
    AnimatedContent(
      state.panel,
      Modifier.fillMaxWidth().padding(horizontal = 3.dp, vertical = 2.dp),
      transitionSpec = { panelIn togetherWith panelOut },
      label = "panel",
    ) { panel ->
      Column(Modifier.fillMaxWidth()) {
        if (panel != null) {
          PanelBar(panel, state, actions)
          // As tall as the keys it replaces, so opening it moves nothing above.
          Box(Modifier.fillMaxWidth().height(rowHeight * layerRows.size)) {
            when (panel) {
              Panel.EDIT -> EditPanel(state, actions)
              Panel.CLIPBOARD -> ClipboardPanel(state, actions)
              Panel.SYMBOLS -> SymbolsPanel(actions)
              Panel.EMOJI -> EmojiPanel(actions.emojiRecents) { actions.onKey(KeyAction.Text(it)) }
              Panel.CANDIDATES -> CandidateGrid(state, actions)
            }
          }
        } else {
          CandidateBar(state, actions)
          // A new layer fades in over nothing: the old keys go at once, so a
          // key tapped straight after the switch is always one of the new. It
          // does not grow in: each key records where it is (boundsInRoot) for
          // its preview and its menu, and must not record a scaled position.
          val layerIn = rememberAppear(state.layer)
          key(state.layer) {
            Column(Modifier.fillMaxWidth().popIn(layerIn, TransformOrigin.Center, from = 1f)) {
              for (row in layerRows) {
                Row(Modifier.fillMaxWidth().height(rowHeight)) {
                  for (spec in row) Key(spec, state, actions, viewWidth)
                }
              }
            }
          }
        }
      }
    }
    state.preview?.let { PreviewOverlay(it) }
    state.menu?.let { MenuOverlay(it, state) }
  }
  }
}

@Composable
private fun CandidateBar(state: KeyboardState, actions: KeyboardActions) {
  val frame = state.frame
  val preedit = frame?.preeditText.orEmpty()
  Column(Modifier.fillMaxWidth().height(BAR_HEIGHT)) {
    // What is being typed is drawn here and never put in the field
    // (OutcomeApplier says why). The line is there whenever candidates are, so
    // they sit at one height whether a word is being typed or predicted.
    if (preedit.isNotEmpty() || frame?.candidates?.isNotEmpty() == true) {
      Text(
        preedit,
        // Its own height, not a fixed one: MiSans sits tall in its line, and the
        // text scales with the system font size while a dp box would not.
        Modifier.fillMaxWidth().padding(start = 14.dp, top = 4.dp),
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
    val mode = when {
      frame != null && frame.notice != null -> BarMode.NOTICE
      frame != null && frame.candidates.isNotEmpty() -> BarMode.CANDIDATES
      // Letters with nothing to offer yet: no tools in the middle of a word.
      preedit.isNotEmpty() -> BarMode.TYPING
      else -> BarMode.TOOLS
    }
    // The tools rise back in once a word is done; candidates, and anything
    // else a key produces, are there at once. What leaves goes at once too.
    val toolsIn = fadeIn(defaultEffects()) + slideInVertically(defaultSpatial()) { it / 3 }
    AnimatedContent(
      mode,
      Modifier.fillMaxWidth().weight(1f),
      transitionSpec = {
        (if (targetState == BarMode.TOOLS) toolsIn else EnterTransition.None) togetherWith fadeOut(snap())
      },
      label = "bar",
    ) { shown ->
      Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
        when (shown) {
          BarMode.NOTICE -> Text(
            frame?.notice.orEmpty(),
            Modifier.weight(1f).padding(horizontal = 12.dp),
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          BarMode.CANDIDATES -> if (frame != null) Candidates(frame, actions)
          BarMode.TYPING -> Spacer(Modifier.weight(1f))
          BarMode.TOOLS -> BoxWithConstraints(Modifier.weight(1f).fillMaxHeight()) {
            val width = maxWidth
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) { Toolbar(state, actions, width) }
          }
        }
      }
    }
  }
}

private enum class BarMode { NOTICE, CANDIDATES, TYPING, TOOLS }

@Composable
private fun RowScope.Candidates(frame: Frame, actions: KeyboardActions) {
  LazyRow(Modifier.weight(1f).fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
    itemsIndexed(frame.candidates) { index, candidate ->
      val highlighted = index == frame.highlight
      Box(
        Modifier.fillMaxHeight().clickable { actions.onChoose(index) }.padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
      ) {
        Text(
          candidate.text,
          fontSize = 20.sp,
          fontWeight = if (highlighted) FontWeight.SemiBold else FontWeight.Medium,
          color = if (highlighted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
        )
      }
    }
  }
  if (frame.page > 0) BarButton("‹") { actions.onPage(forward = false) }
  if (frame.page + 1 < frame.pageCount) BarButton("›") { actions.onPage(forward = true) }
  // The row scrolls; this opens the lot as a grid, which is where a word
  // twelfth in line is found without swiping for it.
  if (frame.candidates.size > 1) BarButton(R.drawable.ime_expand, "展开候选") { actions.onPanel(Panel.CANDIDATES) }
}

@Composable
internal fun BarButton(label: String, onClick: () -> Unit) {
  Box(
    Modifier.size(44.dp).clickable(onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Text(label, fontSize = 22.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

/** `active` draws it in the accent colour: a switch that is on. */
@Composable
internal fun BarButton(icon: Int, description: String, active: Boolean = false, onClick: () -> Unit) {
  val colors = MaterialTheme.colorScheme
  // Turning on fills it and morphs the circle into a rounded square, the
  // Expressive toggle; the fill fades from its own colour, not from black.
  val fill by animateColorAsState(
    if (active) colors.primaryContainer else colors.primaryContainer.copy(alpha = 0f),
    defaultEffects(),
    label = "toggle fill",
  )
  val tint by animateColorAsState(
    if (active) colors.onPrimaryContainer else colors.onSurfaceVariant,
    defaultEffects(),
    label = "toggle ink",
  )
  val corner by animateDpAsState(if (active) 12.dp else 18.dp, defaultSpatial(), label = "toggle corner")
  Box(
    Modifier.size(44.dp).clickable(onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Box(
      Modifier.size(36.dp).background(fill, RoundedCornerShape(corner)),
      contentAlignment = Alignment.Center,
    ) {
      Icon(
        painterResource(icon),
        contentDescription = description,
        Modifier.size(22.dp),
        tint = tint,
      )
    }
  }
}

@Composable
private fun RowScope.Key(spec: KeySpec, state: KeyboardState, actions: KeyboardActions, viewWidth: Float) {
  if (spec.action == KeyAction.Spacer) {
    Spacer(Modifier.weight(spec.width))
    return
  }
  val view = LocalView.current
  val density = LocalDensity.current
  var pressed by remember { mutableStateOf(false) }
  var bounds by remember { mutableStateOf(Rect.Zero) }
  val latestSpec by rememberUpdatedState(spec)
  val latestWidth by rememberUpdatedState(viewWidth)
  val itemWidth = with(density) { 44.dp.toPx() }
  val itemHeight = with(density) { 48.dp.toPx() }
  val role = roleOf(spec, state)
  val colors = MaterialTheme.colorScheme
  val (fill, ink) = when (role) {
    Role.CHARACTER -> colors.surfaceBright to colors.onSurface
    Role.TONE -> colors.tertiaryContainer to colors.onTertiaryContainer
    Role.FUNCTION -> colors.secondaryContainer to colors.onSecondaryContainer
    Role.ACTION -> colors.primary to colors.onPrimary
  }
  Box(
    Modifier
      .weight(spec.width)
      .fillMaxHeight()
      .padding(horizontal = 2.5.dp, vertical = 3.dp)
      .onGloballyPositioned { bounds = it.boundsInRoot() }
      .pointerInput(spec.action) {
        awaitEachGesture {
          val down = awaitFirstDown(requireUnconsumed = false)
          down.consume()
          pressed = true
          tap(view)
          val current = latestSpec
          val shown = previewOf(current, state, bounds)
          state.preview = shown
          try {
            if (current.action == KeyAction.Backspace) {
              repeatWhileHeld(down.id) { actions.onKey(KeyAction.Backspace) }
              return@awaitEachGesture
            }
            val released = withTimeoutOrNull(LONG_PRESS_MS) { awaitRelease(down.id) }
            if (released != null) {
              if (released == Release.UP) actions.onKey(current.action)
              return@awaitEachGesture
            }
            // Held.
            if (current.action == KeyAction.Globe) {
              actions.onPicker()
              awaitRelease(down.id)
              return@awaitEachGesture
            }
            val items = menuOf(current, state)
            if (items.isEmpty()) {
              if (awaitRelease(down.id) == Release.UP) actions.onKey(current.action)
              return@awaitEachGesture
            }
            if (state.preview === shown) state.preview = null
            val geometry = MenuGeometry.of(
              items.size, bounds.left, bounds.right, bounds.top, itemWidth, itemHeight, latestWidth,
            )
            state.menu = OpenMenu(items, geometry, highlight = 0)
            tap(view)
            while (true) {
              val event = awaitPointerEvent()
              val change = event.changes.firstOrNull { it.id == down.id } ?: break
              change.consume()
              val x = bounds.left + change.position.x
              val y = bounds.top + change.position.y
              val index = geometry.indexAt(x, y, bounds.bottom)
              if (change.changedToUpIgnoreConsumed()) {
                if (index >= 0) actions.onKey(items[index])
                break
              }
              if (index != state.menu?.highlight) {
                state.menu = state.menu?.copy(highlight = index)
                if (index >= 0) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
              }
            }
          } finally {
            state.menu = null
            if (state.preview === shown) state.preview = null
            pressed = false
          }
        }
      },
  ) {
    val (color, corner) = keyLook(pressed, fill, ink)
    Surface(
      Modifier.fillMaxSize(),
      shape = RoundedCornerShape(corner),
      color = color,
      contentColor = ink,
      shadowElevation = if (role == Role.CHARACTER) 1.dp else 0.dp,
    ) {
      Box(contentAlignment = Alignment.Center) {
        // What a key says can change under it (Shift, caps lock, 中/英, 无痕):
        // the old face fades into the new one.
        val icon = iconOf(spec.action, state)
        val face = if (icon != null) KeyFace.Icon(icon) else KeyFace.Label(spec.label ?: labelOf(spec.action, state))
        Crossfade(face, animationSpec = fastEffects(), label = "key face") { shown ->
          when (shown) {
            is KeyFace.Icon -> Icon(
              painterResource(shown.id),
              contentDescription = labelOf(spec.action, state),
              Modifier.size(24.dp),
              tint = ink,
            )
            is KeyFace.Label -> Text(
              shown.text,
              fontSize = if (shown.text.length > 2) 15.sp else if (shown.text.length == 2) 19.sp else 22.sp,
              textAlign = TextAlign.Center,
            )
          }
        }
        hintOf(spec, state)?.let { hint ->
          Text(
            hint,
            Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 5.dp),
            fontSize = 10.sp,
            color = ink.copy(alpha = 0.55f),
          )
        }
      }
    }
  }
}

private sealed interface KeyFace {
  data class Icon(val id: Int) : KeyFace
  data class Label(val text: String) : KeyFace
}

/**
 * What a press shows above the key: only for keys that type, whose label a
 * finger covers. A function key, a space and an icon say nothing a preview
 * would add.
 */
private fun previewOf(spec: KeySpec, state: KeyboardState, bounds: Rect): KeyPreview? {
  val role = roleOf(spec, state)
  if (role != Role.CHARACTER && role != Role.TONE) return null
  if (spec.action == KeyAction.Space || iconOf(spec.action, state) != null) return null
  val label = spec.label ?: labelOf(spec.action, state)
  if (label.isEmpty()) return null
  return KeyPreview(label, bounds.left, bounds.right, bounds.top)
}

@Composable
private fun PreviewOverlay(preview: KeyPreview) {
  val density = LocalDensity.current
  val width = with(density) { (preview.right - preview.left).toDp() } + 12.dp
  val height = 64.dp
  val left = preview.left - with(density) { 6.dp.toPx() }
  // Resting on the key's upper half, so it reads as the key lifted.
  val top = preview.top - with(density) { (height - 20.dp).toPx() }
  // Lifts out of the key: grows up from where the key is. It goes at once on
  // release — a fading preview trails behind fast typing.
  val appear = rememberAppear(preview)
  Surface(
    Modifier
      .offset { IntOffset(left.toInt(), top.toInt()) }
      .size(width, height)
      .popIn(appear, TransformOrigin(0.5f, 1f), from = 0.7f),
    shape = RoundedCornerShape(12.dp),
    color = MaterialTheme.colorScheme.surfaceContainerHighest,
    shadowElevation = 6.dp,
  ) {
    Box(Modifier.padding(bottom = 18.dp), contentAlignment = Alignment.Center) {
      Text(preview.label, fontSize = if (preview.label.length > 2) 20.sp else 28.sp)
    }
  }
}

@Composable
private fun MenuOverlay(menu: OpenMenu, state: KeyboardState) {
  val density = LocalDensity.current
  val g = menu.geometry
  val colors = MaterialTheme.colorScheme
  val top = g.bottom - g.rows * g.itemHeight
  val itemSize = Modifier.size(with(density) { g.itemWidth.toDp() }, with(density) { g.itemHeight.toDp() })
  // Fades in without growing: which item the finger picks is decided against
  // where the items finally sit (MenuGeometry.indexAt), so they are drawn
  // there from the first frame — scaled in, the item under the finger for
  // the first few frames was not the one a release would type.
  val appear = rememberAppear(Unit)
  // One highlight, springing from item to item under the finger rather than
  // jumping; it fades when the finger backs out below the key.
  val highlighted = menu.highlight
  val pill by animateOffsetAsState(
    Offset(g.itemLeft(highlighted.coerceAtLeast(0)) - g.left, g.itemTop(highlighted.coerceAtLeast(0)) - top),
    fastSpatial(),
    label = "menu highlight",
  )
  val pillAlpha by animateFloatAsState(if (highlighted >= 0) 1f else 0f, fastEffects(), label = "menu highlight alpha")
  Surface(
    Modifier
      .offset { IntOffset(g.left.toInt(), top.toInt()) }
      .size(with(density) { (g.columns * g.itemWidth).toDp() }, with(density) { (g.rows * g.itemHeight).toDp() })
      .popIn(appear, TransformOrigin.Center, from = 1f),
    shape = RoundedCornerShape(14.dp),
    color = colors.surfaceContainerHighest,
    shadowElevation = 6.dp,
  ) {
    Box {
      Box(
        Modifier
          .offset { IntOffset(pill.x.toInt(), pill.y.toInt()) }
          .then(itemSize)
          .padding(3.dp)
          .graphicsLayer { alpha = pillAlpha }
          .background(colors.primary, RoundedCornerShape(10.dp)),
      )
      menu.items.forEachIndexed { index, item ->
        val x = g.itemLeft(index) - g.left
        val y = g.itemTop(index) - top
        val ink by animateColorAsState(
          if (index == highlighted) colors.onPrimary else colors.onSurface,
          fastEffects(),
          label = "menu item",
        )
        Box(
          Modifier.offset { IntOffset(x.toInt(), y.toInt()) }.then(itemSize),
          contentAlignment = Alignment.Center,
        ) {
          val label = labelOf(item, state)
          Text(label, fontSize = if (label.length > 2) 13.sp else 18.sp, color = ink)
        }
      }
    }
  }
}

internal fun lerpColor(a: Color, b: Color, t: Float) = Color(
  red = a.red + (b.red - a.red) * t,
  green = a.green + (b.green - a.green) * t,
  blue = a.blue + (b.blue - a.blue) * t,
  alpha = a.alpha,
)

internal fun tap(view: View) {
  view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
}

internal enum class Release { UP, GONE }

/** Waits for this pointer to lift, or to vanish (cancelled, another gesture took it). */
internal suspend fun AwaitPointerEventScope.awaitRelease(id: PointerId): Release {
  while (true) {
    val event = awaitPointerEvent()
    val change = event.changes.firstOrNull { it.id == id } ?: return Release.GONE
    if (change.changedToUpIgnoreConsumed()) return Release.UP
  }
}

/** Runs `action` now, again after a pause, then steadily until the finger lifts. */
internal suspend fun AwaitPointerEventScope.repeatWhileHeld(id: PointerId, action: () -> Unit) {
  action()
  var wait = REPEAT_DELAY_MS
  while (true) {
    if (withTimeoutOrNull(wait) { awaitRelease(id) } != null) return
    action()
    wait = REPEAT_EVERY_MS
  }
}
