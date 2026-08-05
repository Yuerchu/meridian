import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, Trash2, AlertTriangle } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@heroui/react'
import { TextArea } from '@heroui/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MemoryBadge } from './memory-badge'
import type { Memory } from '@/types'

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

interface MemoryRowProps {
  memory: Memory
  expanded: boolean
  onToggleExpand: () => void
  checked: boolean
  onToggleCheck: () => void
  onChanged: () => void
}

export function MemoryRow({
  memory,
  expanded,
  onToggleExpand,
  checked,
  onToggleCheck,
  onChanged,
}: MemoryRowProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(memory.content)
  const [saving, setSaving] = useState(false)

  const ownerOnly = memory.visibility === 'owner_only'

  return (
    <div data-slot="memory-row" className="rounded-lg border border-border">
      <div data-slot="memory-row-header" className="flex items-center gap-2 p-3">
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
        <Button variant="ghost" size="icon" onClick={onToggleExpand} data-slot="memory-row-toggle">
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <span className="font-mono text-sm">{memory.key}</span>
        <MemoryBadge tone="accent">
          {memory.scope_type.replace('onebot_', '').replace('client_global', 'client')}
        </MemoryBadge>
        <MemoryBadge tone="info">{memory.origin}</MemoryBadge>
        <MemoryBadge>{memory.memory_type}</MemoryBadge>
        {ownerOnly && (
          <Tooltip>
            <TooltipTrigger
              render={
                <MemoryBadge tone="warning">
                  <AlertTriangle className="mr-1 size-3" />
                  {t('settings.memory.ownerOnly')}
                </MemoryBadge>
              }
            />
            <TooltipContent>{t('settings.memory.ownerOnlyHint')}</TooltipContent>
          </Tooltip>
        )}
        <div className="flex-1" />
        <span className="text-xs text-muted">{formatDate(memory.updated_at)}</span>
      </div>

      {expanded && (
        <div data-slot="memory-row-editor" className="space-y-2 border-t border-border p-3">
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
              disabled={saving || draft === memory.content}
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
              size="icon"
              onClick={async () => {
                await api.deleteMemories([memory.id])
                onChanged()
              }}
              data-slot="memory-row-delete"
            >
              <Trash2 className="text-danger" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
