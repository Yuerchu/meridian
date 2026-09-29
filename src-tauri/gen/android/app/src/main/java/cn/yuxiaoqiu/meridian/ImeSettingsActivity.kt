package cn.yuxiaoqiu.meridian

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * What the system's keyboard settings open for Meridian's keyboard
 * (`settingsActivity` in `res/xml/method.xml`). The system starts the class it
 * names with no extras, so naming `MainActivity` there opened the app wherever
 * it was; this adds [EXTRA_OPEN_SETTINGS] and goes, the same launch the
 * keyboard's own settings button makes. No window of its own.
 */
class ImeSettingsActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      launch.putExtra(EXTRA_OPEN_SETTINGS, "ime")
      startActivity(launch)
    }
    finish()
  }
}
