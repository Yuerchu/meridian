import { safeThreshold, triFrom, triTo } from './capabilities'

/**
 * `safeThreshold` has one job: agree with the backend. The stored value is
 * clamped by `safe_threshold` in `src-tauri/crates/core/src/agent/tokenizer.rs`,
 * so a disagreement here does not break a turn — it puts a number in the form
 * that the app will quietly ignore, which is worse than an error because the
 * user has no way to tell.
 *
 * These cases are that function's own arithmetic: output reserve capped at 32k,
 * headroom at a twentieth of the window capped at 8k, never below half.
 */
describe('safeThreshold', () => {
  it('reserves room for the reply and a little headroom', () => {
    // 128000 - 0 - 6400
    expect(safeThreshold(128_000, null)).toBe(121_600)
    // 200000 - 16000 - 8000
    expect(safeThreshold(200_000, 16_000)).toBe(176_000)
  })

  it('caps the reserve, so a huge output ceiling cannot eat the window', () => {
    // 256000 - min(128000, 32000) - min(12800, 8000)
    expect(safeThreshold(256_000, 128_000)).toBe(216_000)
  })

  /**
   * Below half the window, compacting cannot rescue the configuration — the
   * reply does not fit — and compacting every turn would hide that rather than
   * fix it.
   */
  it('never falls below half the window', () => {
    expect(safeThreshold(10_000, 32_000)).toBe(5_000)
  })

  it('divides the way the Rust does, towards zero', () => {
    // 100 - 0 - min(5, 8000) = 95, and half is 50.
    expect(safeThreshold(100, 0)).toBe(95)
  })
})

/**
 * Three states, not two. A checkbox cannot say "inherit", and the first save
 * from one would pin every capability to whatever it happened to be — after
 * which the model stops receiving catalog updates for ever.
 */
describe('tri-state capability overrides', () => {
  it('round-trips every state', () => {
    for (const value of [undefined, true, false] as const) {
      expect(triTo(triFrom(value))).toBe(value)
    }
  })

  it('reads an absent override as inherit', () => {
    expect(triFrom(undefined)).toBe('auto')
    expect(triTo('auto')).toBeUndefined()
  })
})
