import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrashBin, TriangleExclamation } from '@gravity-ui/icons'
import { api } from '@/api'
import { Button, Checkbox, Chip, Disclosure, TextArea, Tooltip } from '@heroui/react'
import type { Memory } from '@/types'

/**
 * `--info` is a project extension: HeroUI has no `info` colour, so the property
 * its Chip reads is set directly. The same shape as the `--progress-circle-*`
 * override elsewhere, and for the same reason.
 */
export const INFO_CHIP = '[--chip-fg:var(--info-soft-foreground)]'

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

interface MemoryRowProps {
  memory: Memory
  checked: boolean
  onToggleCheck: () => void
  onChanged: () => void
}

export function MemoryRow({
  memory,
  checked,
  onToggleCheck,
  onChanged,
}: MemoryRowProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(memory.content)
  const [saving, setSaving] = useState(false)

  const ownerOnly = memory.visibility === 'owner_only'

  return (
    // The enclosing DisclosureGroup names the open row by this id, which is
    // what keeps one open at a time.
    <Disclosure
      id={memory.id}
      data-slot="memory-row"
      className="flex w-full flex-col rounded-lg border border-border"
    >
      {/* Wraps rather than overflows: a key, three or four badges and a date do
          not fit one line on a phone, and this scroller shares its horizontal
          overflow with the whole settings page — one long key here used to drag
          every other panel sideways with it. */}
      <div data-slot="memory-row-header" className="flex flex-wrap items-center gap-2 p-3">
        {/* No label of its own — the row's key names it. */}
        <Checkbox
          data-slot="memory-row-check"
          aria-label={memory.key}
          isSelected={checked}
          onChange={onToggleCheck}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
        {/* Only the chevron toggles: the checkbox and the row's own buttons are
            siblings, and a `<button>` cannot hold another one. The trigger is
            shrink-wrapped rather than a fixed square so that the indicator's own
            `ms-auto` has no free space to push against. */}
        <Disclosure.Heading>
          <Disclosure.Trigger
            data-slot="memory-row-toggle"
            aria-label={memory.key}
            className="inline-flex shrink-0 items-center rounded-lg p-2 text-muted transition-colors outline-none hover:bg-default hover:text-foreground focus-visible:bg-default"
          >
            <Disclosure.Indicator className="size-4" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <span className="min-w-0 truncate font-mono text-sm">{memory.key}</span>
        <Chip color="default">
          {memory.scope_type.replace('onebot_', '').replace('client_global', 'client')}
        </Chip>
        {/* `--info` is a project token with no HeroUI colour behind it, so the
            property the component reads is set directly rather than through a
            `color` that does not exist. */}
        <Chip className={INFO_CHIP}>{memory.origin}</Chip>
        <Chip className="text-muted">{memory.memory_type}</Chip>
        {ownerOnly && (
          <Tooltip delay={0}>
            {/* A Chip cannot take focus, so it needs the wrapper to become a
                tooltip trigger — unlike a real button, which would only gain a
                second, inert tab stop from one. */}
            <Tooltip.Trigger>
              <Chip color="warning">
                <TriangleExclamation className="size-3.5" />
                <Chip.Label>{t('settings.memory.ownerOnly')}</Chip.Label>
              </Chip>
            </Tooltip.Trigger>
            <Tooltip.Content>{t('settings.memory.ownerOnlyHint')}</Tooltip.Content>
          </Tooltip>
        )}
        <div className="flex-1" />
        <span className="text-xs text-muted">{formatDate(memory.updated_at)}</span>
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
          render={(props) => <div {...props} className="border-t border-border p-3" />}
        >
          <TextArea fullWidth
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="resize-y"
          />
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>
              {t('settings.memory.learnedAt')}: {formatDate(memory.created_at)}
            </span>
            {memory.source_session_id && (
              <span>
                {t('settings.memory.sourceChat')}: {memory.source_session_id}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              isDisabled={saving || draft === memory.content}
              onClick={async () => {
                setSaving(true)
                try {
                  await api.updateMemory(memory.id, draft)
                  onChanged()
                } finally {
                  setSaving(false)
                }
              }}
            >
              {t('common.save')}
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              isIconOnly
              onClick={async () => {
                await api.deleteMemories([memory.id])
                onChanged()
              }}
              data-slot="memory-row-delete"
            >
              <TrashBin className="text-danger" />
            </Button>
          </div>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}
