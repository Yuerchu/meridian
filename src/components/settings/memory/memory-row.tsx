import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, ChevronRight, TriangleAlert } from '@keyline-icons/react/two-tone'
import { api } from '@/api'
import { Button, Checkbox, Disclosure, TextArea, Tooltip, TooltipTrigger } from '@/components/base'
import type { MemoryInfoResponse } from '@/types'
import { SettingsTag } from '../primitives'
import { memoryOriginLabel, memoryScopeLabel, memoryTypeLabel } from './labels'

/**
 * `--info` is a project extension: Chip has no `info` colour, so the property
 * it reads is set directly. The same shape as the `--progress-circle-*`
 * override elsewhere, and for the same reason.
 */
export const INFO_CHIP = '[--chip-fg:var(--color-status-info-soft-foreground)]'

interface MemoryRowProps {
  memory: MemoryInfoResponse
  checked: boolean
  onToggleCheck: () => void
  onChanged: () => void
}

export function MemoryRow({ memory, checked, onToggleCheck, onChanged }: MemoryRowProps) {
  const { t, i18n } = useTranslation()
  const [draft, setDraft] = useState(memory.content)
  const [saving, setSaving] = useState(false)
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'medium' }),
    [i18n.language, i18n.resolvedLanguage],
  )
  const saveDraft = async () => {
    setSaving(true)
    try {
      await api.updateMemory({ id: memory.id, content: draft })
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  const ownerOnly = memory.visibility === 'owner_only'
  // The first line of what was remembered is what a person scans for; the key
  // is a handle the model chose, and stays as a quieter identifier under it.
  const summary =
    memory.content
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? memory.key

  return (
    // The enclosing DisclosureGroup names the open row by this id, which is
    // what keeps one open at a time. A row of the card: the card's `pl-3`,
    // `py-2.5 pr-2.5` here and a rule under every row but the last
    // (settings-rows.tsx).
    <Disclosure
      id={memory.id}
      data-slot="memory-row"
      className="flex w-full flex-col border-b border-separator-border last:border-b-0"
    >
      <div data-slot="memory-row-header" className="flex items-start gap-2.5 py-2.5 pr-2.5">
        {/* No label of its own — the row's key names it. Nudged down to sit on
            the summary's first line rather than between the two. */}
        <Checkbox
          data-slot="memory-row-check"
          aria-label={memory.key}
          isSelected={checked}
          onChange={onToggleCheck}
          className="mt-0.5"
        />
        {/* The whole summary opens the row. The checkbox is a sibling, since a
            button cannot hold another control. */}
        <Disclosure.Heading className="min-w-0 flex-1">
          <Disclosure.Trigger
            data-slot="memory-row-toggle"
            aria-label={memory.key}
            className="min-w-0 items-start rounded-lg"
          >
            <span data-slot="memory-row-text" className="flex min-w-0 flex-1 flex-col gap-1">
              <span data-slot="memory-row-summary" className="truncate text-body-regular text-text-primary">
                {summary}
              </span>
              {/* Three facts at three weights, so they stop reading as a row of
                  identical grey blocks: the kind is the one tag, where it lives
                  and how it was learned are plain text, and the key is the
                  quietest of all. */}
              <span
                data-slot="memory-row-meta"
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption-1-regular text-text-secondary"
              >
                <SettingsTag data-slot="memory-row-type">{memoryTypeLabel(t, memory.memory_type)}</SettingsTag>
                {ownerOnly && (
                  <SettingsTag
                    data-slot="memory-row-owner"
                    className="bg-status-warning-soft text-status-warning-soft-foreground"
                  >
                    <TriangleAlert className="size-3.5" aria-hidden />
                    {t('settings.memory.ownerOnly')}
                  </SettingsTag>
                )}
                <span data-slot="memory-row-scope">
                  {memoryScopeLabel(t, memory.scope_type)} · {memoryOriginLabel(t, memory.origin)}
                </span>
                <span data-slot="memory-row-key" className="min-w-0 truncate font-mono text-text-secondary">
                  {memory.key}
                </span>
              </span>
            </span>
            <span data-slot="memory-row-date" className="shrink-0 pt-0.5 text-caption-1-regular text-text-secondary">
              {date.format(new Date(memory.updated_at))}
            </span>
            <Disclosure.Indicator className="pt-0.5">
              <ChevronRight />
            </Disclosure.Indicator>
          </Disclosure.Trigger>
        </Disclosure.Heading>
      </div>

      {/* `min-h-0` is load-bearing: the row is a flex column, and a flex item's
          default `min-height: auto` floors it at its content height. */}
      <Disclosure.Content className="min-h-0 w-full">
        {/* Indented to the summary's edge — past the checkbox and its gap — so
            the editor reads as this row's, not as a new one. */}
        <Disclosure.Body data-slot="memory-row-editor" className="flex flex-col gap-2 pr-2.5 pb-3 pl-[1.625rem]">
          {ownerOnly && (
            <p data-slot="memory-row-owner-hint" className="text-caption-1-regular text-status-warning-soft-foreground">
              {t('settings.memory.ownerOnlyHint')}
            </p>
          )}
          <TextArea
            aria-label={t('settings.memory.content')}
            name={`memoryContent-${memory.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                if (!saving && draft !== memory.content) void saveDraft()
              }
            }}
            rows={3}
          />
          <div data-slot="memory-row-actions" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span data-slot="memory-row-learned-at" className="text-caption-1-regular text-text-secondary">
              {t('settings.memory.learnedAt')}: {date.format(new Date(memory.created_at))}
            </span>
            {memory.source_session_id && (
              <span
                data-slot="memory-row-source"
                className="min-w-0 truncate text-caption-1-regular text-text-secondary"
              >
                {t('settings.memory.sourceChat')}:{' '}
                <span data-slot="memory-row-source-id" className="font-mono">
                  {memory.source_session_id}
                </span>
              </span>
            )}
            <div data-slot="memory-row-actions-spacer" className="flex-1" />
            <TooltipTrigger delay={0}>
              <Button
                variant="neutral"
                iconOnly
                leadingIcon={Bin}
                size="small"
                aria-label={t('settings.memory.delete')}
                onPress={async () => {
                  await api.deleteMemories([memory.id])
                  onChanged()
                }}
                data-slot="memory-row-delete"
              />
              <Tooltip>{t('settings.memory.delete')}</Tooltip>
            </TooltipTrigger>
            <Button
              size="small"
              variant="secondary"
              isDisabled={saving || draft === memory.content}
              onPress={() => void saveDraft()}
            >
              {t('common.save')}
            </Button>
          </div>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}
