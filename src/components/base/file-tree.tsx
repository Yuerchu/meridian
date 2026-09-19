import type { ReactNode } from 'react'
import {
  Button as AriaButton,
  Tree,
  TreeItem,
  TreeItemContent,
  type Key,
  type TreeItemProps,
  type TreeProps,
} from 'react-aria-components'
import { RiArrowRightSLine } from '@remixicon/react'
import { cx } from '@/utils/cx'

/**
 * Folders and files, on React Aria's `Tree`: arrow keys walk and open, one
 * tab stop, `aria-expanded` on branches, `expandedKeys` in the caller's hands.
 *
 *   <FileTree aria-label="Changes" expandedKeys={…} onExpandedChange={…}>
 *     <FileTree.Item id="src" textValue="src" title="src" icon={({ isExpanded }) => …}>
 *       <FileTree.Item id="src/a.ts" textValue="a.ts" title="a.ts" icon={<FileGlyph />} />
 *     </FileTree.Item>
 *   </FileTree>
 *
 * Child items are the branch's own children after its content, which is how
 * RAC nests a tree without a separate `children` collection prop.
 */

interface FileTreeProps<T extends object> extends Omit<TreeProps<T>, 'className' | 'style' | 'children'> {
  size?: 'sm' | 'md'
  className?: string
  children?: ReactNode
}

function FileTreeRoot<T extends object>({
  className,
  size = 'md',
  selectionMode = 'none',
  children,
  ...props
}: FileTreeProps<T>) {
  return (
    <Tree
      data-slot="file-tree"
      data-size={size}
      selectionMode={selectionMode}
      {...props}
      className={cx(
        'group/file-tree flex flex-col outline-none',
        'data-[empty]:px-2 data-[empty]:py-3 data-[empty]:text-caption-1-medium data-[empty]:text-text-tertiary',
        className,
      )}
    >
      {children}
    </Tree>
  )
}

interface FileTreeItemProps extends Omit<TreeItemProps, 'className' | 'style' | 'children' | 'id'> {
  id: Key
  icon?: ReactNode | ((opts: { isExpanded: boolean }) => ReactNode)
  title?: ReactNode
  className?: string
  children?: ReactNode
}

function FileTreeItem({ id, className, icon, title, children, ...props }: FileTreeItemProps) {
  return (
    <TreeItem
      id={id}
      data-slot="file-tree-item"
      {...props}
      className={cx(
        'group/item cursor-[var(--cursor-interactive)] outline-none',
        'data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
    >
      <TreeItemContent>
        {({ isExpanded, hasChildItems, level }) => (
          <div
            data-slot="file-tree-item-row"
            className="flex min-h-7 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-body-2-medium text-text-primary group-data-[hovered]/item:bg-background-secondary-hover group-data-[size=sm]/file-tree:min-h-6"
            style={{ paddingInlineStart: `${(level - 1) * 1 + 0.375}rem` }}
          >
            {hasChildItems ? (
              <AriaButton
                slot="chevron"
                data-slot="file-tree-chevron"
                className="flex size-4 shrink-0 cursor-[var(--cursor-interactive)] items-center justify-center rounded-sm text-foreground-icon-secondary outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring"
              >
                <RiArrowRightSLine
                  aria-hidden
                  className={cx('size-4 transition-transform duration-150', isExpanded && 'rotate-90')}
                />
              </AriaButton>
            ) : (
              <span aria-hidden className="size-4 shrink-0" />
            )}
            {icon && (
              <span data-slot="file-tree-icon" className="flex shrink-0 text-foreground-icon-secondary [&_svg]:size-4">
                {typeof icon === 'function' ? icon({ isExpanded }) : icon}
              </span>
            )}
            {title && (
              <span data-slot="file-tree-title" className="flex min-w-0 flex-1 items-center truncate">
                {title}
              </span>
            )}
          </div>
        )}
      </TreeItemContent>
      {children}
    </TreeItem>
  )
}

export const FileTree = Object.assign(FileTreeRoot, {
  Item: FileTreeItem,
})
