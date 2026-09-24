import { fireEvent } from '@testing-library/react'

import { installIntersectionObserver, isNearObserver, type IntersectionControl } from '@/test/intersection'
import { MAX_PLAYING, SCROLL_SETTLE_MS, StickerPlayback, type PlaybackState } from './sticker-playback'

describe('StickerPlayback', () => {
  let io: IntersectionControl
  let host: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    io = installIntersectionObserver()
    host = document.createElement('div')
    document.body.append(host)
  })

  afterEach(() => {
    io.restore()
    host.remove()
    vi.useRealTimers()
  })

  /** `count` autoplaying stickers, in document order, each recording what it was told last. */
  function stickers(playback: StickerPlayback, count: number) {
    return Array.from({ length: count }, () => {
      const el = document.createElement('div')
      host.append(el)
      const seen: { state: PlaybackState } = { state: { near: false, playing: false } }
      const handle = playback.register(el, (state) => {
        seen.state = state
      })
      handle.update({ autoplay: true, explicit: false })
      return { el, seen, handle }
    })
  }

  function show(el: Element, on = true) {
    io.intersect(el, on)
  }

  it('plays what is on screen, and stops what leaves it', () => {
    const playback = new StickerPlayback()
    const [a, b] = stickers(playback, 2)
    show(a.el)
    expect(a.seen.state).toEqual({ near: true, playing: true })
    expect(b.seen.state.playing).toBe(false)

    // Scrolled past: still near (its still frame stays), no longer playing.
    io.intersect(a.el, false, (observer) => !isNearObserver(observer))
    expect(a.seen.state).toEqual({ near: true, playing: false })
    // Out of the neighbourhood: it lets go of the still frame too.
    io.intersect(a.el, false, isNearObserver)
    expect(a.seen.state).toEqual({ near: false, playing: false })
  })

  it(`plays at most ${MAX_PLAYING} at once, the first ones in document order`, () => {
    const playback = new StickerPlayback()
    const all = stickers(playback, MAX_PLAYING + 3)
    // Reported bottom-up, so registration order and report order both
    // disagree with the page.
    for (const sticker of [...all].reverse()) show(sticker.el)
    const playing = all.map((sticker) => sticker.seen.state.playing)
    expect(playing.filter(Boolean)).toHaveLength(MAX_PLAYING)
    expect(playing.slice(0, MAX_PLAYING).every(Boolean)).toBe(true)

    // One of the playing ones leaves, and the next in line takes its place.
    io.intersect(all[0].el, false, (observer) => !isNearObserver(observer))
    expect(all[MAX_PLAYING].seen.state.playing).toBe(true)
    expect(all[MAX_PLAYING + 1].seen.state.playing).toBe(false)
  })

  it('a sticker somebody points at plays past the cap', () => {
    const playback = new StickerPlayback({ maxPlaying: 1 })
    const [a, b] = stickers(playback, 2)
    show(a.el)
    show(b.el)
    expect(b.seen.state.playing).toBe(false)
    b.handle.update({ autoplay: true, explicit: true })
    expect(a.seen.state.playing).toBe(true)
    expect(b.seen.state.playing).toBe(true)
  })

  it('freezes everything while the reader scrolls and resumes once it settles', () => {
    const playback = new StickerPlayback()
    const [a, b] = stickers(playback, 2)
    show(a.el)
    show(b.el)
    expect(a.seen.state.playing).toBe(true)

    fireEvent.wheel(host)
    fireEvent.scroll(host)
    expect(a.seen.state).toEqual({ near: true, playing: false })
    expect(b.seen.state.playing).toBe(false)

    // A momentum scroll keeps extending the pause after the wheel is done.
    vi.advanceTimersByTime(SCROLL_SETTLE_MS - 50)
    fireEvent.scroll(host)
    vi.advanceTimersByTime(SCROLL_SETTLE_MS - 50)
    expect(a.seen.state.playing).toBe(false)

    vi.advanceTimersByTime(50)
    expect(a.seen.state.playing).toBe(true)
    expect(b.seen.state.playing).toBe(true)
  })

  it('does not pause for a scroll nobody made — the transcript following a stream', () => {
    const playback = new StickerPlayback()
    const [a] = stickers(playback, 1)
    show(a.el)
    fireEvent.scroll(host)
    expect(a.seen.state.playing).toBe(true)
  })

  it('does not fetch or decode a sticker that only passed by during a scroll', () => {
    const playback = new StickerPlayback()
    const [a, b] = stickers(playback, 2)
    show(a.el)
    fireEvent.wheel(host)
    fireEvent.scroll(host)

    io.intersect(b.el, true, isNearObserver)
    // Already near before the scroll: keeps its still frame.
    expect(a.seen.state.near).toBe(true)
    // Came near during it: not yet.
    expect(b.seen.state.near).toBe(false)

    vi.advanceTimersByTime(SCROLL_SETTLE_MS)
    expect(b.seen.state.near).toBe(true)
  })

  it('stops listening once the last sticker is gone', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const playback = new StickerPlayback()
    const [a, b] = stickers(playback, 2)
    a.handle.dispose()
    expect(remove).not.toHaveBeenCalledWith('scroll', expect.anything(), expect.anything())
    b.handle.dispose()
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true })
    remove.mockRestore()
  })
})
