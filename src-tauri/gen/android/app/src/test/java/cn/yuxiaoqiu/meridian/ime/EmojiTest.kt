package cn.yuxiaoqiu.meridian.ime

import androidx.emoji2.emojipicker.RecentEmojiProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class EmojiTest {
  private class Kept : RecentEmojiProvider {
    val recorded = mutableListOf<String>()

    override fun recordSelection(emoji: String) {
      recorded += emoji
    }

    override suspend fun getRecentEmojiList(): List<String> = recorded.toList()
  }

  @Test
  fun theLastPickGoesFirstOnceAndTheOldestFallsOff() {
    assertEquals(listOf("🙂", "😀", "🎉"), recentAfter(listOf("😀", "🙂", "🎉"), "🙂"))
    val full = (1..RECENT_EMOJI_MAX).map { "e$it" }
    val after = recentAfter(full, "new")
    assertEquals(RECENT_EMOJI_MAX, after.size)
    assertEquals("new", after.first())
    assertEquals("e${RECENT_EMOJI_MAX - 1}", after.last())
  }

  @Test
  fun aPickIsRecordedOnlyWhereTheKeyboardMayKeepSomething() {
    val kept = Kept()
    var learning = true
    val recents = GatedRecents(kept) { learning }
    recents.recordSelection("😀")
    learning = false
    recents.recordSelection("🔒")
    assertEquals(listOf("😀"), kept.recorded)
    assertEquals("what was kept is still shown", listOf("😀"), runBlocking { recents.getRecentEmojiList() })
  }
}
