import { describe, expect, it } from 'vitest'

import { availableComposerCommands, filterComposerCommands, findComposerCommand } from './composer-commands'

const native = { hasConversation: true, isHosted: false, supportsFast: true }

describe('composer command registry', () => {
  it('uses the same registry for aliases and suggestions', () => {
    expect(findComposerCommand('effort', native)?.id).toBe('thinking')
    expect(findComposerCommand('clear', native)?.id).toBe('new')
    expect(filterComposerCommands('th', native).map((command) => command.id)).toEqual(['thinking'])
  })

  it('applies conversation, hosted and capability availability', () => {
    expect(
      availableComposerCommands({ ...native, hasConversation: false }).some((command) => command.id === 'new'),
    ).toBe(false)
    expect(availableComposerCommands({ ...native, isHosted: true }).some((command) => command.id === 'compact')).toBe(
      false,
    )
    expect(availableComposerCommands({ ...native, supportsFast: false }).some((command) => command.id === 'fast')).toBe(
      false,
    )
  })
})
