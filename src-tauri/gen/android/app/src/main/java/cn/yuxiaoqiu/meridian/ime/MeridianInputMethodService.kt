package cn.yuxiaoqiu.meridian.ime

import android.content.Context
import android.content.res.Configuration
import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import androidx.compose.ui.platform.ComposeView
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
  /**
   * Set when a letter is sent while not yet composing, until its answer
   * arrives: a Backspace typed in that gap belongs to the composition, not to
   * the document, and `onKeyDown` has to decide that before the engine has.
   */
  private var composingPredicted = false
  private val eaten = mutableSetOf<Int>()
  private var shiftAlone = false

  private val readSurrounding = Runnable { reportSurrounding() }

  override fun onCreate() {
    super.onCreate()
    lifecycle.create()
    engine = Engine(File(dataDir, "ime"))
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
    main.removeCallbacks(readSurrounding)
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
    engine.startInput(attribute.packageName, privateField) { frame -> frame?.let(::render) }
  }

  override fun onStartInputView(info: EditorInfo, restarting: Boolean) {
    super.onStartInputView(info, restarting)
    lifecycle.shown()
    // Written by the app the first time it runs, possibly after the keyboard started.
    if (keyboard.font == null) keyboard.font = keyboardFont(dataDir)
    keyboard.shifted = false
    engine.setScheme(schemeOf(keyboard.lettersLayer))
  }

  override fun onFinishInputView(finishingInput: Boolean) {
    keyboard.menu = null
    lifecycle.hidden()
    super.onFinishInputView(finishingInput)
  }

  override fun onFinishInput() {
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
    if (applier.composing) {
      // The cursor left the composition (a tap elsewhere): drop it rather
      // than keep typing into a region the person has moved away from.
      if (candidatesStart < 0 || newSelStart != newSelEnd || newSelEnd != candidatesEnd) {
        currentInputConnection?.finishComposingText()
        applier.forget()
        engine.reset { frame -> frame?.let(::render) }
      }
      return
    }
    if (!privateField) {
      main.removeCallbacks(readSurrounding)
      main.postDelayed(readSurrounding, SURROUNDING_DELAY_MS)
    }
  }

  /** What is around the cursor, for the scorer; never read in a private field. */
  private fun reportSurrounding() {
    if (privateField || applier.composing) return
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
    if (currentInputConnection == null || !shouldEat(key, applier.composing || composingPredicted)) {
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

  /**
   * Grid and QWERTY type different schemes, and changing the scheme drops
   * whatever is being composed; the composing region goes with it rather than
   * staying in the field as typed letters. The grid only types Chinese, so
   * arriving on it in English mode switches back.
   */
  private fun switchLetters(layer: Layer) {
    if (applier.composing) applier.apply(EMPTY_FRAME)
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
  }

  private fun render(frame: Frame?) {
    frame?.let { keyboard.mode = it.mode }
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
    const val SURROUNDING_DELAY_MS = 150L
    const val LEFT_CHARS = 64
    const val RIGHT_CHARS = 32
    val EMPTY_FRAME = Frame(emptyList(), emptyList(), 0, 0, 0, InputMode.CHINESE, null)
  }
}
