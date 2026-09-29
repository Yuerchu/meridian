package cn.yuxiaoqiu.meridian.ime

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Size
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InlineSuggestionsRequest
import android.view.inputmethod.InlineSuggestionsResponse
import android.view.inputmethod.InputMethodManager
import android.widget.inline.InlinePresentationSpec
import androidx.annotation.RequiresApi
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi
import androidx.compose.ui.platform.ComposeView
import cn.yuxiaoqiu.meridian.EXTRA_OPEN_SETTINGS
import java.io.File

/**
 * Meridian's keyboard. Runs in its own process (`:ime`), with the engine in
 * that process through `libmeridian_ime.so`; nothing here talks to the app.
 * What Meridian changes — settings, dictionaries, a model, memory hints — it
 * writes under `dataDir/ime`, and the engine picks it up when the keyboard
 * comes up (the same directory Tauri calls `app_data_dir`).
 *
 * Two ways in. The touch keyboard ([KeyboardScreen]) draws its own candidate
 * bar; a hardware keyboard has no input view, so its candidates go in the
 * system's candidates area ([CandidateStrip]).
 */
class MeridianInputMethodService : InputMethodService(), KeyboardActions {
  private lateinit var engine: Engine
  private val main = Handler(Looper.getMainLooper())
  private val applier = OutcomeApplier(InputConnectionTarget { currentInputConnection })
  private val lifecycle = ImeLifecycle()
  private val keyboard = KeyboardState()
  private var strip: CandidateStrip? = null

  private var enterAction: Int? = null
  private var privateField = false
  private var fieldPackage: String? = null
  private lateinit var clipboard: ClipboardHistory
  private val clipboardManager by lazy { getSystemService(CLIPBOARD_SERVICE) as ClipboardManager }
  private val onClipChanged = ClipboardManager.OnPrimaryClipChangedListener { captureClip(live = true) }
  private val refreshChip = Runnable { showClips() }
  /**
   * Set when a letter is sent while not yet composing, until its answer
   * arrives: a Backspace typed in that gap belongs to the composition, not to
   * the document, and `onKeyDown` has to decide that before the engine has.
   */
  private var composingPredicted = false
  private val eaten = mutableSetOf<Int>()
  private var shiftAlone = false
  /** A prediction list is on screen, per the last frame drawn. */
  private var predicting = false
  /**
   * Where the caret was when the list was offered. [PENDING] until the
   * field reports the caret after the commit that brought the list up —
   * that report is the commit's own echo, not somebody moving the caret.
   */
  private var predictionAt = NOWHERE

  private val readSurrounding = Runnable { reportSurrounding() }

  override fun onCreate() {
    super.onCreate()
    lifecycle.create()
    engine = Engine(File(dataDir, "ime"))
    keyboard.incognito = prefs().getBoolean(PREF_INCOGNITO, false)
    keyboard.recording = prefs().getBoolean(PREF_RECORDING, true)
    clipboard = ClipboardHistory(File(dataDir, "ime/clipboard.json"))
    clipboardManager.addPrimaryClipChangedListener(onClipChanged)
    val saved = prefs().getString(PREF_LETTERS, null)?.let { runCatching { Layer.valueOf(it) }.getOrNull() }
    keyboard.lettersLayer = saved ?: Layer.GRID
    keyboard.layer = keyboard.lettersLayer
    engine.gridTokens { tokens ->
      if (tokens != null) {
        keyboard.tokens = tokens.associateBy { it.name }
      } else if (keyboard.lettersLayer == Layer.GRID) {
        // No engine, no grid: the grid's keys mean nothing without it.
        keyboard.lettersLayer = Layer.QWERTY
        keyboard.layer = Layer.QWERTY
      }
    }
  }

  override fun onDestroy() {
    clipboardManager.removePrimaryClipChangedListener(onClipChanged)
    main.removeCallbacks(readSurrounding)
    main.removeCallbacks(refreshChip)
    engine.close()
    lifecycle.destroy()
    super.onDestroy()
  }

  private fun prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  override fun onEvaluateFullscreenMode(): Boolean = false

  override fun onCreateInputView(): View {
    val decor = window.window?.decorView
    val view = ComposeView(this).apply {
      setContent { ImeTheme { KeyboardScreen(keyboard, this@MeridianInputMethodService) } }
    }
    lifecycle.attach(*listOfNotNull(decor, view).toTypedArray())
    return view
  }

  override fun onCreateCandidatesView(): View =
    CandidateStrip(this) { index -> onChoose(index) }.also { strip = it }

