import type { CSSProperties } from 'react'
import { Folder, Terminal } from '@gravity-ui/icons'
import { ListBox } from '@/components/base'

import { fileIconUrl } from '@/lib/file-icon'
import { COMPOSER_COMMANDS } from '@/lib/composer-commands'
import { cn } from '@/lib/utils'

const COMMAND_LABEL_WIDTH = Math.max(...COMPOSER_COMMANDS.map((command) => command.name.length + 1))
const COMMAND_ROW_STYLE = {
  gridTemplateColumns: `1rem ${COMMAND_LABEL_WIDTH}ch minmax(0, 1fr)`,
} satisfies CSSProperties

export interface ComposerSuggestion {
  id: string
  kind: 'command' | 'file' | 'directory' | 'value'
  label: string
  detail?: string
  path?: string
}

export function ComposerSuggestions({
  items,
  activeIndex,
  onAction,
  ariaLabel,
}: {
  items: ComposerSuggestion[]
  activeIndex: number
  onAction: (item: ComposerSuggestion) => void
  ariaLabel: string
}) {
  if (items.length === 0) return null

  return (
    <div
      className="absolute inset-x-0 bottom-full z-40 mb-2 max-h-72 overflow-y-auto rounded-2xl bg-overlay p-1.5 text-overlay-foreground shadow-overlay"
      // The textarea owns keyboard focus and aria-activedescendant. Pointer
      // selection must not blur it before the replacement has read its caret.
      onMouseDown={(event) => event.preventDefault()}
      data-slot="composer-suggestions"
    >
      <ListBox
        aria-label={ariaLabel}
        selectionMode="single"
        selectedKeys={activeIndex >= 0 ? new Set([items[activeIndex]?.id]) : new Set()}
        onAction={(key) => {
          const item = items.find((candidate) => candidate.id === String(key))
          if (item) onAction(item)
        }}
        className="max-h-68 overflow-y-auto outline-none"
      >
        {items.map((item, index) => {
          const icon = item.path && item.kind === 'file' ? fileIconUrl(item.path) : undefined
          return (
            <ListBox.Item
              key={item.id}
              id={item.id}
              textValue={`${item.label} ${item.detail ?? ''}`}
              className={cn(
                'min-h-10 cursor-[var(--cursor-interactive)] rounded-xl px-2.5 py-2',
                index === activeIndex && 'bg-accent/10',
              )}
            >
              <span
                data-slot="composer-suggestion-row"
                className={cn(
                  'w-full min-w-0 items-center gap-2.5 text-left',
                  item.kind === 'command' ? 'grid' : 'flex',
                )}
                style={item.kind === 'command' ? COMMAND_ROW_STYLE : undefined}
              >
                {icon ? (
                  <img data-slot="composer-suggestion-icon" src={icon} alt="" className="size-4 shrink-0" />
                ) : item.kind === 'directory' ? (
                  <Folder className="size-4 shrink-0 text-muted" />
                ) : item.kind === 'command' ? (
                  <Terminal className="size-4 shrink-0 text-muted" />
                ) : (
                  <span
                    data-slot="composer-suggestion-icon"
                    aria-hidden
                    className="size-4 shrink-0 text-center text-xs text-muted"
                  >
                    ·
                  </span>
                )}
                <span
                  data-slot="composer-suggestion-label"
                  className={cn('min-w-0 truncate text-left text-sm font-medium', item.kind !== 'command' && 'flex-1')}
                >
                  {item.label}
                </span>
                {item.detail && (
                  <span
                    data-slot="composer-suggestion-detail"
                    className={cn(
                      'min-w-0 truncate text-left text-xs text-muted',
                      item.kind !== 'command' && 'max-w-1/2',
                    )}
                  >
                    {item.detail}
                  </span>
                )}
              </span>
            </ListBox.Item>
          )
        })}
      </ListBox>
    </div>
  )
}
