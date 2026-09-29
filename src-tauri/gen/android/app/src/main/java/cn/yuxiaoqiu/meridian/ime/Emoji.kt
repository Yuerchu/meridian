package cn.yuxiaoqiu.meridian.ime

import android.content.SharedPreferences
import android.view.ContextThemeWrapper
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.emoji2.emojipicker.EmojiPickerView
import androidx.emoji2.emojipicker.RecentEmojiProvider
import com.google.android.material.color.DynamicColors

/**
 * The picker's recently used row, written only where the keyboard may keep
 * something: nothing is recorded while `mayRecord` says no (a private field,
 * a private app, incognito). What was recorded before is still shown — it is
 * the person's own screen, and hiding it would say nothing more.
 */
class GatedRecents(
  private val kept: RecentEmojiProvider,
  private val mayRecord: () -> Boolean,
) : RecentEmojiProvider {
  override fun recordSelection(emoji: String) {
    if (mayRecord()) kept.recordSelection(emoji)
  }

  override suspend fun getRecentEmojiList(): List<String> = kept.getRecentEmojiList()
}

/** How many emoji the recently used row keeps: three rows of the panel. */
const val RECENT_EMOJI_MAX = 27

/** The row after `picked`: it first, each emoji once, the oldest dropped past [RECENT_EMOJI_MAX]. */
fun recentAfter(recent: List<String>, picked: String): List<String> =
  (listOf(picked) + recent.filter { it != picked }).take(RECENT_EMOJI_MAX)

/**
 * The recently used row in the keyboard's preferences, one emoji a line. The
 * library's own store is internal to it, so this is the keyboard's, beside
 * its other settings.
 */
class KeptRecents(private val prefs: SharedPreferences) : RecentEmojiProvider {
  override fun recordSelection(emoji: String) {
    prefs.edit().putString(KEY, recentAfter(read(), emoji).joinToString("\n")).apply()
  }

  override suspend fun getRecentEmojiList(): List<String> = read()

  private fun read(): List<String> = prefs.getString(KEY, null)?.split('\n')?.filter { it.isNotEmpty() }.orEmpty()

  private companion object {
    const val KEY = "recent_emoji"
  }
}

/**
 * AndroidX's emoji picker in place of the keys. It is a View, themed from the
 * app's Material 3 DayNight theme with the wallpaper's colours where the
 * system has them, so it follows the keyboard's own light and dark. The rows
 * are sized for the panel, which is the height of the keys it replaces.
 */
@Composable
internal fun EmojiPanel(recents: RecentEmojiProvider, onPick: (String) -> Unit) {
  val pick by rememberUpdatedState(onPick)
  AndroidView(
    factory = { context ->
      val themed = DynamicColors.wrapContextIfAvailable(
        ContextThemeWrapper(context, com.google.android.material.R.style.Theme_Material3_DayNight_NoActionBar),
      )
      EmojiPickerView(themed).apply {
        emojiGridColumns = 9
        emojiGridRows = 4.5f
        setRecentEmojiProvider(recents)
        setOnEmojiPickedListener { pick(it.emoji) }
      }
    },
    modifier = Modifier.fillMaxSize(),
  )
}
