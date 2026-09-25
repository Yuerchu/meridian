package cn.yuxiaoqiu.meridian.ime

import android.content.Context
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The preedit and one page of candidates in a row; a tap chooses. A plain
 * view for the hardware-keyboard path, until the Compose keyboard's
 * candidate bar replaces it.
 */
class CandidateStrip(context: Context, private val onChoose: (Int) -> Unit) : HorizontalScrollView(context) {
  private val row = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
  }

  init {
    isHorizontalScrollBarEnabled = false
    addView(row)
    minimumHeight = dp(44)
  }

  private fun dp(v: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

  private fun cell(text: String, bold: Boolean): TextView = TextView(context).apply {
    this.text = text
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
    setPadding(dp(12), dp(8), dp(12), dp(8))
    if (bold) setTypeface(typeface, Typeface.BOLD)
  }

  /** Draws `frame`, or empties the strip for null. */
  fun show(frame: Frame?) {
    row.removeAllViews()
    if (frame == null) return
    val preedit = frame.preeditText
    if (preedit.isNotEmpty()) row.addView(cell(preedit, bold = false).apply { alpha = 0.6f })
    frame.notice?.let { row.addView(cell(it, bold = false)) }
    frame.candidates.forEachIndexed { index, candidate ->
      row.addView(
        cell(candidate.text, bold = index == frame.highlight).apply {
          isClickable = true
          setOnClickListener { onChoose(index) }
        },
      )
    }
    scrollTo(0, 0)
  }
}
