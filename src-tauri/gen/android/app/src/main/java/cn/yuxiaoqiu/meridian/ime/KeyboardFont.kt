package cn.yuxiaoqiu.meridian.ime

import android.graphics.Typeface
import android.os.Build
import android.util.Log
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import java.io.File

/**
 * MiSans, the app's font, when the app has written it out for the keyboard
 * (src-tauri/src/keyboard_font.rs puts it at `dataDir/ime/fonts`); null means
 * the system font. The keyboard draws at 500 either way. A file that does not
 * load as a typeface is ignored rather than handed to Compose, where it would
 * fail while laying out a key — in the middle of somebody typing.
 */
fun keyboardFont(dataDir: File): FontFamily? {
  // Variation settings, which a variable font needs to be anything but its default weight.
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
  val file = File(dataDir, "ime/fonts/MiSansVF.ttf")
  if (!file.isFile) return null
  val loads = try {
    Typeface.Builder(file).setFontVariationSettings("'wght' 500").build() != null
  } catch (e: Exception) {
    Log.w("MeridianIme", "keyboard font unreadable; using the system font", e)
    false
  }
  if (!loads) return null
  return FontFamily(
    Font(file, FontWeight.Medium, variationSettings = FontVariation.Settings(FontVariation.weight(500))),
    Font(file, FontWeight.SemiBold, variationSettings = FontVariation.Settings(FontVariation.weight(600))),
  )
}
