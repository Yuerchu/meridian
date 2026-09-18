import { useTranslation } from 'react-i18next'
import { Button, Description, Label, Select, SelectItem, Skeleton } from '@/components/base'
import { Check, ChevronRight } from '@gravity-ui/icons'

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

/**
 * A panel, and the box its contents ask about their width.
 *
 * The `pane` container is named rather than anonymous because the same editor
 * markup appears in three boxes of different widths — this pane, a
 * `SettingsSubPage` after a drilldown, and `SettingsDrilldown`'s sheet, which
 * React Aria portals to `body` and so is not a descendant of this at all. A name
 * lets a grid resolve against whichever one it actually landed in without
 * knowing which that is.
 *
 * Note that `container-type` implies `contain: layout`, which makes this the
 * containing block for any `position: fixed` descendant. Pro's `ActionBar` is
 * one and does not portal itself — see the two call sites, which do it for it.
 */
export function SettingsPane({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="settings-pane" className={cn('@container/pane space-y-6 max-w-lg', className)} {...props} />
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
    <div data-slot="settings-header" className={cn('flex items-start justify-between gap-2', className)} {...props}>
      <div data-slot="settings-header-text" className="min-w-0">
        <h2 data-slot="settings-header-title" className="text-lg font-medium">
          {title}
        </h2>
        {subtitle && (
          <p data-slot="settings-header-subtitle" className="mt-1 text-xs text-muted">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div data-slot="settings-header-actions" className="flex shrink-0 items-center gap-1">
          {actions}
        </div>
      )}
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
  value,
  trailing,
  isActive,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'value'> & {
  icon?: React.ReactNode
  label: React.ReactNode
  /** Current setting, shown at the end of the row. */
  value?: React.ReactNode
  /** Defaults to a chevron when omitted. Pass `null` for no trailing content. */
  trailing?: React.ReactNode
  isActive?: boolean
}) {
  return (
    <Button
      data-slot="settings-row"
      data-active={isActive || undefined}
      // The background says which row is selected to anyone looking at it, and
      // said it to nobody else. Both places that had built this by hand were
      // missing it.
      aria-current={isActive || undefined}
      variant="ghost"
      className={cn(
        'min-h-11 w-full justify-start gap-3 rounded-lg px-3 py-2 font-normal',
        'data-active:bg-default data-active:text-default-foreground',
        className,
      )}
      {...props}
    >
      {icon && (
        <span data-slot="settings-row-icon" className="flex size-4 shrink-0 items-center justify-center text-muted">
          {icon}
        </span>
      )}
      <span data-slot="settings-row-label" className="min-w-0 flex-1 truncate text-start text-sm">
        {label}
      </span>
      {value && (
        <span data-slot="settings-row-value" className="shrink-0 truncate text-xs text-muted">
          {value}
        </span>
      )}
      {trailing === undefined ? <ChevronRight className="size-4 shrink-0 text-muted" /> : trailing}
    </Button>
  )
}

/**
 * "Saved", for the second or two after it happens.
 *
 * Four panels drew this identically. `role="status"` is the one thing none of
 * them had: the whole point is to confirm something, and a confirmation that
 * only exists as green text confirms nothing to a screen reader.
 */
export function SavedHint({ className, ...props }: React.ComponentProps<'span'>) {
  const { t } = useTranslation()
  return (
    <span
      data-slot="saved-hint"
      role="status"
      className={cn('flex items-center gap-1 text-xs text-success-soft-foreground', className)}
      {...props}
    >
      <Check className="size-3.5" />
      {t('common.saved')}
    </span>
  )
}

/**
 * The panel, before its data arrives.
 *
 * Every settings panel opens the same way — a header over a list — and each of
 * them used to say `加载中…` on one line instead, which leaves the page looking
 * empty rather than busy and then reflows the whole thing when the rows land.
 * Drawing the shape that is coming costs nothing and makes the wait read as
 * part of the page.
 *
 * Sized to what it stands in for: the bars match `SettingsHeader`'s two lines
 * and `SettingsRow`'s 44px, so nothing moves when the real thing replaces it.
 *
 * `role="status"` with a label, because a screen reader gets nothing at all
 * from a column of grey boxes — it is the one thing the line of text it
 * replaces did better. `aria-busy` rather than announcing every row.
 */
export function SettingsSkeleton({ rows = 4, className, ...props }: React.ComponentProps<'div'> & { rows?: number }) {
  const { t } = useTranslation()
  return (
    <div
      data-slot="settings-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      className={cn('space-y-6 max-w-lg', className)}
      {...props}
    >
      <div data-slot="settings-skeleton-header" className="space-y-2">
        <Skeleton className="h-5 w-40 rounded-md" />
        <Skeleton className="h-3 w-64 rounded-md" />
      </div>
      <div data-slot="settings-skeleton-rows" className="space-y-1">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    </div>
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
  disabled?: boolean
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
  fullWidth: _fw,
  disabled,
  className,
  triggerClassName,
  itemClassName,
}: SettingsSelectProps<T>) {
  return (
    <div data-slot="settings-select" className={className}>
      {label && <Label>{label}</Label>}
      <Select
        aria-label={ariaLabel}
        isDisabled={disabled}
        placeholder={placeholder}
        selectedKey={value}
        onSelectionChange={(key) => {
          if (key != null) onChange(String(key) as T)
        }}
        triggerClassName={triggerClassName}
      >
        {options.map((option) => (
          <SelectItem key={option.value} id={option.value} textValue={option.label} className={itemClassName}>
            {option.label}
          </SelectItem>
        ))}
      </Select>
      {description && <Description>{description}</Description>}
    </div>
  )
}
