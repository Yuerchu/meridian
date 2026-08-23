import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { ArrowDownToLine, Link, Pencil, Pin, PinSlash, TrashBin } from '@gravity-ui/icons'

import { api } from '@/api'
import { can } from '@/lib/capabilities'
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
  key: 'pin' | 'rename' | 'attach-session' | 'export-sft' | 'export-dpo' | 'delete'
  icon: React.ComponentType<{ className?: string }>
  label: string
  variant?: 'default' | 'destructive'
  /**
   * Set makes the item unusable, and says why in the item itself.
   *
   * Both menus render this beside the label rather than as a tooltip: a
   * disabled item takes neither focus nor pointer events, so a tooltip on one
   * is text nobody can reach. Short on purpose — it sits at the end of a menu
   * row, and the long form belongs on the settings page that caused it.
   */
  disabledReason?: string
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

/**
 * Returns a builder rather than a list.
 *
 * There are two menus per row — a right-click one anchored at the cursor and a
 * button-anchored one for touch — and they open on different events. Handing
 * back a list for "whichever row is open" made them share that state: pressing
 * the button set it, which is also what the right-click menu reads to decide
 * whether *it* should be open, so one press produced two menus and the first
 * render of the popover had nothing in it. A builder has no state to share.
 */
export function useConversationActions(args: {
  onTogglePin: (id: string) => void
  onRequestRename: (id: string) => void
  onRequestDelete: (id: string) => void
  /**
   * Point a hosted conversation at a Claude Code session on disk.
   *
   * Absent means the platform cannot host one at all, and the item is left out
   * rather than disabled — a row that can only ever be greyed is clutter. Even
   * when present it is only offered on a `claude_code` conversation: an
   * ordinary one has no directory and no agent to resume.
   */
  onRequestAttachSession?: (id: string) => void
}): (conversation: Conversation) => RowAction[] {
  const { t } = useTranslation()
  const { onTogglePin, onRequestRename, onRequestDelete, onRequestAttachSession } = args

  // The picker returns a path on the machine the *user* is at, and the export
  // is written by the machine the app is on. Connected to another one those are
  // different disks, and the file would land where nobody goes looking.
  const exportBlocked = can.exportToDisk ? undefined : t('capability.localOnly')

  return useCallback(
    (conversation: Conversation) => [
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
      ...(onRequestAttachSession && conversation.agent_kind === 'claude_code'
        ? [
            {
              key: 'attach-session' as const,
              icon: Link,
              label: t('sessionPicker.attachAction'),
              run: () => onRequestAttachSession(conversation.id),
            },
          ]
        : []),
      {
        key: 'export-sft',
        icon: ArrowDownToLine,
        label: t('sidebar.exportSft'),
        disabledReason: exportBlocked,
        run: () => exportConversation(conversation, 'sft'),
      },
      {
        key: 'export-dpo',
        icon: ArrowDownToLine,
        label: t('sidebar.exportDpo'),
        disabledReason: exportBlocked,
        run: () => exportConversation(conversation, 'dpo'),
      },
      {
        key: 'delete',
        icon: TrashBin,
        label: t('chat.delete'),
        variant: 'destructive',
        run: () => onRequestDelete(conversation.id),
      },
    ],
    [t, exportBlocked, onTogglePin, onRequestRename, onRequestDelete, onRequestAttachSession],
  )
}

/** Same shape as {@link useConversationActions}, and for the same reason. */
export function useProjectActions(args: {
  onRequestRename: (id: string) => void
  onRequestDelete: (id: string) => void
}): (project: Project) => RowAction[] {
  const { t } = useTranslation()
  const { onRequestRename, onRequestDelete } = args

  return useCallback(
    (project: Project) => [
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
    ],
    [t, onRequestRename, onRequestDelete],
  )
}
