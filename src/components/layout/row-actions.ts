import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { ArrowDownToLine, Pencil, Pin, PinSlash, TrashBin } from '@gravity-ui/icons'

import { api } from '@/api'
import type { Conversation, Project } from '@/types'

/**
 * What can be done to a row, as data rather than as menu items.
 *
 * These seven were reachable only by right-click, which on a touch screen means
 * not reachable at all — the long press there belongs to the platform's own
 * text selection, and fighting it produced two menus on top of each other. The
 * list is expressed once here so the phone can render it as a sheet without
 * either side of the app drifting from the other.
 *
 * No JSX in this module: it exports hooks, and mixing the two costs fast
 * refresh.
 */
export interface RowAction {
  key: 'pin' | 'rename' | 'export-sft' | 'export-dpo' | 'delete'
  icon: React.ComponentType<{ className?: string }>
  label: string
  variant?: 'default' | 'destructive'
  run: () => void | Promise<void>
}

async function exportConversation(conv: Conversation, format: 'sft' | 'dpo') {
  // Cancelling rejects on Android rather than resolving to null, and the export
  // itself can fail after the picker has already closed — with the user looking
  // straight at the screen.
  const path = await save({
    defaultPath: `${conv.title ?? 'chat'}_${format}.jsonl`,
    filters: [{ name: 'JSONL', extensions: ['jsonl'] }],
  }).catch(() => null)
  if (!path) return
  await api.exportConversation(conv.id, format, path).catch(() => {})
}

/** Null when no row is open — hooks cannot be called conditionally. */
export function useConversationActions(args: {
  conversation: Conversation | null
  onTogglePin: (id: string) => void
  onRequestRename: (id: string) => void
  onRequestDelete: (id: string) => void
}): RowAction[] {
  const { t } = useTranslation()
  const { conversation, onTogglePin, onRequestRename, onRequestDelete } = args

  return useMemo(() => !conversation ? [] : [
    {
      key: 'pin',
      icon: conversation.is_pinned ? PinSlash : Pin,
      label: conversation.is_pinned ? t('contextMenu.unpin') : t('contextMenu.pin'),
      run: () => onTogglePin(conversation.id),
    },
    {
      key: 'rename',
      icon: Pencil,
      label: t('contextMenu.rename'),
      run: () => onRequestRename(conversation.id),
    },
    {
      key: 'export-sft',
      icon: ArrowDownToLine,
      label: t('sidebar.exportSft'),
      run: () => exportConversation(conversation, 'sft'),
    },
    {
      key: 'export-dpo',
      icon: ArrowDownToLine,
      label: t('sidebar.exportDpo'),
      run: () => exportConversation(conversation, 'dpo'),
    },
    {
      key: 'delete',
      icon: TrashBin,
      label: t('chat.delete'),
      variant: 'destructive',
      run: () => onRequestDelete(conversation.id),
    },
  ], [conversation, t, onTogglePin, onRequestRename, onRequestDelete])
}

export function useProjectActions(args: {
  project: Project | null
  onRequestRename: (id: string) => void
  onRequestDelete: (id: string) => void
}): RowAction[] {
  const { t } = useTranslation()
  const { project, onRequestRename, onRequestDelete } = args

  return useMemo(() => !project ? [] : [
    {
      key: 'rename',
      icon: Pencil,
      label: t('contextMenu.rename'),
      run: () => onRequestRename(project.id),
    },
    {
      key: 'delete',
      icon: TrashBin,
      label: t('chat.delete'),
      variant: 'destructive',
      run: () => onRequestDelete(project.id),
    },
  ], [project, t, onRequestRename, onRequestDelete])
}
