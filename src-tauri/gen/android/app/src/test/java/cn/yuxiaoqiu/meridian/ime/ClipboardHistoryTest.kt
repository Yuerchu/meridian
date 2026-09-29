package cn.yuxiaoqiu.meridian.ime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ClipboardHistoryTest {
  @get:Rule
  val tmp = TemporaryFolder()

  private var now = 10_000_000L
  private val clock = { now }
  private val hour = ClipboardHistory.TTL_MS

  private fun texts(h: ClipboardHistory) = h.clips.map { it.text }

  @Test
  fun newestFirstAndTheSameTextMovesUpKeepingItsPin() {
    val h = ClipboardHistory(null, clock)
    h.add("a", now - 3)
    h.add("b", now - 2)
    h.pin("a", true)
    h.add("c", now - 1)
    assertEquals(listOf("a", "c", "b"), texts(h))
    h.add("a", now)
    assertEquals(listOf("a", "c", "b"), texts(h))
    assertTrue(h.clips.first().pinned)
    assertFalse("an older copy of the same text changes nothing", h.add("b", now - 100))
  }

  @Test
  fun unpinnedClipsExpireAfterTheHourAndPinnedOnesDoNot() {
    val h = ClipboardHistory(null, clock)
    h.add("old", now)
    h.add("kept", now)
    h.pin("kept", true)
    now += hour + 1
    assertTrue(h.expire())
    assertEquals(listOf("kept"), texts(h))
    assertFalse(h.expire())
  }

  @Test
  fun atMostTwentyUnpinnedAreKept() {
    val h = ClipboardHistory(null, clock)
    h.add("pinned", now - 1000)
    h.pin("pinned", true)
    for (i in 0 until 25) h.add("clip $i", now - 100 + i)
    assertEquals(1 + ClipboardHistory.MAX_RECENT, h.clips.size)
    assertEquals("pinned", h.clips.first().text)
    assertEquals("clip 24", h.clips[1].text)
    assertFalse("the oldest went", texts(h).contains("clip 4"))
  }

  @Test
  fun blankAndOversizedTextIsNotRemembered() {
    val h = ClipboardHistory(null, clock)
    assertFalse(h.add("  \n "))
    assertFalse(h.add("x".repeat(ClipboardHistory.MAX_CHARS + 1)))
    assertTrue(h.clips.isEmpty())
  }

  @Test
  fun clearingForgetsOnlyWhatIsNotPinned() {
    val h = ClipboardHistory(null, clock)
    h.add("a", now)
    h.add("b", now)
    h.pin("b", true)
    h.clearUnpinned()
    assertEquals(listOf("b"), texts(h))
    h.remove("b")
    assertTrue(h.clips.isEmpty())
  }

  @Test
  fun theChipIsTheNewestClipWhileItIsFresh() {
    val h = ClipboardHistory(null, clock)
    h.add("pinned", now - 10)
    h.pin("pinned", true)
    h.add("new", now - 5)
    assertEquals("new", h.fresh(60_000)?.text)
    now += 60_000
    assertNull(h.fresh(60_000))
  }

  /** A vendor that kills the keyboard's process must not take the history with it. */
  @Test
  fun aNewProcessReadsWhatTheOldOneWrote() {
    val file = File(tmp.root, "ime/clipboard.json")
    val first = ClipboardHistory(file, clock)
    first.add("recent", now - 10)
    first.add("pinned", now - 20)
    first.pin("pinned", true)
    val second = ClipboardHistory(file, clock)
    assertEquals(listOf("pinned", "recent"), texts(second))
    now += hour + 1
    assertEquals("expired on the way in", listOf("pinned"), texts(ClipboardHistory(file, clock)))
  }

  /** What a build that misread the clipboard's stamps left on the device. */
  @Test
  fun aClipDatedInTheFutureIsTakenAsCopiedNowAndStillExpires() {
    val file = File(tmp.root, "clipboard.json")
    file.writeText("""[{"text":"from 2080","at":${now + 50L * 365 * 24 * hour}}]""")
    val loaded = ClipboardHistory(file, clock)
    assertEquals(now, loaded.clips.single().at)
    assertEquals("offered as just copied", "from 2080", loaded.fresh(60_000)?.text)
    now += hour + 1
    assertTrue(loaded.expire())
    assertTrue(loaded.clips.isEmpty())
  }

  @Test
  fun anUnreadableFileIsLeftAloneAndTheHistoryCarriesOnInMemory() {
    val file = File(tmp.root, "clipboard.json")
    file.writeText("{ not json")
    val h = ClipboardHistory(file, clock)
    assertTrue(h.clips.isEmpty())
    h.add("a", now)
    assertEquals(listOf("a"), texts(h))
    assertEquals("{ not json", file.readText())
  }
}
