import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import { visibleSettingsTabs } from '@/components/settings/tabs'
import { activeComposerToken, insertReferenceToken } from '@/lib/composer-intent'
import { filterComposerCommands, findComposerCommand, type ComposerCommandContext } from '@/lib/composer-commands'
import { allowedEfforts } from '@/lib/thinking'
import type { AcpConfigOption, ModelInfo, ProviderCapabilities } from '@/types'
import type { ComposerSuggestion } from '@/components/chat/composer-suggestions'

interface InternalSuggestion extends ComposerSuggestion {
  insertText?: string
  isDirectory?: boolean
}

interface ComposerTypeaheadOptions {
  value: string
  caret: number
  conversationId: string | null
  projectId?: string | null
  isHosted: boolean
  supportsFast: boolean
  providerId: string | null
  capabilities: ProviderCapabilities | null
  acpOptions: AcpConfigOption[]
  platform: string | null
}

function optionValues(option: AcpConfigOption | undefined): Array<{ value: string; name: string }> {
  if (!option || !('options' in option) || !Array.isArray(option.options)) return []
  return option.options.map((entry) => ({ value: entry.value, name: entry.name || entry.value }))
}

function commandOption(optionId: string, options: AcpConfigOption[]) {
  return options.find((option) => option.id === optionId || option.category === optionId)
}

export function useComposerTypeahead({
  value,
  caret,
  conversationId,
  projectId,
  isHosted,
  supportsFast,
  providerId,
  capabilities,
  acpOptions,
  platform,
}: ComposerTypeaheadOptions) {
  const { t } = useTranslation()
  const token = useMemo(() => activeComposerToken(value, caret), [value, caret])
  const [referenceItems, setReferenceItems] = useState<InternalSuggestion[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const commandContext = useMemo<ComposerCommandContext>(
    () => ({ hasConversation: conversationId !== null, isHosted, supportsFast }),
    [conversationId, isHosted, supportsFast],
  )

  useEffect(() => {
    if (isHosted || !providerId || token?.kind !== 'slash' || !/^model(?:\s|$)/i.test(token.query)) {
      setModels([])
      return
    }
    let alive = true
    void api
      .fetchProviderModels(providerId)
      .then((next) => {
        if (alive) setModels(next)
      })
      .catch(() => {
        if (alive) setModels([])
      })
    return () => {
      alive = false
    }
  }, [isHosted, providerId, token?.kind, token?.query])

  useEffect(() => {
    if (token?.kind !== 'reference' || (!conversationId && !projectId)) {
      setReferenceItems([])
      return
    }

    let alive = true
    const timer = window.setTimeout(() => {
      void api
        .workspaceSuggestRefs(token.query, {
          conversationId: conversationId ?? undefined,
          projectId: projectId ?? undefined,
          limit: 15,
        })
        .then((entries) => {
          if (!alive) return
          const ranked = entries.map<InternalSuggestion>((entry) => ({
            id: `reference:${entry.path}`,
            kind: entry.is_dir ? 'directory' : 'file',
            label: entry.name,
            detail: entry.path,
            path: entry.path,
            isDirectory: entry.is_dir,
          }))
          setReferenceItems(ranked)
        })
        .catch(() => {
          if (alive) setReferenceItems([])
        })
    }, 50)

    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [conversationId, projectId, token?.kind, token?.query])

  const slashItems = useMemo<InternalSuggestion[]>(() => {
    if (token?.kind !== 'slash') return []
    const firstSpace = token.query.search(/\s/u)
    if (firstSpace < 0) {
      return filterComposerCommands(token.query, commandContext).map((command) => ({
        id: `command:${command.id}`,
        kind: 'command',
        label: `/${command.name}`,
        detail: `${command.argumentHint ?? ''} ${t(command.descriptionKey)}`.trim(),
        insertText: `/${command.name}${command.argumentHint ? ' ' : ''}`,
      }))
    }

    const name = token.query.slice(0, firstSpace).toLowerCase()
    const fragment = token.query.slice(firstSpace).trim().toLowerCase()
    const command = findComposerCommand(name, commandContext)
    if (!command) return []

    let choices: Array<{ value: string; label: string }> = []
    if (command.id === 'model') {
      choices = isHosted
        ? optionValues(commandOption('model', acpOptions)).map((entry) => ({ value: entry.value, label: entry.name }))
        : models.map((model) => ({ value: model.id, label: model.name || model.id }))
    } else if (command.id === 'thinking') {
      choices = isHosted
        ? optionValues(commandOption('effort', acpOptions) ?? commandOption('thought_level', acpOptions)).map(
            (entry) => ({ value: entry.value, label: entry.name }),
          )
        : [
            'default',
            ...(capabilities?.supports_thinking_off === false ? [] : ['off']),
            ...allowedEfforts(capabilities),
          ].map((entry) => ({ value: entry, label: entry }))
    } else if (command.id === 'mode') {
      choices = isHosted
        ? optionValues(commandOption('mode', acpOptions)).map((entry) => ({ value: entry.value, label: entry.name }))
        : ['work', 'plan'].map((entry) => ({ value: entry, label: entry }))
    } else if (command.id === 'fast') {
      choices = ['on', 'off'].map((entry) => ({ value: entry, label: entry }))
    } else if (command.id === 'settings') {
      choices = visibleSettingsTabs(platform).map((tab) => ({ value: tab.id, label: t(tab.labelKey) }))
    }

    return choices
      .filter(
        (choice) =>
          !fragment || choice.value.toLowerCase().includes(fragment) || choice.label.toLowerCase().includes(fragment),
      )
      .slice(0, 15)
      .map((choice) => ({
        id: `value:${command.id}:${choice.value}`,
        kind: 'value',
        label: choice.label,
        detail: choice.value === choice.label ? undefined : choice.value,
        insertText: `/${command.name} ${choice.value}`,
      }))
  }, [acpOptions, capabilities, commandContext, isHosted, models, platform, t, token])

  const tokenKey = token ? `${token.kind}:${token.start}:${token.end}:${token.query}` : null
  const items = token?.kind === 'reference' ? referenceItems : slashItems
  const open = !!token && items.length > 0 && dismissedAt !== tokenKey

  useEffect(() => {
    setActiveIndex(0)
  }, [tokenKey, items.length])

  const dismiss = useCallback(() => setDismissedAt(tokenKey), [tokenKey])

  const accept = useCallback(
    (item: InternalSuggestion): { value: string; caret: number; keepOpen: boolean } | null => {
      if (!token) return null
      setDismissedAt(null)
      if (token.kind === 'reference' && item.path) {
        return insertReferenceToken(value, token, item.path, !!item.isDirectory)
      }
      if (token.kind === 'slash' && item.insertText) {
        const next = `${value.slice(0, token.start)}${item.insertText}${value.slice(token.end)}`
        return { value: next, caret: token.start + item.insertText.length, keepOpen: item.insertText.endsWith(' ') }
      }
      return null
    },
    [token, value],
  )

  return { token, items, open, activeIndex, setActiveIndex, dismiss, accept }
}
