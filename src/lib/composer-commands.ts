export type ComposerCommandId = 'compact' | 'model' | 'thinking' | 'mode' | 'fast' | 'new' | 'settings' | 'help'

export type ComposerCommandBusyPolicy = 'immediate' | 'idle-only'

export interface ComposerCommandDescriptor {
  id: ComposerCommandId
  name: string
  aliases: readonly string[]
  descriptionKey: string
  argumentHint?: string
  busyPolicy: ComposerCommandBusyPolicy
  hosted: boolean
  requiresConversation?: boolean
  requiresFastCapability?: boolean
}

/**
 * One registry drives typeahead, help, exact parsing and dispatch. Command
 * handlers live with the state they mutate, but command spelling never does.
 */
export const COMPOSER_COMMANDS: readonly ComposerCommandDescriptor[] = [
  {
    id: 'compact',
    name: 'compact',
    aliases: [],
    descriptionKey: 'chat.command.compact',
    argumentHint: '[instructions]',
    busyPolicy: 'idle-only',
    hosted: false,
    requiresConversation: true,
  },
  {
    id: 'model',
    name: 'model',
    aliases: [],
    descriptionKey: 'chat.command.model',
    argumentHint: '[model]',
    busyPolicy: 'idle-only',
    hosted: true,
  },
  {
    id: 'thinking',
    name: 'thinking',
    aliases: ['effort'],
    descriptionKey: 'chat.command.thinking',
    argumentHint: '[level]',
    busyPolicy: 'idle-only',
    hosted: true,
  },
  {
    id: 'mode',
    name: 'mode',
    aliases: [],
    descriptionKey: 'chat.command.mode',
    argumentHint: '[work|plan]',
    busyPolicy: 'idle-only',
    hosted: true,
  },
  {
    id: 'fast',
    name: 'fast',
    aliases: [],
    descriptionKey: 'chat.command.fast',
    argumentHint: '[on|off]',
    busyPolicy: 'idle-only',
    hosted: true,
    requiresFastCapability: true,
  },
  {
    id: 'new',
    name: 'new',
    aliases: ['clear', 'reset'],
    descriptionKey: 'chat.command.new',
    busyPolicy: 'immediate',
    hosted: true,
    requiresConversation: true,
  },
  {
    id: 'settings',
    name: 'settings',
    aliases: ['config'],
    descriptionKey: 'chat.command.settings',
    argumentHint: '[section]',
    busyPolicy: 'immediate',
    hosted: true,
  },
  {
    id: 'help',
    name: 'help',
    aliases: [],
    descriptionKey: 'chat.command.help',
    busyPolicy: 'immediate',
    hosted: true,
  },
] as const

export interface ComposerCommandContext {
  hasConversation: boolean
  isHosted: boolean
  supportsFast: boolean
}

export function availableComposerCommands(context: ComposerCommandContext): ComposerCommandDescriptor[] {
  return COMPOSER_COMMANDS.filter((command) => {
    if (command.requiresConversation && !context.hasConversation) return false
    if (!command.hosted && context.isHosted) return false
    if (command.requiresFastCapability && !context.supportsFast) return false
    return true
  })
}

export function findComposerCommand(name: string, context: ComposerCommandContext): ComposerCommandDescriptor | null {
  const needle = name.toLowerCase()
  return (
    availableComposerCommands(context).find(
      (command) => command.name === needle || command.aliases.some((alias) => alias === needle),
    ) ?? null
  )
}

export function filterComposerCommands(query: string, context: ComposerCommandContext): ComposerCommandDescriptor[] {
  const needle = query.trim().toLowerCase()
  if (!needle || needle.includes(' ')) return availableComposerCommands(context)
  return availableComposerCommands(context)
    .map((command) => {
      const names = [command.name, ...command.aliases]
      const prefix = names.some((name) => name.startsWith(needle))
      const contains = names.some((name) => name.includes(needle))
      return { command, rank: prefix ? 0 : contains ? 1 : 2 }
    })
    .filter(({ rank }) => rank < 2)
    .sort((a, b) => a.rank - b.rank || a.command.name.localeCompare(b.command.name))
    .map(({ command }) => command)
}
