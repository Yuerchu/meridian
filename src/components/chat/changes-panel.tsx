import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@heroui/react'
import { FileTree } from '@heroui-pro/react/file-tree'
import { File, Folder, FolderOpen, Xmark } from '@gravity-ui/icons'

import { useConversationStore } from '@/stores/conversation-store'
import { fileIconUrl } from '@/lib/file-icon'
import { buildFileTree, touchedFiles, type FileNode, type TouchedFile, type TouchedOp } from '@/lib/touched-files'
import { cn } from '@/lib/utils'

/** Every directory in the tree, so a new one arrives already open. */
function branchIds(nodes: FileNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (!node.children) continue
    out.push(node.id)
    branchIds(node.children, out)
  }
  return out
}

const OP_CLASS: Record<TouchedOp, string> = {
  create: 'text-success-soft-foreground',
  modify: 'text-info-soft-foreground',
  delete: 'text-danger-soft-foreground',
}

/** A, M, D — the letters every diff viewer uses, so nothing has to explain them. */
const OP_LETTER: Record<TouchedOp, string> = { create: 'A', modify: 'M', delete: 'D' }

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
    <div data-slot="changes-panel" className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t('chat.changes.title')}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted">{files.length}</span>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label={t('common.close')}
          onClick={onClose}
          className="shrink-0"
        >
          <Xmark />
        </Button>
      </header>

      <FileTree
        aria-label={t('chat.changes.title')}
        size="sm"
        selectionMode="none"
        expandedKeys={expandedKeys}
        onExpandedChange={(keys) => {
          const open = new Set([...keys].map(String))
          setCollapsed(new Set(branches.filter((id) => !open.has(id))))
        }}
        renderEmptyState={() => t('chat.changes.empty')}
        className="min-h-0 flex-1"
      >
        {tree.map((node) => renderNode(node))}
      </FileTree>

      {/* Not a disclaimer for its own sake: a list of edited files that silently
          omits everything a command wrote is the kind of wrong that reads as
          right. */}
      <p className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted">{t('chat.changes.caveat')}</p>
    </div>
  )
}

/** The language icon where there is one, a plain sheet where there is not —
 *  `fileIconUrl` returns nothing for an extension it does not know. */
function FileGlyph({ name }: { name: string }) {
  const url = fileIconUrl(name)
  if (!url) return <File />
  return <img src={url} alt="" className="size-4 shrink-0" />
}

function renderNode(node: FileNode) {
  const op = node.file?.op
  return (
    <FileTree.Item
      key={node.id}
      id={node.id}
      textValue={node.name}
      icon={
        node.children ? ({ isExpanded }) => (isExpanded ? <FolderOpen /> : <Folder />) : <FileGlyph name={node.name} />
      }
      title={
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 flex-1 truncate" title={node.id}>
            {node.name}
          </span>
          {node.file && node.file.count > 1 && (
            <span className="shrink-0 text-xs tabular-nums text-muted">×{node.file.count}</span>
          )}
          {op && (
            <span aria-hidden="true" className={cn('shrink-0 font-mono text-xs', OP_CLASS[op])}>
              {OP_LETTER[op]}
            </span>
          )}
        </span>
      }
    >
      {node.children?.map((child) => renderNode(child))}
    </FileTree.Item>
  )
}
