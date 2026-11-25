import './composer-suggestions.css'
import { useEffect, useRef, type CSSProperties } from 'react'
import { Folder, Terminal } from '@keyline-icons/react/two-tone'

import { fileIconUrl } from '@/lib/file-icon'
import { COMPOSER_COMMANDS } from '@/lib/composer-commands'
import { suggestionOptionId } from '@/hooks/use-composer-typeahead'
import { titleIfTruncated } from '@/lib/truncation'

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
      className="m-composer-suggestions"
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
        className="m-composer-suggestions__list"
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
              className="m-composer-suggestions__item"
            >
              <span
                data-slot="composer-suggestion-row"
                data-kind={item.kind}
                className="m-composer-suggestions__row"
                style={item.kind === 'command' ? COMMAND_ROW_STYLE : undefined}
              >
                {icon ? (
                  <img
                    data-slot="composer-suggestion-icon"
                    src={icon}
                    alt=""
                    className="m-composer-suggestions__icon"
                  />
                ) : item.kind === 'directory' ? (
                  <Folder aria-hidden className="m-composer-suggestions__icon" />
                ) : item.kind === 'command' ? (
                  <Terminal aria-hidden className="m-composer-suggestions__icon" />
                ) : (
                  <span data-slot="composer-suggestion-icon" aria-hidden className="m-composer-suggestions__bullet">
                    ·
                  </span>
                )}
                <span
                  data-slot="composer-suggestion-label"
                  onPointerEnter={titleIfTruncated}
                  className="m-composer-suggestions__label"
                >
                  {item.label}
                </span>
                {item.detail && (
                  <span
                    data-slot="composer-suggestion-detail"
                    onPointerEnter={titleIfTruncated}
                    className="m-composer-suggestions__detail"
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
