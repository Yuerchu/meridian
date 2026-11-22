import './memory-row.css'
import { Checkbox } from '@/components/yuerchu-ui/components/checkbox/checkbox'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, ChevronRight, TriangleAlert } from '@keyline-icons/react/two-tone'
import { api } from '@/api'
import { Button as AriaButton, Disclosure, DisclosurePanel } from 'react-aria-components'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import type { MemoryInfoResponse } from '@/types'
import { memoryOriginLabel, memoryScopeLabel, memoryTypeLabel } from './labels'
import { titleIfTruncated } from '@/lib/truncation'

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
    // what keeps one open at a time.
    <Disclosure id={memory.id} data-slot="memory-row" className="m-memory-row">
      <div data-slot="memory-row-header" className="m-memory-row__header">
        {/* No visible label — the row's key names the checkbox. */}
        <Checkbox data-slot="memory-row-check" aria-label={memory.key} isSelected={checked} onChange={onToggleCheck} />
        {/* The whole summary opens the row. The checkbox is a sibling, since a
            button cannot hold another control. */}
        <div className="m-memory-row__heading">
          <AriaButton
            slot="trigger"
            data-slot="memory-row-toggle"
            aria-label={memory.key}
            className="m-memory-row__toggle"
          >
            <span data-slot="memory-row-text" className="m-memory-row__text">
              <span data-slot="memory-row-summary" className="m-memory-row__summary">
                {summary}
              </span>
              {/* Three facts at three weights, so they stop reading as a row of
                  identical grey blocks: the kind is the one tag, where it lives
                  and how it was learned are plain text, and the key is the
                  quietest of all. */}
              <span data-slot="memory-row-meta" className="m-memory-row__meta">
                <Badge data-slot="memory-row-type" size="sm">
                  {memoryTypeLabel(t, memory.memory_type)}
                </Badge>
                {ownerOnly && (
                  <Badge data-slot="memory-row-owner" size="sm" tone="warning">
                    <TriangleAlert size={14} aria-hidden />
                    {t('settings.memory.ownerOnly')}
                  </Badge>
                )}
                <span data-slot="memory-row-scope">
                  {memoryScopeLabel(t, memory.scope_type)} · {memoryOriginLabel(t, memory.origin)}
                </span>
                <span data-slot="memory-row-key" onPointerEnter={titleIfTruncated} className="m-memory-row__key">
                  {memory.key}
                </span>
              </span>
            </span>
            <span data-slot="memory-row-date" className="m-memory-row__date">
              {date.format(new Date(memory.updated_at))}
            </span>
            <span className="m-memory-row__indicator" aria-hidden>
              <ChevronRight size={16} />
            </span>
          </AriaButton>
        </div>
      </div>

      {/* `min-height: 0` is load-bearing: the row is a flex column, and a flex
          item's default `min-height: auto` floors it at its content height. */}
      <DisclosurePanel className="m-memory-row__content">
        {/* Indented to the summary's edge — past the checkbox and its gap — so
            the editor reads as this row's, not as a new one. */}
        <div data-slot="memory-row-editor" className="m-memory-row__editor">
          {ownerOnly && (
            <p data-slot="memory-row-owner-hint" className="m-memory-row__owner-hint">
              {t('settings.memory.ownerOnlyHint')}
            </p>
          )}
          <TextArea
            aria-label={t('settings.memory.content')}
            name={`memoryContent-${memory.id}`}
            value={draft}
            onChange={(e) => setDraft(e)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                if (!saving && draft !== memory.content) void saveDraft()
              }
            }}
            rows={3}
          />
          <div data-slot="memory-row-actions" className="m-memory-row__actions">
            <span data-slot="memory-row-learned-at" className="m-memory-row__learned-at">
              {t('settings.memory.learnedAt')}: {date.format(new Date(memory.created_at))}
            </span>
            {memory.source_session_id && (
              <span data-slot="memory-row-source" onPointerEnter={titleIfTruncated} className="m-memory-row__source">
                {t('settings.memory.sourceChat')}:{' '}
                <span data-slot="memory-row-source-id" className="m-memory-row__source-id">
                  {memory.source_session_id}
                </span>
              </span>
            )}
            <div data-slot="memory-row-actions-spacer" className="m-memory-row__actions-spacer" />
            <TooltipTrigger>
              <Button
                variant="ghost"
                icon={<Bin />}
                size="sm"
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
              size="sm"
              variant="secondary"
              isDisabled={saving || draft === memory.content}
              onPress={() => void saveDraft()}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </DisclosurePanel>
    </Disclosure>
  )
}
