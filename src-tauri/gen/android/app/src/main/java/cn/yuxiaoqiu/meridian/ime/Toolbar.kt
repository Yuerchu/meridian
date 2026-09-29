package cn.yuxiaoqiu.meridian.ime

import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.scale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import cn.yuxiaoqiu.meridian.R

/**
 * What the candidate bar shows when there is nothing to choose: the tools on
 * the left, what was just copied in the middle, settings and hide on the
 * right. Anything typed replaces it with candidates, so it costs no room.
 */
@Composable
internal fun RowScope.Toolbar(state: KeyboardState, actions: KeyboardActions) {
  // An autofill service offering an account or a code for this field takes
  // the whole bar: it is what the field is for, and the tools can wait.
  if (state.inline.isNotEmpty()) {
    InlineSuggestions(state.inline)
    BarButton(R.drawable.ime_hide, "收起键盘") { actions.onHide() }
    return
  }
  BarButton(R.drawable.ime_edit, "编辑") { actions.onPanel(Panel.EDIT) }
  BarButton(R.drawable.ime_clipboard, "剪贴板") { actions.onPanel(Panel.CLIPBOARD) }
  BarButton(R.drawable.ime_symbols, "符号") { actions.onPanel(Panel.SYMBOLS) }
  BarButton(R.drawable.ime_incognito, if (state.incognito) "关闭无痕" else "无痕", active = state.incognito) {
    actions.onIncognito()
  }
  val code = state.code
  val chip = state.chip
  Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
    when {
      code != null -> PasteChip(code, label = "验证码", accent = true) { actions.onPasteClip(code) }
      chip != null -> PasteChip(chip, label = "粘贴", accent = false) { actions.onPasteClip(chip) }
    }
  }
  BarButton(R.drawable.ime_settings, "输入法设置") { actions.onOpenSettings() }
  BarButton(R.drawable.ime_hide, "收起键盘") { actions.onHide() }
}