  /**
   * A field gained focus, or restarted input (`restarting`: the same field,
   * whose attributes may have changed — a password shown in clear, say — and
   * whose text changed underneath any composition). Both decide privacy
   * afresh and drop the composition.
   */
  override fun onStartInput(attribute: EditorInfo, restarting: Boolean) {
    super.onStartInput(attribute, restarting)
    privateField = isPrivateField(attribute.inputType, attribute.imeOptions)
    fieldPackage = attribute.packageName
    enterAction = enterActionFor(attribute.imeOptions)
    keyboard.enterAction = enterAction
    applier.forget()
    composingPredicted = false
    eaten.clear()
    engine.refresh()
    // A physical keyboard types pinyin whatever the touch layer: it cannot
    // produce the grid's keys.
    val hardware = resources.configuration.keyboard == Configuration.KEYBOARD_QWERTY
    engine.setScheme(if (hardware) "pinyin" else schemeOf(keyboard.lettersLayer))
    engine.startInput(attribute.packageName, learningOff) { frame -> frame?.let(::render) }
  }

  /** Nothing typed here is learned, read around or remembered. */
  private val learningOff get() = privateField || keyboard.incognito

  override fun onStartInputView(info: EditorInfo, restarting: Boolean) {
    super.onStartInputView(info, restarting)
    lifecycle.shown()
    // Written by the app the first time it runs, possibly after the keyboard started.
    if (keyboard.font == null) keyboard.font = keyboardFont(dataDir)
    keyboard.shifted = false
    keyboard.panel = null
    keyboard.selecting = false
    engine.setScheme(schemeOf(keyboard.lettersLayer))
    // Copied while this process was not running — a vendor that kills
    // keyboards in the background (MIUI) makes that the ordinary case.
    captureClip(live = false)
    showClips()
  }

  override fun onFinishInputView(finishingInput: Boolean) {
    keyboard.menu = null
    lifecycle.hidden()
    super.onFinishInputView(finishingInput)
  }

  override fun onFinishInput() {
    // What an autofill service offered was for that field.
    inlineGeneration += 1
    keyboard.inline = emptyList()
    main.removeCallbacks(readSurrounding)
    engine.reset()
    applier.forget()
    composingPredicted = false
    render(null)
    super.onFinishInput()
  }

  /**
   * The keyboard came up. This is where changes Meridian made on disk are
   * picked up, not only in onStartInput: hiding the keyboard and bringing it
   * back on the same field calls onWindowShown and never onStartInput
   * (measured on Android 14), so a setting changed in between — a private app
   * added — would otherwise wait until focus moved to another field.
   */
  override fun onWindowShown() {
    super.onWindowShown()
    engine.refresh()
  }

