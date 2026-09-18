import type { ReactNode } from 'react'
import { ListBox } from '@/components/base'
import { InlineSelect } from '@/components/base'

import { cn } from '@/lib/utils'

export interface ToolbarChoice {
  value: string
  label: string
  /** Shown after the label, quieter. A provider name, or what a mode does. */
  hint?: string
  icon?: ReactNode
}

interface ToolbarSelectProps {
  /** Names the control for a screen reader. There is no visible label: the
   *  current value is the label, which is the whole point of it being here. */
  'aria-label': string
  /** What to show when nothing is selected yet. */
  placeholder: string
  value: string | null
  choices: ToolbarChoice[]
  onSelect: (value: string) => void
  disabled?: boolean
  className?: string
}

/**
 * A picker that lives in the composer's toolbar rather than behind its menu.
 *
 * The composer's options used to be one drill-down menu behind `+`, which is
 * the right shape for things you set once — a shell, an emoji pack — and the
 * wrong one for the model, which a person writing code changes several times an
 * hour and wants to *see* without opening anything.
 *
 * Deliberately not a second `ComposerMenu`: it renders whatever it is handed
 * and knows nothing about where the choices came from. A hosted session's come
 * from the agent over ACP and change under us; an ordinary conversation's come
 * from the provider list. Both are normalised to `ToolbarChoice` by their own
 * small adapter, so neither has to know about the other.
 */
export function ToolbarSelect({
  'aria-label': ariaLabel,
  placeholder,
  value,
  choices,
  onSelect,
  disabled,
  className,
}: ToolbarSelectProps) {
  const current = choices.find((c) => c.value === value)

  return (
    <InlineSelect
      aria-label={ariaLabel}
      data-slot="toolbar-select"
      value={value ?? ''}
      disabled={disabled || choices.length === 0}
      onChange={(key) => {
        if (typeof key === 'string' && key) onSelect(key)
      }}
      className={cn('w-auto min-w-0', className)}
    >
      {/* Pro supplies the inline-select interaction and density; the composer
          gives it a fixed 32px target. Height and radius move together so the
          toolbar's hover fill follows the surrounding shell. */}
      <InlineSelect.Trigger
        data-slot="toolbar-select-trigger"
        className={cn(
          'h-8 max-w-44 min-w-0 items-center gap-1 rounded-lg border-0 bg-transparent px-2',
          'text-sm font-normal shadow-none',
          'text-foreground hover:bg-default data-hovered:bg-default transition-colors',
        )}
      >
        <InlineSelect.Value className="min-w-0 flex-1 overflow-hidden">
          <span data-slot="toolbar-select-current" className="flex min-w-0 items-center gap-1.5">
            {current?.icon}
            <span data-slot="toolbar-select-label" className={cn('truncate', !current && 'text-muted')}>
              {current?.label ?? placeholder}
            </span>
          </span>
        </InlineSelect.Value>
        <InlineSelect.Indicator className="size-3.5 shrink-0" />
      </InlineSelect.Trigger>
      <InlineSelect.Popover
        data-slot="toolbar-select-popover"
        className="max-h-[min(420px,calc(100vh-6rem))] max-w-[calc(100vw-2rem)] overflow-y-auto"
        containerPadding={16}
        placement="top start"
      >
        <ListBox className="p-1">
          {choices.map((choice) => (
            <ListBox.Item key={choice.value} id={choice.value} textValue={`${choice.label} ${choice.hint ?? ''}`}>
              <span data-slot="toolbar-select-option" className="flex min-w-0 flex-1 items-center gap-2">
                {choice.icon}
                <span data-slot="toolbar-select-option-label" className="truncate text-sm">
                  {choice.label}
                </span>
                {choice.hint && (
                  <span data-slot="toolbar-select-option-hint" className="truncate text-xs text-muted">
                    {choice.hint}
                  </span>
                )}
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </InlineSelect.Popover>
    </InlineSelect>
  )
}