/** `accent` for a code: the one thing on the bar the field is waiting for. */
@Composable
private fun PasteChip(clip: Clip, label: String, accent: Boolean, onPaste: () -> Unit) {
  val colors = MaterialTheme.colorScheme
  val fill = if (accent) colors.primaryContainer else colors.secondaryContainer
  val ink = if (accent) colors.onPrimaryContainer else colors.onSecondaryContainer
  Surface(
    Modifier.padding(horizontal = 4.dp).height(32.dp).clickable(onClick = onPaste),
    shape = RoundedCornerShape(16.dp),
    color = fill,
    contentColor = ink,
  ) {
    Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
      Text("$label  ", fontSize = 13.sp, color = ink.copy(alpha = 0.7f))
      Text(oneLine(clip.text), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
  }
}

/**
 * The autofill service's own views, side by side. They are laid out, not
 * drawn: each is a surface the service renders into, and moving one to
 * another parent is how Compose re-hosts it when the list changes.
 */
@Composable
private fun RowScope.InlineSuggestions(views: List<View>) {
  Row(
    Modifier.weight(1f).fillMaxHeight().horizontalScroll(rememberScrollState()).padding(start = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    for (view in views) {
      key(view) {
        AndroidView(factory = {
          (view.parent as? ViewGroup)?.removeView(view)
          view
        })
      }
    }
  }
}

/** The bar over an open panel: back to the keys, its name, its own controls. */
@Composable
internal fun PanelBar(panel: Panel, state: KeyboardState, actions: KeyboardActions) {
  if (panel == Panel.CANDIDATES) {
    CandidateGridBar(state, actions)
    return
  }
  Row(Modifier.fillMaxWidth().height(BAR_HEIGHT), verticalAlignment = Alignment.CenterVertically) {
    BarButton(R.drawable.ime_keyboard, "返回键盘") { actions.onPanel(null) }
    Text(
      when (panel) {
        Panel.EDIT -> "编辑"
        Panel.CLIPBOARD -> "剪贴板"
        else -> "符号"
      },
      Modifier.weight(1f).padding(horizontal = 4.dp),
      fontSize = 15.sp,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (panel == Panel.CLIPBOARD) {
      RecordingToggle(state.recording) { actions.onRecording(!state.recording) }
      BarButton(R.drawable.ime_bin, "清空未固定的") { actions.onClearClips() }
    }
    BarButton(R.drawable.ime_hide, "收起键盘") { actions.onHide() }
  }
}

@Composable
private fun RecordingToggle(on: Boolean, onToggle: () -> Unit) {
  val colors = MaterialTheme.colorScheme
  Surface(
    Modifier.height(32.dp).clickable(onClick = onToggle),
    shape = RoundedCornerShape(16.dp),
    color = if (on) colors.primaryContainer else colors.surfaceContainerHighest,
    contentColor = if (on) colors.onPrimaryContainer else colors.onSurfaceVariant,
  ) {
    Box(Modifier.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
      Text(if (on) "记录中" else "已暂停", fontSize = 13.sp)
    }
  }
}

/**
 * Moving the cursor and the selection without aiming a finger at text. The
 * arrows and Backspace repeat while held; with 选择 on they extend the
 * selection instead of moving the cursor.
 */
@Composable
internal fun EditPanel(state: KeyboardState, actions: KeyboardActions) {
  Column(Modifier.fillMaxSize().padding(horizontal = 3.dp, vertical = 2.dp)) {
    PanelRow {
      PanelKey(Modifier.weight(1f), icon = R.drawable.ime_line_end, label = "行首", mirrored = true) { actions.onEdit(EditAction.HOME) }
      PanelKey(Modifier.weight(1f), icon = R.drawable.ime_arrow_up, label = "上", repeat = true) { actions.onEdit(EditAction.UP) }
      PanelKey(Modifier.weight(1f), icon = R.drawable.ime_line_end, label = "行尾") { actions.onEdit(EditAction.END) }
      PanelKey(Modifier.weight(1f), label = "全选") { actions.onEdit(EditAction.SELECT_ALL) }
    }
    PanelRow {
      PanelKey(Modifier.weight(1f), icon = R.drawable.ime_arrow_left, label = "左", repeat = true) { actions.onEdit(EditAction.LEFT) }
      PanelKey(Modifier.weight(1f), label = "选择", active = state.selecting) { actions.onEdit(EditAction.SELECT) }
      PanelKey(Modifier.weight(1f), icon = R.drawable.ime_arrow_right, label = "右", repeat = true) { actions.onEdit(EditAction.RIGHT) }
      PanelKey(Modifier.weight(1f), label = "复制") { actions.onEdit(EditAction.COPY) }
    }
    PanelRow {
      PanelKey(Modifier.weight(1f), icon = R.drawable.ime_undo, label = "撤销") { actions.onEdit(EditAction.UNDO) }
      PanelKey(Modifier.weight(1f), icon = R.drawable.ime_arrow_down, label = "下", repeat = true) { actions.onEdit(EditAction.DOWN) }
      PanelKey(Modifier.weight(1f), icon = R.drawable.ime_redo, label = "重做") { actions.onEdit(EditAction.REDO) }
      PanelKey(Modifier.weight(1f), label = "剪切") { actions.onEdit(EditAction.CUT) }
    }
    PanelRow {
      PanelKey(Modifier.weight(3f), icon = R.drawable.ime_backspace, label = "删除", repeat = true) {
        actions.onEdit(EditAction.BACKSPACE)
      }
      PanelKey(Modifier.weight(1f), label = "粘贴", action = true) { actions.onEdit(EditAction.PASTE) }
    }
  }
}

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.PanelRow(content: @Composable RowScope.() -> Unit) {
  Row(Modifier.fillMaxWidth().weight(1f), content = content)
}

/**
 * A key of a panel. Drawn like the keyboard's function keys; `active` is a
 * switch that is on, `action` the accent key. `icon` keys are named by
 * `label` for a screen reader.
 */
@Composable
private fun PanelKey(
  modifier: Modifier,
  label: String,
  icon: Int? = null,
  mirrored: Boolean = false,
  repeat: Boolean = false,
  active: Boolean = false,
  action: Boolean = false,
  onPress: () -> Unit,
) {
  val view = LocalView.current
  val colors = MaterialTheme.colorScheme
  var pressed by remember { mutableStateOf(false) }
  val latest by rememberUpdatedState(onPress)
  val (fill, ink) = when {
    action -> colors.primary to colors.onPrimary
    active -> colors.primaryContainer to colors.onPrimaryContainer
    else -> colors.secondaryContainer to colors.onSecondaryContainer
  }
  Box(
    modifier
      .fillMaxHeight()
      .padding(horizontal = 2.5.dp, vertical = 3.dp)
      .pointerInput(repeat) {
        awaitEachGesture {
          val down = awaitFirstDown(requireUnconsumed = false)
          down.consume()
          pressed = true
          tap(view)
          try {
            if (repeat) repeatWhileHeld(down.id) { latest() } else if (awaitRelease(down.id) == Release.UP) latest()
          } finally {
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
    ) {
      Box(contentAlignment = Alignment.Center) {
        if (icon != null) {
          Icon(
            painterResource(icon),
            contentDescription = label,
            Modifier.size(24.dp).scale(scaleX = if (mirrored) -1f else 1f, scaleY = 1f),
            tint = ink,
          )
        } else {
          Text(label, fontSize = 16.sp, textAlign = TextAlign.Center)
        }
      }
    }
  }
}

/**
 * What has been copied, pinned first. A tap pastes; the two buttons on each
 * row pin (kept past the hour, and past a restart) and forget.
 */
@Composable
internal fun ClipboardPanel(state: KeyboardState, actions: KeyboardActions) {
  val colors = MaterialTheme.colorScheme
  if (state.clips.isEmpty()) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
      Text(
        if (state.recording) {
          "复制的内容会出现在这里。\n未固定的一小时后清除；密码等敏感内容、隐私输入框和无痕时复制的不会记录。"
        } else {
          "剪贴板记录已暂停。点上方的「已暂停」重新开始。"
        },
        fontSize = 14.sp,
        textAlign = TextAlign.Center,
        color = colors.onSurfaceVariant,
      )
    }
    return
  }
  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 4.dp),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    items(state.clips, key = { it.text }) { clip ->
      Surface(
        Modifier.fillMaxWidth().clickable { actions.onPasteClip(clip) },
        shape = RoundedCornerShape(12.dp),
        color = colors.surfaceBright,
        contentColor = colors.onSurface,
      ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(
            clip.text,
            Modifier.weight(1f).padding(start = 12.dp, top = 10.dp, bottom = 10.dp),
            fontSize = 15.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
          )
          BarButton(R.drawable.ime_pin, if (clip.pinned) "取消固定" else "固定", active = clip.pinned) {
            actions.onPinClip(clip, !clip.pinned)
          }
          BarButton(R.drawable.ime_close, "删除") { actions.onRemoveClip(clip) }
          Spacer(Modifier.size(2.dp))
        }
      }
    }
  }
}


