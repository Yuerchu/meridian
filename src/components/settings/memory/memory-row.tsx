import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrashBin, TriangleExclamation } from '@gravity-ui/icons'
import { api } from '@/api'
import { Button, Checkbox, Chip, Disclosure, TextArea, Tooltip, TooltipTrigger } from '@/components/base'
import type { MemoryInfoResponse } from '@/types'

/**
 * `--info` is a project extension: HeroUI has no `info` colour, so the property
 * its Chip reads is set directly. The same shape as the `--progress-circle-*`
 * override elsewhere, and for the same reason.
 */
export const INFO_CHIP = '[--chip-fg:var(--info-soft-foreground)]'

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

  return (
    // The enclosing DisclosureGroup names the open row by this id, which is
    // what keeps one open at a time.
    <Disclosure id={memory.id} data-slot="memory-row" className="flex w-full flex-col rounded-lg border border-border">
      {/* Wraps rather than overflows: a key, three or four badges and a date do
          not fit one line on a phone, and this scroller shares its horizontal
          overflow with the whole settings page — one long key here used to drag
          every other panel sideways with it. */}
      <div data-slot="memory-row-header" className="flex flex-wrap items-center gap-2 p-3">
        {/* No label of its own — the row's key names it. */}
        <Checkbox data-slot="memory-row-check" aria-label={memory.key} isSelected={checked} onChange={onToggleCheck} />
        {/* Only the chevron toggles: the checkbox and the row's own buttons are
            siblings, and a `<button>` cannot hold another one. The trigger is
            shrink-wrapped rather than a fixed square so that the indicator's own
            `ms-auto` has no free space to push against. */}
        <Disclosure.Heading>
          <TooltipTrigger delay={0}>
            <Disclosure.Trigger
              data-slot="memory-row-toggle"
              aria-label={memory.key}
              // Shrink-wrapped for the reason above, which leaves it at about
              // 32px — and since it is the only part of the row that opens it,
              // the hit area is expanded rather than the button.
              className="touch-hitbox inline-flex shrink-0 items-center rounded-lg p-2 text-muted transition-colors outline-none hover:bg-default hover:text-foreground focus-visible:bg-default"
            >
              <Disclosure.Indicator className="size-4" />
            </Disclosure.Trigger>
            <Tooltip>{memory.key}</Tooltip>
          </TooltipTrigger>
        </Disclosure.Heading>
        <span data-slot="memory-row-key" className="min-w-0 truncate font-mono text-sm">
          {memory.key}
        </span>
        <Chip color="default">{memory.scope_type.replace('onebot_', '').replace('client_global', 'client')}</Chip>
        {/* `--info` is a project token with no HeroUI colour behind it, so the
            property the component reads is set directly rather than through a
            `color` that does not exist. */}
        <Chip className={INFO_CHIP}>{memory.origin}</Chip>
        <Chip className="text-muted">{memory.memory_type}</Chip>
        {ownerOnly && (
          <TooltipTrigger delay={0}>
            <span data-slot="memory-owner-trigger" tabIndex={0} className="inline-flex">
              <Chip color="warning">
                <TriangleExclamation className="size-3.5" />
                {t('settings.memory.ownerOnly')}
              </Chip>
            </span>
            <Tooltip>{t('settings.memory.ownerOnlyHint')}</Tooltip>
          </TooltipTrigger>
        )}
        <div data-slot="memory-row-spacer" className="flex-1" />
        <span data-slot="memory-row-date" className="text-xs text-muted">
          {date.format(new Date(memory.updated_at))}
        </span>
      </div>

      {/* `min-h-0` is load-bearing: the card is a flex column, and a flex item's
          default `min-height: auto` floors it at its content height. */}
      <Disclosure.Content className="min-h-0 w-full">
        {/* Body, not a plain wrapper: it is what keeps the panel measurable, so
            without it the editor never collapses. The divider has to live on the
            body's outer wrapper — on the content it would show as a hairline
            while collapsed — and `render` is the only way to reach that
            wrapper's class. The padding it replaces is the same p-3 as before. */}
        <Disclosure.Body
          data-slot="memory-row-editor"
          className="space-y-2"
          render={(props) => <div {...props} data-slot="memory-row-body" className="border-t border-border p-3" />}
        >
          <TextArea
            fullWidth
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
            className="resize-y"
          />
          <div data-slot="memory-row-meta" className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span data-slot="memory-row-learned-at">
              {t('settings.memory.learnedAt')}: {date.format(new Date(memory.created_at))}
            </span>
            {memory.source_session_id && (
              <span data-slot="memory-row-source">
                {t('settings.memory.sourceChat')}: {memory.source_session_id}
              </span>
            )}
          </div>
          <div data-slot="memory-row-actions" className="flex items-center gap-2">
            <Button
              variant="secondary"
              isDisabled={saving || draft === memory.content}
              onPress={() => void saveDraft()}
            >
              {t('common.save')}
            </Button>
            <div data-slot="memory-row-actions-spacer" className="flex-1" />
            <TooltipTrigger delay={0}>
              <Button
                variant="ghost"
                isIconOnly
                aria-label={t('settings.memory.delete')}
                onPress={async () => {
                  await api.deleteMemories([memory.id])
                  onChanged()
                }}
                data-slot="memory-row-delete"
              >
                <TrashBin className="text-danger" />
              </Button>
              <Tooltip>{t('settings.memory.delete')}</Tooltip>
            </TooltipTrigger>
          </div>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}
