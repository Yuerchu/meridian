@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package cn.yuxiaoqiu.meridian.ime

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Every animation on the keyboard takes its spring from the theme's motion
// scheme (Material 3 Expressive): spatial springs, for where and how big a
// thing is, overshoot and settle; effects springs, for colour and opacity, do
// not. Nothing here stands between a key and what it types — a press shows at
// once and candidates are never faded in — only what follows is animated.
//
// And what says what a release or a tap will do — a menu's highlight, an item
// a finger is aimed at — is never moved or recoloured on a delay: animate its
// size or opacity in place, never its position. Both times this was broken
// (a long-press menu that grew in, a highlight that sprang between items)
// the item that looked chosen was not the one typed, and both were found in
// review rather than on the device.

@Composable
internal fun <T> fastSpatial(): FiniteAnimationSpec<T> = MaterialTheme.motionScheme.fastSpatialSpec()

@Composable
internal fun <T> defaultSpatial(): FiniteAnimationSpec<T> = MaterialTheme.motionScheme.defaultSpatialSpec()

@Composable
internal fun <T> fastEffects(): FiniteAnimationSpec<T> = MaterialTheme.motionScheme.fastEffectsSpec()

@Composable
internal fun <T> defaultEffects(): FiniteAnimationSpec<T> = MaterialTheme.motionScheme.defaultEffectsSpec()

internal val KEY_CORNER = 10.dp
private val PRESSED_KEY_CORNER = 18.dp

/**
 * A key's fill and corner. Pressing darkens it at once, since the press is
 * the feedback, and rounds it on a spring; letting go fades the colour back
 * and springs the corner square again.
 */
@Composable
internal fun keyLook(pressed: Boolean, fill: Color, ink: Color): Pair<Color, Dp> {
  val color by animateColorAsState(
    if (pressed) lerpColor(fill, ink, 0.18f) else fill,
    if (pressed) snap() else fastEffects(),
    label = "key fill",
  )
  val corner by animateDpAsState(if (pressed) PRESSED_KEY_CORNER else KEY_CORNER, fastSpatial(), label = "key corner")
  return color to corner
}

/** 0 → 1 on a spring each time `key` changes: how far something has appeared. */
@Composable
internal fun rememberAppear(key: Any?): Animatable<Float, AnimationVector1D> {
  val spec = fastSpatial<Float>()
  val progress = remember(key) { Animatable(0f) }
  LaunchedEffect(key) { progress.animateTo(1f, spec) }
  return progress
}

/**
 * Grows out of `origin` from `from` of its size as `progress` appears. Read
 * in the layer, so a frame of it redraws and recomposes nothing.
 */
internal fun Modifier.popIn(
  progress: Animatable<Float, AnimationVector1D>,
  origin: TransformOrigin,
  from: Float = 0.6f,
): Modifier = graphicsLayer {
  val p = progress.value
  val scale = from + (1f - from) * p
  scaleX = scale
  scaleY = scale
  alpha = p.coerceIn(0f, 1f)
  transformOrigin = origin
}
