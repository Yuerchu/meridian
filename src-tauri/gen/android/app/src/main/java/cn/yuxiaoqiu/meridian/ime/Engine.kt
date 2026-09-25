package cn.yuxiaoqiu.meridian.ime

import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import java.io.File
import kotlinx.serialization.builtins.ListSerializer

/**
 * The functions `libmeridian_ime.so` exports (src-tauri/ime/android/src/jni.rs).
 * Every one may throw: IllegalStateException for a panic or a destroyed
 * handle, IllegalArgumentException for a value the library refuses,
 * IOException when the data directory cannot be opened.
 */
internal object EngineBridge {
  init {
    System.loadLibrary("meridian_ime")
  }

  @JvmStatic external fun nativeCreate(dataDir: String): Long
  @JvmStatic external fun nativeDestroy(handle: Long)
  @JvmStatic external fun nativeStartInput(handle: Long, packageName: String?, private: Boolean): String
  @JvmStatic external fun nativeSetScheme(handle: Long, scheme: String?)
  @JvmStatic external fun nativeSetSurrounding(handle: Long, left: String, right: String)
  @JvmStatic external fun nativeHandleKey(handle: Long, vk: Int, ch: Int, mods: Int, capsLock: Boolean): String
  @JvmStatic external fun nativeChoose(handle: Long, index: Int): String
  @JvmStatic external fun nativeReset(handle: Long): String
  @JvmStatic external fun nativeRefresh(handle: Long): Boolean
  @JvmStatic external fun nativeFlush(handle: Long)
  @JvmStatic external fun nativeGridTokens(): String
}

/**
 * The engine on its own thread. `ImeHost` takes no lock, so every call is
 * posted to `ime-engine` and answered on the main thread, in order. When the
 * library cannot be loaded or the engine cannot be opened, every answer is
 * null and the keyboard types plain characters: a broken engine costs the
 * candidates, never the ability to type.
 */
class Engine(dataDir: File) {
  private val thread = HandlerThread("ime-engine").apply { start() }
  private val worker = Handler(thread.looper)
  private val main = Handler(Looper.getMainLooper())

  /** Touched on `ime-engine` only. */
  private var handle = 0L

  init {
    worker.post {
      handle = attempt("create") { EngineBridge.nativeCreate(dataDir.absolutePath) } ?: 0L
    }
  }

  private fun <T> attempt(what: String, call: () -> T): T? = try {
    call()
  } catch (e: Throwable) {
    // UnsatisfiedLinkError included: a missing library is a plain keyboard.
    Log.e(TAG, "engine $what failed", e)
    null
  }

  /** Runs `call` on the engine thread with a live handle; `done` gets the answer on main. */
  private fun <T> ask(what: String, done: ((T?) -> Unit)?, call: (Long) -> T) {
    worker.post {
      val result = if (handle == 0L) null else attempt(what) { call(handle) }
      if (done != null) main.post { done(result) }
    }
  }

  private fun outcome(json: String?): KeyOutcome? =
    json?.let { attempt("decode") { EngineJson.decodeFromString(KeyOutcome.serializer(), it) } }

  private fun frame(json: String?): Frame? =
    json?.let { attempt("decode") { EngineJson.decodeFromString(Frame.serializer(), it) } }

  fun startInput(packageName: String?, private: Boolean, done: (Frame?) -> Unit) =
    ask<String>("startInput", { done(frame(it)) }) { EngineBridge.nativeStartInput(it, packageName, private) }

  /** `"pinyin"`, `"zhuyin"`, `"grid"`, or null for the configured scheme. */
  fun setScheme(scheme: String?) = ask<Unit>("setScheme", null) { EngineBridge.nativeSetScheme(it, scheme) }

  fun setSurrounding(left: String, right: String) =
    ask<Unit>("setSurrounding", null) { EngineBridge.nativeSetSurrounding(it, left, right) }

  fun key(key: EngineKey, capsLock: Boolean, done: (KeyOutcome?) -> Unit) =
    ask<String>("key", { done(outcome(it)) }) {
      EngineBridge.nativeHandleKey(it, key.vk, key.ch, key.mods, capsLock)
    }

  fun choose(index: Int, done: (KeyOutcome?) -> Unit) =
    ask<String>("choose", { done(outcome(it)) }) { EngineBridge.nativeChoose(it, index) }

  fun reset(done: ((Frame?) -> Unit)? = null) =
    ask<String>("reset", done?.let { d -> { json: String? -> d(frame(json)) } }) { EngineBridge.nativeReset(it) }

  fun refresh() = ask<Boolean>("refresh", null) { EngineBridge.nativeRefresh(it) }

  fun flush() = ask<Unit>("flush", null) { EngineBridge.nativeFlush(it) }

  /** The grid's keys, for the layout. */
  fun gridTokens(done: (List<GridToken>?) -> Unit) = worker.post {
    val tokens = attempt("gridTokens") {
      EngineJson.decodeFromString(ListSerializer(GridToken.serializer()), EngineBridge.nativeGridTokens())
    }
    main.post { done(tokens) }
  }

  /** Flushes, destroys the engine and ends the thread; nothing may be called after. */
  fun close() {
    worker.post {
      if (handle != 0L) {
        attempt("flush") { EngineBridge.nativeFlush(handle) }
        attempt("destroy") { EngineBridge.nativeDestroy(handle) }
        handle = 0L
      }
    }
    thread.quitSafely()
  }

  private companion object {
    const val TAG = "MeridianIme"
  }
}
