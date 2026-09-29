package cn.yuxiaoqiu.meridian

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import cn.yuxiaoqiu.meridian.ime.MeridianInputMethodService

/**
 * The keyboard's standing with the system, for the settings page (called
 * from src-tauri/src/ime/android.rs over JNI, in the app's process). Android
 * lets an app ask whether its keyboard is enabled and selected, and open the
 * two system screens that change that; it lets it do neither itself.
 */
object ImeBridge {
  private fun imm(context: Context) = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager

  @JvmStatic
  fun isEnabled(context: Context): Boolean {
    val ours = ComponentName(context, MeridianInputMethodService::class.java)
    return imm(context).enabledInputMethodList.any { it.component == ours }
  }

  @JvmStatic
  fun isCurrent(context: Context): Boolean {
    val current = Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
    val ours = ComponentName(context, MeridianInputMethodService::class.java)
    return current != null && ComponentName.unflattenFromString(current) == ours
  }

  @JvmStatic
  fun openSettings(context: Context) {
    context.startActivity(
      Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  /** The picker only opens for an app in the foreground, which the settings page is. */
  @JvmStatic
  fun showPicker(context: Context) {
    imm(context).showInputMethodPicker()
  }
}
