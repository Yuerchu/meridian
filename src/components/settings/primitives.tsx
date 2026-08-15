import { Button, Description, Label, ListBox, Select, tv } from '@heroui/react'
import { ChevronRight } from '@gravity-ui/icons'

import { cn } from '@/lib/utils'

/**
 * The three shapes every settings panel was already drawing by hand.
 *
 * Extracted for one reason above tidiness: "narrow screens go full width" and
 * "a settings row is 44px tall" are single edits here and a dozen edits spread
 * across eleven files otherwise.
 *
 * There is deliberately no `SettingsField`: HeroUI's `TextField` is one, and
 * the panels use it directly. It wires the label to its control itself, which
 * is what retired the `useId` that every field used to carry, and its label is
 * left at HeroUI's own weight rather than pushed back down to `text-xs` — the
 * four slightly different ways that override had been written are what made
 * the case for stopping.
 */

const pane = tv({
  base: 'space-y-6',
  variants: {
    width: {
      /** A column of form controls. */
      default: 'max-w-lg',
      /** A list beside its detail. */
      wide: 'max-w-3xl',
    },
  },
  defaultVariants: { width: 'default' },
})

export function SettingsPane({
  width,
  className,
  ...props
}: React.ComponentProps<'div'> & { width?: 'default' | 'wide' }) {
  return <div data-slot="settings-pane" className={cn(pane({ width }), className)} {...props} />
}

export function SettingsHeader({
  title,
  subtitle,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div
      data-slot="settings-header"
      className={cn('flex items-start justify-between gap-2', className)}
      {...props}
    >
      <div className="min-w-0">
        <h2 className="text-lg font-medium">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}

/**
 * One tappable line in a settings list.
 *
 * A HeroUI `Button` underneath rather than `ListBox.Item`: the item ships
 * `rounded-2xl`, which overshoots the radius ladder our settings cards sit at,
 * and its click semantics run through a selection collection — while every
 * caller here (and the one test that guards them) drives plain clicks on text.
 *
 * `h-*`/`px-*` are overridden together with `rounded-*` on purpose. HeroUI's
 * base is `rounded-3xl`; changing the height without the radius is how a hover
 * fill ends up clipped at the corners of a rounded container.
 */
export function SettingsRow({
  icon,
  label,
  description,
  value,
  trailing,
  isActive,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'value'> & {
  icon?: React.ReactNode
  label: React.ReactNode
  description?: React.ReactNode
  /** Current setting, shown at the end of the row. */
  value?: React.ReactNode
  /** Defaults to a chevron when the row opens something. */
  trailing?: React.ReactNode
  isActive?: boolean
}) {
  return (
    <Button
      data-slot="settings-row"
      data-active={isActive || undefined}
      variant="ghost"
      className={cn(
        'h-auto min-h-11 w-full justify-start gap-3 rounded-lg px-3 py-2 font-normal',
        'data-active:bg-default data-active:text-default-foreground',
        className,
      )}
      {...props}
    >
      {icon && <span className="flex size-4 shrink-0 items-center justify-center text-muted">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="w-full truncate text-start text-sm">{label}</span>
        {description && (
          <span className="w-full truncate text-start text-xs text-muted">{description}</span>
        )}
      </span>
      {value && <span className="shrink-0 truncate text-xs text-muted">{value}</span>}
      {trailing ?? <ChevronRight className="size-4 shrink-0 text-muted" />}
    </Button>
  )
}

export interface SettingsSelectOption<T extends string> {
  value: T
  label: string
}

type SettingsSelectBase<T extends string> = {
  value: T
  options: readonly SettingsSelectOption<T>[]
  onChange: (value: T) => void
  description?: React.ReactNode
  placeholder?: string
  fullWidth?: boolean
  isDisabled?: boolean
  className?: string
  triggerClassName?: string
  /** Only the one caller that shrinks its rows needs this. */
  itemClassName?: string
}

/**
 * A named dropdown, either way of naming it — but one of the two.
 *
 * The union is the point: a `Select` with neither a `Label` nor an
 * `aria-label` renders fine and is anonymous to a screen reader, and two of the
 * twenty this replaces were exactly that. Here it does not compile.
 */
export type SettingsSelectProps<T extends string> = SettingsSelectBase<T> &
  ({ label: React.ReactNode; ariaLabel?: never } | { label?: never; ariaLabel: string })

/**
 * The seven-layer `Select` every panel was writing out by hand.
 *
 * The lines saved are not the reason. HeroUI hands `onChange` a `Key | null`,
 * and the twenty call sites had five different ways of narrowing it back —
 * `String(v)`, `if (v)`, `?? ''`, a cast, or some pair of those. A caller here
 * gets its own value type back and never sees the null: an empty selection is
 * not a value this control can produce, since every option carries one.
 */
export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  description,
  placeholder,
  fullWidth,
  isDisabled,
  className,
  triggerClassName,
  itemClassName,
}: SettingsSelectProps<T>) {
  return (
    <Select
      data-slot="settings-select"
      aria-label={ariaLabel}
      className={className}
      fullWidth={fullWidth}
      isDisabled={isDisabled}
      placeholder={placeholder}
      value={value}
      onChange={(key) => { if (key != null) onChange(String(key) as T) }}
    >
      {label && <Label>{label}</Label>}
      <Select.Trigger className={triggerClassName}>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
              className={itemClassName}
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      {description && <Description>{description}</Description>}
    </Select>
  )
}
