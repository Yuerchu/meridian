package cn.yuxiaoqiu.meridian.ime

import android.content.res.Configuration
import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import java.io.File

/**
 * Meridian's keyboard. Runs in its own process (`:ime`), with the engine in
 * that process through `libmeridian_ime.so`; nothing here talks to the app.
 * What Meridian changes — settings, dictionaries, a model, memory hints — it
 * writes under `dataDir/ime`, and the engine picks it up when a field gains
 * focus (the same directory Tauri calls `app_data_dir`).
 *
 * This first cut handles a hardware keyboard and shows candidates in a strip;
 * the touch keyboard is drawn in Compose on top of the same pieces.
 */
class MeridianInputMethodService : InputMethodService() {
  private lateinit var engine: Engine
  private val main = Handler(Looper.getMainLooper())
  private val applier = OutcomeApplier(InputConnectionTarget { currentInputConnection })
  private var strip: CandidateStrip? = null

  private var enterAction: Int? = null
  private var privateField = false
  private var mode = InputMode.CHINESE
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
    engine = Engine(File(dataDir, "ime"))
  }

  override fun onDestroy() {
    main.removeCallbacks(readSurrounding)
    engine.close()
    super.onDestroy()
  }

  override fun onEvaluateFullscreenMode(): Boolean = false

  override fun onCreateCandidatesView(): View =
    CandidateStrip(this) { index -> engine.choose(index) { show(null, it) } }.also { strip = it }

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
    applier.forget()
    composingPredicted = false
    eaten.clear()
    engine.refresh()
    // A physical keyboard types pinyin whatever the configured scheme: it
    // cannot produce the grid's keys.
    val hardware = resources.configuration.keyboard == Configuration.KEYBOARD_QWERTY
    engine.setScheme(if (hardware) "pinyin" else null)
    engine.startInput(attribute.packageName, privateField) { frame -> frame?.let(::render) }
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
    if (mode == InputMode.CHINESE && key.ch in 'a'.code..'z'.code) composingPredicted = true
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

  private fun send(key: EngineKey, capsLock: Boolean) {
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
    frame?.let { mode = it.mode }
    val visible = frame != null && !frame.isEmpty
    strip?.show(if (visible) frame else null)
    setCandidatesViewShown(visible)
  }

  private companion object {
    const val SURROUNDING_DELAY_MS = 150L
    const val LEFT_CHARS = 64
    const val RIGHT_CHARS = 32
    val EMPTY_FRAME = Frame(emptyList(), emptyList(), 0, 0, 0, InputMode.CHINESE, null)
  }
}