/**
 * Over the candidate grid: what is being typed, where the row's candidates
 * would be, and the way back to the keys (the composition stays).
 */
@Composable
private fun CandidateGridBar(state: KeyboardState, actions: KeyboardActions) {
  val frame = state.frame
  Row(Modifier.fillMaxWidth().height(BAR_HEIGHT), verticalAlignment = Alignment.CenterVertically) {
    Text(
      frame?.preeditText.orEmpty(),
      Modifier.weight(1f).padding(horizontal = 14.dp),
      fontSize = 15.sp,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
    if (frame != null && frame.page > 0) BarButton("‹") { actions.onPage(forward = false) }
    if (frame != null && frame.page + 1 < frame.pageCount) BarButton("›") { actions.onPage(forward = true) }
    BarButton(R.drawable.ime_collapse, "收起候选") { actions.onPanel(null) }
  }
}

/** Candidates per row of the grid; a word takes a cell per two characters. */
private const val GRID_COLUMNS = 6

/**
 * Every candidate of the frame, in order, a tap choosing one. A choice that
 * leaves keys still to choose keeps the grid open on what is left; the
 * service closes it once there is nothing more to choose.
 */
@Composable
internal fun CandidateGrid(state: KeyboardState, actions: KeyboardActions) {
  val frame = state.frame ?: return
  val colors = MaterialTheme.colorScheme
  LazyVerticalGrid(
    GridCells.Fixed(GRID_COLUMNS),
    Modifier.fillMaxSize().padding(horizontal = 3.dp),
  ) {
    itemsIndexed(
      frame.candidates,
      span = { _, c -> GridItemSpan(((c.text.length + 1) / 2).coerceIn(1, maxLineSpan)) },
    ) { index, candidate ->
      val highlighted = index == frame.highlight
      Box(
        Modifier.height(52.dp).clickable { actions.onChoose(index) },
        contentAlignment = Alignment.Center,
      ) {
        Text(
          candidate.text,
          fontSize = 20.sp,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          color = if (highlighted) colors.primary else colors.onSurface,
        )
      }
    }
  }
}

/**
 * Symbols by page, a tap inserting one as written. The panel stays open, since
 * a symbol rarely comes alone; the keyboard button goes back.
 */
@Composable
internal fun SymbolsPanel(actions: KeyboardActions) {
  var page by remember { mutableStateOf(0) }
  val colors = MaterialTheme.colorScheme
  val current = SYMBOL_PAGES[page]
  Column(Modifier.fillMaxSize()) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 4.dp)) {
      SYMBOL_PAGES.forEachIndexed { i, p ->
        val selected = i == page
        Surface(
          Modifier.padding(end = 6.dp).height(32.dp).clickable { page = i },
          shape = RoundedCornerShape(16.dp),
          color = if (selected) colors.primaryContainer else Color.Transparent,
          contentColor = if (selected) colors.onPrimaryContainer else colors.onSurfaceVariant,
        ) {
          Box(Modifier.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
            Text(p.name, fontSize = 14.sp)
          }
        }
      }
    }
    LazyVerticalGrid(
      if (current.wide) GridCells.Adaptive(112.dp) else GridCells.Adaptive(48.dp),
      Modifier.fillMaxWidth().weight(1f).padding(horizontal = 3.dp),
    ) {
      items(current.items) { symbol ->
        Box(
          Modifier.height(48.dp).clickable { actions.onKey(KeyAction.Text(symbol)) },
          contentAlignment = Alignment.Center,
        ) {
          Text(symbol, fontSize = if (current.wide) 15.sp else 20.sp, maxLines = 1, color = colors.onSurface)
        }
      }
    }
  }
}
