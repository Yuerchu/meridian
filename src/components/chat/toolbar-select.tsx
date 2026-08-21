import type { ReactNode } from 'react'
import { ChevronDown } from '@gravity-ui/icons'
import { ListBox, Select } from '@heroui/react'

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
  isDisabled?: boolean
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
  isDisabled,
  className,
}: ToolbarSelectProps) {
  const current = choices.find((c) => c.value === value)

  return (
    <Select
      aria-label={ariaLabel}
      data-slot="toolbar-select"
      value={value ?? ''}
      isDisabled={isDisabled || choices.length === 0}
      onChange={(key) => {
        if (typeof key === 'string' && key) onSelect(key)
      }}
      className={cn('w-auto min-w-0', className)}
    >
      {/* `h-*`/`px-*` and `rounded-*` overridden together: HeroUI's own radius
          is much rounder than the composer it sits in, and changing the height
          without the radius is how a hover fill gets clipped at the corners. */}
      <Select.Trigger
        data-slot="toolbar-select-trigger"
        className={cn(
          'h-8 max-w-[180px] min-w-0 items-center gap-1 rounded-lg border-0 bg-transparent px-2',
          'text-sm font-normal shadow-none',
          'text-foreground hover:bg-default data-hovered:bg-default transition-colors',
        )}
      >
        <Select.Value className="min-w-0 flex-1 overflow-hidden">
          <span data-slot="toolbar-select-current" className="flex min-w-0 items-center gap-1.5">
            {current?.icon}
            <span className={cn('truncate', !current && 'text-muted')}>{current?.label ?? placeholder}</span>
          </span>
        </Select.Value>
        <Select.Indicator className="static my-0 size-4 shrink-0 text-muted">
          <ChevronDown />
        </Select.Indicator>
      </Select.Trigger>
      <Select.Popover
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
                <span className="truncate text-sm">{choice.label}</span>
                {choice.hint && <span className="truncate text-xs text-muted">{choice.hint}</span>}
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}
