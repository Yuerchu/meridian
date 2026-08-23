/**
 * Whether the *primary* pointer is a finger.
 *
 * `pointer`, deliberately, and not the `any-pointer` that `touch-hitbox` in
 * `index.css` had to move to. The two ask different questions and only one
 * answer suits each. A hitbox wants "could a finger be reaching for this",
 * which is true of a touchscreen laptop whatever is plugged in. This wants
 * "is the keyboard a soft one" — the only caller is [`isSubmitKey`], where a
 * coarse answer makes Enter insert a newline instead of sending. Widened to
 * `any-pointer`, a touchscreen laptop with a real keyboard would stop being
 * able to send with Enter.
 */
export function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

export function isSubmitKey(e: React.KeyboardEvent): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isCoarsePointer()
}
