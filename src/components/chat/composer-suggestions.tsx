import { useEffect, useRef, type CSSProperties } from 'react'
import { Folder, Terminal } from '@keyline-icons/react/two-tone'

import { fileIconUrl } from '@/lib/file-icon'
import { COMPOSER_COMMANDS } from '@/lib/composer-commands'
import { cx } from '@/utils/cx'
import { suggestionOptionId } from '@/hooks/use-composer-typeahead'

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

/**
 * The popup half of the composer's combobox (WAI-ARIA 1.2 combobox pattern).
 *
 * Focus never leaves the textarea: it owns the arrow keys, Enter and Escape,
 * and points at the highlighted row with `aria-activedescendant`. So this is a
 * plain `listbox` rather than React Aria's. That one is a focus-managing
 * collection, and with `selectionMode="single"` and a controlled selection it
 * spent a click on *selecting* the row — which the controlled keys then undid —
 * so `onAction` never ran and pressing a suggestion did nothing. Highlight is
 * not selection either: `aria-selected` marks the row the textarea points at,
 * `data-highlighted` styles it, and nothing here holds state of its own.
 */
export function ComposerSuggestions({
  id,
  items,
  activeIndex,
  onAction,
  ariaLabel,
}: {
  /** The listbox's DOM id; the textarea's `aria-controls` names it. */
  id: string
  items: ComposerSuggestion[]
  activeIndex: number
  onAction: (item: ComposerSuggestion) => void
  ariaLabel: string
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // Arrowing past the bottom of a scrolled list would otherwise highlight a row
  // nobody can see. `nearest` moves only when it has to.
  useEffect(() => {
    if (activeIndex < 0) return
    const row = listRef.current?.querySelector<HTMLElement>(`[id="${suggestionOptionId(id, activeIndex)}"]`)
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [id, activeIndex])

  if (items.length === 0) return null

  return (
    <div
      className="absolute inset-x-0 bottom-full z-40 mb-2 max-h-72 overflow-y-auto rounded-2xl bg-background-primary-default p-1.5 text-text-primary shadow-dropdown"
      // The textarea owns keyboard focus and aria-activedescendant. Pointer
      // selection must not blur it before the replacement has read its caret.
      onMouseDown={(event) => event.preventDefault()}
      data-slot="composer-suggestions"
    >
      <div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={ariaLabel}
        data-slot="composer-suggestions-list"
        className="max-h-68 overflow-y-auto outline-none"
      >
        {items.map((item, index) => {
          const icon = item.path && item.kind === 'file' ? fileIconUrl(item.path) : undefined
          const active = index === activeIndex
          return (
            <div
              key={item.id}
              id={suggestionOptionId(id, index)}
              role="option"
              aria-selected={active}
              data-highlighted={active || undefined}
              data-slot="composer-suggestion"
              onClick={() => onAction(item)}
              className="flex min-h-10 items-center rounded-xl px-2.5 py-2 outline-none hover:bg-background-primary-hover data-highlighted:bg-dropdown-item-hover-background"
            >
              <span
                data-slot="composer-suggestion-row"
                className={cx(
                  'w-full min-w-0 items-center gap-2.5 text-left',
                  item.kind === 'command' ? 'grid' : 'flex',
                )}
                style={item.kind === 'command' ? COMMAND_ROW_STYLE : undefined}
              >
                {icon ? (
                  <img data-slot="composer-suggestion-icon" src={icon} alt="" className="size-4 shrink-0" />
                ) : item.kind === 'directory' ? (
                  <Folder className="size-4 shrink-0 text-text-secondary" />
                ) : item.kind === 'command' ? (
                  <Terminal className="size-4 shrink-0 text-text-secondary" />
                ) : (
                  <span
                    data-slot="composer-suggestion-icon"
                    aria-hidden
                    className="size-4 shrink-0 text-center text-caption-1-regular text-text-secondary"
                  >
                    ·
                  </span>
                )}
                <span
                  data-slot="composer-suggestion-label"
                  className={cx('min-w-0 truncate text-left text-body-medium', item.kind !== 'command' && 'flex-1')}
                >
                  {item.label}
                </span>
                {item.detail && (
                  <span
                    data-slot="composer-suggestion-detail"
                    className={cx(
                      'min-w-0 truncate text-left text-caption-1-regular text-text-secondary',
                      item.kind !== 'command' && 'max-w-1/2',
                    )}
                  >
                    {item.detail}
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
