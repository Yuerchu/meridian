import { useState, type ComponentProps, type Key, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FileTreeProps extends Omit<ComponentProps<'div'>, 'children'> {
  size?: 'sm' | 'md'
  selectionMode?: 'none' | 'single' | 'multiple'
  expandedKeys?: Iterable<Key>
  onExpandedChange?: (keys: Set<Key>) => void
  renderEmptyState?: () => ReactNode
  children?: ReactNode
}

function FileTreeRoot({
  className,
  size: _size,
  selectionMode: _selectionMode,
  expandedKeys,
  onExpandedChange,
  renderEmptyState,
  children,
  ...props
}: FileTreeProps) {
  const [internalKeys, setInternalKeys] = useState<Set<Key>>(new Set())
  const keys = expandedKeys ? (expandedKeys instanceof Set ? expandedKeys : new Set(expandedKeys)) : internalKeys
  const setKeys = onExpandedChange ?? setInternalKeys

  const hasChildren = children != null && children !== false
  if (!hasChildren && renderEmptyState) return <>{renderEmptyState()}</>

  return (
    <FileTreeContext.Provider
      value={{
        expandedKeys: keys,
        toggleKey: (k) => {
          const next = new Set(keys)
          if (next.has(k)) next.delete(k)
          else next.add(k)
          setKeys(next)
        },
      }}
    >
      <div data-slot="file-tree" role="tree" {...props} className={cn('flex flex-col text-sm', className)}>
        {children}
      </div>
    </FileTreeContext.Provider>
  )
}

import { createContext, useContext } from 'react'

const FileTreeContext = createContext<{ expandedKeys: Set<Key>; toggleKey: (k: Key) => void }>({
  expandedKeys: new Set(),
  toggleKey: () => {},
})

interface FileTreeItemProps extends Omit<ComponentProps<'div'>, 'id' | 'title'> {
  id: string
  textValue?: string
  icon?: ReactNode | ((opts: { isExpanded: boolean }) => ReactNode)
  title?: ReactNode
  children?: ReactNode
}

function FileTreeItem({ id, className, icon, title, textValue, children, ...props }: FileTreeItemProps) {
  const { expandedKeys, toggleKey } = useContext(FileTreeContext)
  const hasChildren = children != null && children !== false
  const isExpanded = expandedKeys.has(id)

  return (
    <div
      data-slot="file-tree-item"
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-label={props['aria-label'] ?? textValue}
      {...props}
      className={cn('outline-none', className)}
    >
      <div
        data-slot="file-tree-item-row"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-default"
        onClick={hasChildren ? () => toggleKey(id) : undefined}
      >
        {hasChildren && (
          <span
            data-slot="file-tree-chevron"
            className={cn('text-muted transition-transform', isExpanded && 'rotate-90')}
          >
            <svg data-slot="file-tree-chevron-icon" className="size-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </span>
        )}
        {icon && (
          <span data-slot="file-tree-icon" className="flex shrink-0 text-muted">
            {typeof icon === 'function' ? icon({ isExpanded }) : icon}
          </span>
        )}
        {title && (
          <span data-slot="file-tree-title" className="min-w-0 truncate">
            {title}
          </span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div data-slot="file-tree-children" role="group" className="ps-4">
          {children}
        </div>
      )}
    </div>
  )
}

export const FileTree = Object.assign(FileTreeRoot, {
  Item: FileTreeItem,
})
