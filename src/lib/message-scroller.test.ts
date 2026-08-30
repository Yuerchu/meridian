import { resolveScrollBehavior } from './message-scroller'

describe('resolveScrollBehavior', () => {
  it('turns smooth scrolling off when reduced motion is requested', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)

    expect(resolveScrollBehavior('smooth')).toBe('auto')
    expect(resolveScrollBehavior('auto')).toBe('auto')

    matchMedia.mockRestore()
  })
})
