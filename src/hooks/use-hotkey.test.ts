import { matchesHotkey, parseHotkey } from './use-hotkey'

const press = (init: Partial<KeyboardEventInit> & { key: string }) =>
  new KeyboardEvent('keydown', init)

describe('parseHotkey', () => {
  it('reads modifiers in any order and any spelling', () => {
    expect(parseHotkey('mod+k')).toEqual({ key: 'k', mod: true, ctrl: false, meta: false, shift: false, alt: false })
    expect(parseHotkey('Shift + Alt + K')).toEqual(parseHotkey('alt+shift+k'))
    expect(parseHotkey('cmd+k')).toEqual(parseHotkey('command+k'))
    expect(parseHotkey('control+k')).toEqual(parseHotkey('ctrl+k'))
  })

  it('rejects a combo that is only modifiers', () => {
    // A typo, not a state worth representing — binding it would swallow every
    // press of that modifier.
    expect(parseHotkey('mod+shift')).toBeNull()
    expect(parseHotkey('')).toBeNull()
  })
})

describe('matchesHotkey', () => {
  const modK = parseHotkey('mod+k')!

  it('takes either Command or Control for mod', () => {
    expect(matchesHotkey(press({ key: 'k', metaKey: true }), modK)).toBe(true)
    expect(matchesHotkey(press({ key: 'k', ctrlKey: true }), modK)).toBe(true)
  })

  it('refuses the bare key', () => {
    expect(matchesHotkey(press({ key: 'k' }), modK)).toBe(false)
  })

  it('refuses a modifier the combo did not ask for', () => {
    // Otherwise mod+shift+k would also fire mod+k, and the two could never be
    // bound to different things.
    expect(matchesHotkey(press({ key: 'k', metaKey: true, shiftKey: true }), modK)).toBe(false)
    expect(matchesHotkey(press({ key: 'k', ctrlKey: true, altKey: true }), modK)).toBe(false)
  })

  it('is case-insensitive about the key', () => {
    // Shift is not held here: some layouts report an uppercase `key` anyway.
    expect(matchesHotkey(press({ key: 'K', metaKey: true }), modK)).toBe(true)
  })

  it('distinguishes ctrl from meta when the combo names one', () => {
    const ctrlK = parseHotkey('ctrl+k')!
    expect(matchesHotkey(press({ key: 'k', ctrlKey: true }), ctrlK)).toBe(true)
    expect(matchesHotkey(press({ key: 'k', metaKey: true }), ctrlK)).toBe(false)
  })
})