  override fun onWindowHidden() {
    engine.flush()
    super.onWindowHidden()
  }

  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    engine.flush()
  }

  override fun onUpdateSelection(
    oldSelStart: Int,
    oldSelEnd: Int,
    newSelStart: Int,
    newSelEnd: Int,
    candidatesStart: Int,
    candidatesEnd: Int,
  ) {
    super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd)
    // A composition lives in the keyboard, not in the field (OutcomeApplier),
    // so a caret moved mid-word only moves where the word will land.
    if (applier.composing) return
    if (predicting) {
      // A list offered here means nothing anywhere else: 人 after 中国 is
      // not something to insert where the person has just tapped.
      when {
        predictionAt == PENDING && newSelStart == newSelEnd -> predictionAt = newSelStart
        newSelStart != predictionAt || newSelEnd != predictionAt -> dismissPrediction()
      }
    }
    if (!learningOff) {
      main.removeCallbacks(readSurrounding)
      main.postDelayed(readSurrounding, SURROUNDING_DELAY_MS)
    }
  }

  /** What is around the cursor, for the scorer; never read in a private field. */
  private fun reportSurrounding() {
    if (learningOff || applier.composing) return
    val ic = currentInputConnection ?: return
    val left = ic.getTextBeforeCursor(LEFT_CHARS, 0)?.toString() ?: return
    val right = ic.getTextAfterCursor(RIGHT_CHARS, 0)?.toString() ?: ""
    engine.setSurrounding(left, right)
  }

  // ── hardware keys ─────────────────────────────────────────────────────

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_SHIFT_LEFT || keyCode == KeyEvent.KEYCODE_SHIFT_RIGHT) {
      if (event.repeatCount == 0) shiftAlone = true
      return super.onKeyDown(keyCode, event)
    }
    shiftAlone = false
    val key = hardwareKey(keyCode, event.getUnicodeChar(event.metaState), event.metaState)
      ?: return super.onKeyDown(keyCode, event)
    if (currentInputConnection == null || !shouldEat(key, applier.composing || composingPredicted, predicting)) {
      // Going to the application past a list the engine drew: close it.
      if (predicting) dismissPrediction()
      return super.onKeyDown(keyCode, event)
    }
    eaten.add(keyCode)
    if (keyboard.mode == InputMode.CHINESE && key.ch in 'a'.code..'z'.code) composingPredicted = true
    send(key, event.isCapsLockOn)
    return true
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_SHIFT_LEFT || keyCode == KeyEvent.KEYCODE_SHIFT_RIGHT) {
      // Shift pressed and released on its own switches Chinese and English.
      if (shiftAlone && currentInputConnection != null) send(EngineKey.function(Vk.SHIFT), event.isCapsLockOn)
      shiftAlone = false
      return super.onKeyUp(keyCode, event)
    }
    if (eaten.remove(keyCode)) return true
    return super.onKeyUp(keyCode, event)
  }

  // ── touch keys ────────────────────────────────────────────────────────

  override fun onKey(action: KeyAction) {
    if (currentInputConnection == null) return
    when (action) {
      is KeyAction.Token -> keyboard.tokens[action.name]?.let { send(EngineKey(0, it.key.codePointAt(0), 0)) }
      is KeyAction.Letter -> {
        val capital = keyboard.shifted
        keyboard.shifted = false
        send(
          if (capital) EngineKey.char(action.ch.uppercaseChar().code, Vk.MOD_SHIFT)
          else EngineKey.char(action.ch.code),
        )
      }
      is KeyAction.Text -> engine.insert(action.text) { show(null, it) }
      is KeyAction.Punct -> send(EngineKey.char(action.ch.code))
      KeyAction.Backspace -> send(EngineKey.function(Vk.BACK))
      KeyAction.Space -> send(EngineKey.char(' '.code))
      KeyAction.Enter -> send(EngineKey.function(Vk.RETURN))
      KeyAction.Shift -> keyboard.shifted = !keyboard.shifted
      KeyAction.ToggleMode -> send(EngineKey.function(Vk.SHIFT))
      KeyAction.Globe -> switchLetters(if (keyboard.lettersLayer == Layer.GRID) Layer.QWERTY else Layer.GRID)
      is KeyAction.ToLayer -> keyboard.layer = action.layer
      KeyAction.BackToLetters -> keyboard.layer = keyboard.lettersLayer
      KeyAction.Spacer -> Unit
    }
  }

  override fun onChoose(index: Int) {
    engine.choose(index) { show(null, it) }
  }

  override fun onPage(forward: Boolean) {
    send(EngineKey.function(if (forward) Vk.NEXT else Vk.PRIOR))
  }

  override fun onHide() {
    requestHideSelf(0)
  }

  override fun onPicker() {
    (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
  }

  // ── the toolbar ───────────────────────────────────────────────────────

  override fun onPanel(panel: Panel?) {
    keyboard.selecting = false
    keyboard.panel = panel
    if (panel == Panel.CLIPBOARD) showClips()
  }

  override fun onEdit(action: EditAction) {
    val ic = currentInputConnection ?: return
    when (val command = commandFor(action, keyboard.selecting)) {
      is EditCommand.Key -> {
        val now = SystemClock.uptimeMillis()
        ic.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, command.keyCode, 0, command.meta))
        ic.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, command.keyCode, 0, command.meta))
      }
      is EditCommand.Menu -> ic.performContextMenuAction(command.id)
      null -> Unit
    }
    keyboard.selecting = selectingAfter(action, keyboard.selecting)
  }

  /**
   * Into the field as if typed. The engine is reset so the pasted text is not
   * taken for the next word of whatever was committed before it.
   */
  override fun onPasteClip(clip: Clip) {
    val ic = currentInputConnection ?: return
    ic.commitText(clip.text, 1)
    engine.reset { frame -> frame?.let(::render) }
    chipTaken = clip.at
    keyboard.panel = null
    showClips()
  }

  override fun onPinClip(clip: Clip, pinned: Boolean) {
    clipboard.pin(clip.text, pinned)
    showClips()
  }

  override fun onRemoveClip(clip: Clip) {
    clipboard.remove(clip.text)
    showClips()
  }

  override fun onClearClips() {
    clipboard.clearUnpinned()
    showClips()
  }

  override fun onRecording(on: Boolean) {
    keyboard.recording = on
    prefs().edit().putBoolean(PREF_RECORDING, on).apply()
  }

  /**
   * Kept on disk: a process a vendor killed and restarted must not come back
   * learning when the person left it incognito. The field is started again so
   * the engine's session is muted (or not) from the next key.
   */
  override fun onIncognito() {
    keyboard.incognito = !keyboard.incognito
    prefs().edit().putBoolean(PREF_INCOGNITO, keyboard.incognito).apply()
    engine.startInput(fieldPackage, learningOff) { frame -> frame?.let(::render) }
  }

  /** Meridian's own settings page for the keyboard, over whatever was open. */
  override fun onOpenSettings() {
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    intent.putExtra(EXTRA_OPEN_SETTINGS, "ime")
    requestHideSelf(0)
    startActivity(intent)
  }

  /** When the chip was last used: the same copy is not offered again. */
  private var chipTaken = 0L

  /**
   * Reads what is on the clipboard now and remembers it, unless it may not be
   * ([mayRemember]) or it has been seen before — a clip deleted from the
   * history would otherwise come back the next time the keyboard opens. Text
   * only: a copied image or link intent is not something to type.
   *
   * `live` is the listener: the copy is happening now, whatever the stamp
   * says. Otherwise this is the catch-up when the keyboard shows, and the
   * copy is dated from the stamp ([copiedAt]); one it cannot date is kept
   * but not offered on the toolbar, since it may be hours old.
   */
  private fun captureClip(live: Boolean) {
    val clip = try {
      clipboardManager.primaryClip
    } catch (_: SecurityException) {
      null
    } ?: return
    if (clip.itemCount == 0) return
    val text = clip.getItemAt(0).text?.toString() ?: return
    val description = clip.description
    val stamp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) description.timestamp else 0L
    // Which copy this is, in whatever base the stamp is in: compared, never converted.
    val identity = if (stamp > 0) stamp else text.hashCode().toLong()
    if (identity == prefs().getLong(PREF_CLIP_SEEN, Long.MIN_VALUE)) return
    prefs().edit().putLong(PREF_CLIP_SEEN, identity).apply()
    val now = System.currentTimeMillis()
    val at = if (live) now else copiedAt(stamp, SystemClock.elapsedRealtime(), now)
    // A one-time code is offered, never remembered — so none of what forbids
    // remembering applies, and a private field is where one is typed. One
    // whose copy cannot be dated is not offered: it may be long spent.
    codeIn(text)?.let { found ->
      if (at != null) {
        code = Clip(found, at)
        showClips()
      }
      return
    }
    val sensitive = description.extras?.getBoolean(EXTRA_IS_SENSITIVE, false) == true
    if (!mayRemember(sensitive, privateField, keyboard.incognito, keyboard.recording)) return
    if (at == null) chipTaken = maxOf(chipTaken, now)
    if (clipboard.add(text, at ?: now)) showClips()
  }

  /** The last one-time code copied, in memory only, until it goes stale. */
  private var code: Clip? = null

  /** Puts the history and the paste chip on screen, and schedules the chip's end. */
  private fun showClips() {
    clipboard.expire()
    keyboard.clips = clipboard.clips
    val now = System.currentTimeMillis()
    code = code?.takeIf { now - it.at in 0..CHIP_MS && it.at > chipTaken }
    keyboard.code = code
    // A code the field is waiting for outranks whatever else was copied.
    val fresh = if (code != null) null else clipboard.fresh(CHIP_MS)?.takeIf { it.at > chipTaken }
    keyboard.chip = fresh
    main.removeCallbacks(refreshChip)
    (code ?: fresh)?.let { main.postDelayed(refreshChip, CHIP_MS - (now - it.at) + 50) }
  }

  // ── autofill's inline suggestions (Android 11+) ─────────────────────────

  /** Which response the views being inflated belong to; a later one wins. */
  private var inlineGeneration = 0

  /**
   * Asked by the system when an autofill service may have something for the
   * field: one chip shape, as tall as the toolbar's chips. The service draws
   * them in the platform's default style.
   */
  @RequiresApi(Build.VERSION_CODES.R)
  override fun onCreateInlineSuggestionsRequest(uiExtras: Bundle): InlineSuggestionsRequest {
    val density = resources.displayMetrics.density
    val height = (INLINE_HEIGHT_DP * density).toInt()
    val styles = UiVersions.newStylesBuilder().addStyle(InlineSuggestionUi.newStyleBuilder().build()).build()
    val spec = InlinePresentationSpec
      .Builder(Size((INLINE_MIN_WIDTH_DP * density).toInt(), height), Size((INLINE_MAX_WIDTH_DP * density).toInt(), height))
      .setStyle(styles)
      .build()
    return InlineSuggestionsRequest.Builder(listOf(spec)).setMaxSuggestionCount(MAX_INLINE).build()
  }

  /**
   * The service's answer, inflated into its own views; the keyboard lays
   * them out and never reads them. An empty answer takes them away.
   */
  @RequiresApi(Build.VERSION_CODES.R)
  override fun onInlineSuggestionsResponse(response: InlineSuggestionsResponse): Boolean {
    val generation = ++inlineGeneration
    val suggestions = response.inlineSuggestions
    if (suggestions.isEmpty()) {
      keyboard.inline = emptyList()
      return true
    }
    val views = arrayOfNulls<View>(suggestions.size)
    var pending = suggestions.size
    val wrap = Size(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    suggestions.forEachIndexed { i, suggestion ->
      suggestion.inflate(this, wrap, mainExecutor) { view ->
        views[i] = view
        pending -= 1
        if (pending == 0 && generation == inlineGeneration) keyboard.inline = views.filterNotNull()
      }
    }
    return true
  }

  /**
   * Grid and QWERTY type different schemes, and changing the scheme drops
   * whatever is being composed, which was only ever in the keyboard. The grid
   * only types Chinese, so
   * arriving on it in English mode switches back.
   */
  private fun switchLetters(layer: Layer) {
    if (applier.composing) applier.apply(EMPTY_FRAME)
    if (predicting) dismissPrediction()
    keyboard.lettersLayer = layer
    keyboard.layer = layer
    keyboard.shifted = false
    prefs().edit().putString(PREF_LETTERS, layer.name).apply()
    engine.setScheme(schemeOf(layer))
    if (layer == Layer.GRID && keyboard.mode == InputMode.ENGLISH) send(EngineKey.function(Vk.SHIFT))
  }

  private fun schemeOf(layer: Layer): String = if (layer == Layer.GRID) "grid" else "pinyin"

  private fun send(key: EngineKey, capsLock: Boolean = false) {
    engine.key(key, capsLock) { show(key, it) }
  }

  /**
   * Applies an answer. A null one means the engine is not there, and the
   * key is treated as declined: the character goes in as typed.
   */
  private fun show(key: EngineKey?, outcome: KeyOutcome?) {
    composingPredicted = false
    applier.apply(key, outcome ?: KeyOutcome(consumed = false, commit = null, frame = EMPTY_FRAME), enterAction)
    render(outcome?.frame)
    if (outcome?.commit != null && outcome.frame.predicting) predictionAt = PENDING
  }

  private fun dismissPrediction() {
    predicting = false
    predictionAt = NOWHERE
    engine.dismiss { frame -> frame?.let(::render) }
  }

  private fun render(frame: Frame?) {
    frame?.let { keyboard.mode = it.mode }
    predicting = frame?.predicting == true
    if (!predicting) predictionAt = NOWHERE
    val visible = frame != null && !frame.isEmpty
    keyboard.frame = if (visible) frame else null
    // The touch keyboard has its own candidate bar; the system's candidates
    // area is for a hardware keyboard, which shows no input view.
    val stripVisible = visible && !isInputViewShown
    strip?.show(if (stripVisible) frame else null)
    setCandidatesViewShown(stripVisible)
  }

  private companion object {
    const val PREFS = "ime"
    const val PREF_LETTERS = "letters_layer"
    const val PREF_INCOGNITO = "incognito"
    const val PREF_RECORDING = "clipboard_recording"
    /** The stamp (or, without one, the text hash) of the last system clip looked at. */
    const val PREF_CLIP_SEEN = "clipboard_seen_stamp"
    /** `ClipDescription.EXTRA_IS_SENSITIVE`, API 33; apps set it on older versions too. */
    const val EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"
    /** How long a copy is offered on the toolbar. */
    const val CHIP_MS = 60_000L
    const val MAX_INLINE = 6
    const val INLINE_HEIGHT_DP = 36
    const val INLINE_MIN_WIDTH_DP = 48
    const val INLINE_MAX_WIDTH_DP = 320
    const val SURROUNDING_DELAY_MS = 150L
    const val LEFT_CHARS = 64
    const val RIGHT_CHARS = 32
    /** [predictionAt] with no list on screen, and before its commit's echo. */
    const val NOWHERE = -1
    const val PENDING = -2
    val EMPTY_FRAME = Frame(emptyList(), emptyList(), 0, 0, 0, InputMode.CHINESE, null, predicting = false)
  }
}
