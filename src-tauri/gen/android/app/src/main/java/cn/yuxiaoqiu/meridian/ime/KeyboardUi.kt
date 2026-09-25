package cn.yuxiaoqiu.meridian.ime

import android.content.res.Configuration
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
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
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.yuxiaoqiu.meridian.R

/** What the keyboard draws; written by the service, read by Compose. */
@Stable
class KeyboardState {
  var frame by mutableStateOf<Frame?>(null)
  var layer by mutableStateOf(Layer.GRID)
  /** The letter layer the number layer returns to. */
  var lettersLayer by mutableStateOf(Layer.GRID)
  var mode by mutableStateOf(InputMode.CHINESE)
  var shifted by mutableStateOf(false)
  var tokens by mutableStateOf<Map<String, GridToken>>(emptyMap())
  var enterAction by mutableStateOf<Int?>(null)
  var menu by mutableStateOf<OpenMenu?>(null)
  /** MiSans once the app has written it out; null is the system font. */
  var font by mutableStateOf<androidx.compose.ui.text.font.FontFamily?>(null)
}

/** A long-press menu on screen, with the item the finger is over. */
data class OpenMenu(val items: List<KeyAction>, val geometry: MenuGeometry, val highlight: Int)

interface KeyboardActions {
  fun onKey(action: KeyAction)
  fun onChoose(index: Int)
  fun onPage(forward: Boolean)
  fun onHide()
  /** Globe held: the system's list of keyboards. */
  fun onPicker()
}

private const val FULL_ROWS = 5
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
  is KeyAction.Letter -> if (state.shifted) action.ch.uppercase() else action.ch.toString()
  is KeyAction.Text -> action.text
  is KeyAction.Punct -> when {
    state.mode == InputMode.ENGLISH -> action.ch.toString()
    action.ch == ',' -> "，"
    else -> "。"
  }
  KeyAction.Backspace -> "⌫"
  KeyAction.Space -> "空格"
  KeyAction.Enter -> enterLabel(state.enterAction)
  KeyAction.Shift -> "⇧"
  KeyAction.ToggleMode -> if (state.mode == InputMode.CHINESE) "中" else "英"
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
  KeyAction.Shift -> R.drawable.ime_shift
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
  KeyAction.Shift -> if (state.shifted) Role.ACTION else Role.FUNCTION
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
    Column(Modifier.fillMaxWidth().padding(horizontal = 3.dp, vertical = 2.dp)) {
      CandidateBar(state, actions)
      for (row in layerRows) {
        Row(Modifier.fillMaxWidth().height(rowHeight)) {
          for (spec in row) Key(spec, state, actions, viewWidth)
        }
      }
    }
    state.menu?.let { MenuOverlay(it, state) }
  }
  }
}

@Composable
private fun CandidateBar(state: KeyboardState, actions: KeyboardActions) {
  val frame = state.frame
  Row(
    Modifier.fillMaxWidth().height(44.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    when {
      frame != null && frame.notice != null -> Text(
        frame.notice,
        Modifier.weight(1f).padding(horizontal = 12.dp),
        fontSize = 14.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      frame != null && frame.candidates.isNotEmpty() -> {
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
      }
      else -> {
        Spacer(Modifier.weight(1f))
        BarButton(R.drawable.ime_hide, "收起键盘") { actions.onHide() }
      }
    }
  }
}

@Composable
private fun BarButton(label: String, onClick: () -> Unit) {
  Box(
    Modifier.size(44.dp).clickable(onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Text(label, fontSize = 22.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun BarButton(icon: Int, description: String, onClick: () -> Unit) {
  Box(
    Modifier.size(44.dp).clickable(onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Icon(painterResource(icon), contentDescription = description, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
            pressed = false
          }
        }
      },
  ) {
    Surface(
      Modifier.fillMaxSize(),
      shape = RoundedCornerShape(10.dp),
      color = if (pressed) lerpColor(fill, ink, 0.18f) else fill,
      contentColor = ink,
      shadowElevation = if (role == Role.CHARACTER) 1.dp else 0.dp,
    ) {
      Box(contentAlignment = Alignment.Center) {
        val icon = iconOf(spec.action, state)
        if (icon != null) {
          Icon(painterResource(icon), contentDescription = labelOf(spec.action, state), Modifier.size(24.dp), tint = ink)
        } else {
          val label = spec.label ?: labelOf(spec.action, state)
          Text(
            label,
            fontSize = if (label.length > 2) 15.sp else if (label.length == 2) 19.sp else 22.sp,
            textAlign = TextAlign.Center,
          )
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

@Composable
private fun MenuOverlay(menu: OpenMenu, state: KeyboardState) {
  val density = LocalDensity.current
  val g = menu.geometry
  val colors = MaterialTheme.colorScheme
  val top = g.bottom - g.rows * g.itemHeight
  Surface(
    Modifier
      .offset { IntOffset(g.left.toInt(), top.toInt()) }
      .size(with(density) { (g.columns * g.itemWidth).toDp() }, with(density) { (g.rows * g.itemHeight).toDp() }),
    shape = RoundedCornerShape(14.dp),
    color = colors.surfaceContainerHighest,
    shadowElevation = 6.dp,
  ) {
    Box {
      menu.items.forEachIndexed { index, item ->
        val x = g.itemLeft(index) - g.left
        val y = g.itemTop(index) - top
        val highlighted = index == menu.highlight
        Box(
          Modifier
            .offset { IntOffset(x.toInt(), y.toInt()) }
            .size(with(density) { g.itemWidth.toDp() }, with(density) { g.itemHeight.toDp() })
            .padding(3.dp)
            .background(if (highlighted) colors.primary else Color.Transparent, RoundedCornerShape(10.dp)),
          contentAlignment = Alignment.Center,
        ) {
          val label = labelOf(item, state)
          Text(
            label,
            fontSize = if (label.length > 2) 13.sp else 18.sp,
            color = if (highlighted) colors.onPrimary else colors.onSurface,
          )
        }
      }
    }
  }
}

private fun lerpColor(a: Color, b: Color, t: Float) = Color(
  red = a.red + (b.red - a.red) * t,
  green = a.green + (b.green - a.green) * t,
  blue = a.blue + (b.blue - a.blue) * t,
  alpha = a.alpha,
)

private fun tap(view: View) {
  view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
}

private enum class Release { UP, GONE }

/** Waits for this pointer to lift, or to vanish (cancelled, another gesture took it). */
private suspend fun AwaitPointerEventScope.awaitRelease(id: PointerId): Release {
  while (true) {
    val event = awaitPointerEvent()
    val change = event.changes.firstOrNull { it.id == id } ?: return Release.GONE
    if (change.changedToUpIgnoreConsumed()) return Release.UP
  }
}

/** Runs `action` now, again after a pause, then steadily until the finger lifts. */
private suspend fun AwaitPointerEventScope.repeatWhileHeld(id: PointerId, action: () -> Unit) {
  action()
  var wait = REPEAT_DELAY_MS
  while (true) {
    if (withTimeoutOrNull(wait) { awaitRelease(id) } != null) return
    action()
    wait = REPEAT_EVERY_MS
  }
}
