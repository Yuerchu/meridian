import './changes-panel.css'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Tree, TreeItem } from '@/components/yuerchu-ui/components/tree/tree'
import { X } from '@keyline-icons/react/two-tone'

import { useConversationStore } from '@/stores/conversation-store'
import { fileIconUrl } from '@/lib/file-icon'
import { buildFileTree, touchedFiles, type FileNode, type TouchedFile, type TouchedOp } from '@/lib/touched-files'

/** Every directory in the tree, so a new one arrives already open. */
function branchIds(nodes: FileNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (!node.children) continue
    out.push(node.id)
    branchIds(node.children, out)
  }
  return out
}

/** A, M, D — the letters every diff viewer uses, so nothing has to explain them. */
const OP_LETTER: Record<TouchedOp, string> = { create: 'A', modify: 'M', delete: 'D' }

const OP_LABEL: Record<TouchedOp, string> = {
  create: 'chat.changes.status.created',
  modify: 'chat.changes.status.modified',
  delete: 'chat.changes.status.deleted',
}

/**
 * What this conversation changed on disk, as a tree.
 *
 * Read out of the transcript rather than from the backend. There *is* a
 * per-conversation file→diff aggregate on the Rust side, but it holds only
 * staged writes waiting for approval, lives in memory and dies with the
 * process — a second source of truth that would disagree with the blocks this
 * reads from. See `lib/touched-files.ts` for what counts as a change.
 *
 * The title says "through the file tools" and means it: `run_command` can write
 * anything and no reading of a shell command will say what. A panel that
 * claimed to list every change would be wrong in a way nobody could see.
 */
export function ChangesPanel({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const messages = useConversationStore((s) => s.sessions[conversationId]?.messages)
  const files = useMemo(() => touchedFiles(messages ?? []), [messages])
  return <ChangesPanelView files={files} onClose={onClose} />
}

/** Split from the store so the playground can render it without a session. */
export function ChangesPanelView({ files, onClose }: { files: TouchedFile[]; onClose: () => void }) {
  const { t } = useTranslation()
  const tree = useMemo(() => buildFileTree(files), [files])
  const branches = useMemo(() => branchIds(tree), [tree])

  // Closed rather than open is what is tracked, so a directory that appears
  // mid-conversation arrives expanded instead of having to be found and opened.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const expandedKeys = useMemo(() => branches.filter((id) => !collapsed.has(id)), [branches, collapsed])

  return (
    <div data-slot="changes-panel" className="m-changes">
      <header data-slot="changes-panel-header" className="m-changes__header">
        <span data-slot="changes-panel-title" className="m-changes__title">
          {t('chat.changes.title')}
        </span>
        <span data-slot="changes-panel-count" className="m-changes__count">
          {files.length}
        </span>
        <TooltipTrigger>
          <Button icon={<X />} variant="ghost" size="sm" aria-label={t('common.close')} onPress={onClose} />
          <Tooltip>{t('common.close')}</Tooltip>
        </TooltipTrigger>
      </header>

      {/* The tree grows with its content and leaves scrolling to its
          container: here it is the panel's body. */}
      <div data-slot="changes-panel-body" className="m-changes__body">
        <Tree
          aria-label={t('chat.changes.title')}
          size="sm"
          selectionMode="none"
          expandedKeys={expandedKeys}
          onExpandedChange={(keys) => {
            const open = new Set([...keys].map(String))
            setCollapsed(new Set(branches.filter((id) => !open.has(id))))
          }}
          renderEmptyState={() => <div className="m-changes__empty">{t('chat.changes.empty')}</div>}
        >
          {tree.map((node) => renderNode(node, t))}
        </Tree>
      </div>

      {/* Not a disclaimer for its own sake: a list of edited files that silently
          omits everything a command wrote is the kind of wrong that reads as
          right. */}
      <p data-slot="changes-panel-caveat" className="m-changes__caveat">
        {t('chat.changes.caveat')}
      </p>
    </div>
  )
}

/** The language icon where there is one; a file the icon set does not know
 *  gets none, and the tree keeps the column so the labels still line up. */
function fileGlyph(name: string) {
  const url = fileIconUrl(name)
  return url ? <img data-slot="changes-file-glyph" src={url} alt="" className="m-changes__glyph" /> : undefined
}

function renderNode(node: FileNode, t: TFunction) {
  const op = node.file?.op
  const count = node.file?.count ?? 0
  const accessibleName = op ? `${node.name}, ${t(OP_LABEL[op])}` : node.name
  return (
    <TreeItem
      key={node.id}
      id={node.id}
      label={node.name}
      aria-label={accessibleName}
      textValue={accessibleName}
      icon={node.children ? undefined : fileGlyph(node.name)}
      // The tree's only trailing slot, used here for text rather than controls.
      actions={
        count > 1 || op ? (
          <span data-slot="changes-node-meta" className="m-changes__meta">
            {count > 1 && (
              <span data-slot="changes-node-count" className="m-changes__multiplier">
                ×{count}
              </span>
            )}
            {op && (
              <span data-slot="changes-node-op" aria-hidden="true" className="m-changes__op" data-op={op}>
                {OP_LETTER[op]}
              </span>
            )}
          </span>
        ) : undefined
      }
    >
      {node.children?.map((child) => renderNode(child, t))}
    </TreeItem>
  )
}
