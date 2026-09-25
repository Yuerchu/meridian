import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { Select, SelectItem, Skeleton } from '@/components/base'
import { Check, ChevronRight, Plus } from '@keyline-icons/react/two-tone'

import { cx } from '@/utils/cx'

/**
 * The three shapes every settings panel was already drawing by hand.
 *
 * Extracted for one reason above tidiness: "narrow screens go full width" and
 * "a settings row is 52px tall" are single edits here and a dozen edits spread
 * across eleven files otherwise.
 *
 * There is deliberately no `SettingsField`: `TextField` is one, and
 * the panels use it directly. It wires the label to its control itself, which
 * is what retired the `useId` that every field used to carry, and its label is
 * left at Label's own weight rather than pushed back down to `text-caption-1-regular` — the
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
 * containing block for any `position: fixed` descendant. `ActionBar` is
 * one and does not portal itself — see the two call sites, which do it for it.
 */
export function SettingsPane({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="settings-pane"
      className={cx('@container/pane mx-auto w-full max-w-settings space-y-6', className)}
      {...props}
    />
  )
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
    <div data-slot="settings-header" className={cx('flex items-start justify-between gap-2', className)} {...props}>
      <div data-slot="settings-header-text" className="min-w-0">
        <h2 data-slot="settings-header-title" className="text-title-3-medium">
          {title}
        </h2>
        {subtitle && (
          <p data-slot="settings-header-subtitle" className="mt-1 text-caption-1-regular text-text-secondary">
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
 * A group of settings, drawn as one card with its rows dividing themselves.
 *
 * boardui's settings grammar, adopted whole: the left padding lives on the card
 * so each row's rule stops short of the card's edge rather than running into
 * it. Compose a section as a label above one of these.
 */
export function SettingsCard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="settings-card"
      className={cx('flex w-full flex-col rounded-2xl bg-background-secondary-default pl-3', className)}
      {...props}
    />
  )
}

/** The muted heading above a card. A heading, not a paragraph: it names a group. */
export function SettingsSectionLabel({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="settings-section-label"
      className={cx('w-full px-3 text-body-2-medium text-text-secondary', className)}
      {...props}
    />
  )
}

/** A label above a card, and the card. The shape every section has. */
export function SettingsSection({
  label,
  actions,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  label?: React.ReactNode
  /** Sits at the end of the label's line — a refresh, an add, a reset. */
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div data-slot="settings-section" className={cx('flex w-full flex-col gap-2', className)} {...props}>
      {(label || actions) && (
        <div data-slot="settings-section-bar" className="flex items-center justify-between gap-2">
          {label ? <SettingsSectionLabel>{label}</SettingsSectionLabel> : <span data-slot="settings-section-spacer" />}
          {actions && (
            <div data-slot="settings-section-actions" className="flex shrink-0 items-center gap-1">
              {actions}
            </div>
          )}
        </div>
      )}
      <SettingsCard>{children}</SettingsCard>
    </div>
  )
}

/**
 * A select sitting on a `SettingsRow`'s right: the registry's settings-general
 * `SELECT_TRIGGER`, the 32px compact trigger that hugs its value, rather than
 * the full-width form trigger a stacked field uses.
 */
export const SETTINGS_ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5'

export interface SettingsRowIds {
  labelId: string
  descriptionId?: string
}

/**
 * One setting: what it is on the left, the control for it on the right.
 *
 * The label is a `<p>` rather than a `<label>`, because what sits on the right
 * is not always a labellable control — it is sometimes a button, sometimes a
 * read-only value. So the control names itself, either with its own
 * `aria-label` or by taking the ids this hands to a function child. A row whose
 * control is anonymous reads as a switch with no name at all.
 *
 * `stacked` drops the control under the label below `@sm/pane`, for the ones
 * that cannot shrink — a URL field, a long text input. Ordinary rows stay a row
 * at every width because their controls are compact and the label wraps.
 */
export function SettingsRow({
  label,
  description,
  stacked,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  label: React.ReactNode
  description?: React.ReactNode
  stacked?: boolean
  children?: React.ReactNode | ((ids: SettingsRowIds) => React.ReactNode)
}) {
  const labelId = React.useId()
  const descriptionId = React.useId()
  return (
    <div
      data-slot="settings-row"
      className={cx(
        'flex min-h-[52px] w-full gap-4 border-b border-separator-border py-2.5 pr-2.5 last:border-b-0',
        stacked
          ? 'flex-col items-stretch gap-2 @sm/pane:flex-row @sm/pane:items-center @sm/pane:gap-4'
          : 'items-center justify-between',
        className,
      )}
      {...props}
    >
      <div data-slot="settings-row-text" className="flex min-w-0 flex-col">
        <p data-slot="settings-row-label" id={labelId} className="text-body-regular text-text-primary">
          {label}
        </p>
        {description && (
          <p
            data-slot="settings-row-description"
            id={descriptionId}
            className="text-body-2-regular text-text-secondary"
          >
            {description}
          </p>
        )}
      </div>
      <div data-slot="settings-row-control" className={cx('flex items-center gap-2', stacked ? 'min-w-0' : 'shrink-0')}>
        {typeof children === 'function'
          ? children({ labelId, descriptionId: description ? descriptionId : undefined })
          : children}
      </div>
    </div>
  )
}

/**
 * The grey read-only value beside a row's label.
 *
 * Not an input: it presents something stored rather than inviting an edit — a
 * device id, a path, an account. One step darker than the card it sits on, the
 * way a field would be.
 */
export function SettingsValueField({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="settings-value-field"
      className={cx(
        'flex h-8 w-[202px] max-w-full shrink-0 items-center gap-1 rounded-2lg bg-background-tertiary-default px-3',
        'truncate text-body-2-regular text-text-primary',
        className,
      )}
      {...props}
    />
  )
}

/**
 * One tappable line that goes somewhere: a row with a chevron.
 *
 * boardui's settings-modal nav item (application/settings/settings-modal.tsx):
 * `rounded-2lg p-2`, a 20px icon, `text-body-medium`, the selected row on
 * `background-secondary-hover` and the rest washing towards it on hover. A RAC
 * `Button` rather than the registry's native `<button>`, so `onPress` and the
 * focus ring come from React Aria like every other control here.
 */
export function SettingsNavRow({
  icon,
  label,
  value,
  trailing,
  isActive,
  className,
  ...props
}: Omit<AriaButtonProps, 'value' | 'className' | 'children'> & {
  className?: string
  icon?: React.ReactNode
  label: React.ReactNode
  /** Current setting, shown at the end of the row. */
  value?: React.ReactNode
  /** Defaults to a chevron when omitted. Pass `null` for no trailing content. */
  trailing?: React.ReactNode
  isActive?: boolean
}) {
  const labelId = React.useId()
  const valueId = React.useId()
  return (
    <AriaButton
      data-slot="settings-nav-row"
      data-active={isActive || undefined}
      // The label names the row and the value describes it, rather than both
      // running together into one name. Left to the default, a row reading
      // "gpt-5.6" beside "Priced" is announced as `gpt-5.6Priced`: the two
      // spans are adjacent, and nothing puts a boundary between them.
      aria-labelledby={labelId}
      aria-describedby={value ? valueId : undefined}
      // The background says which row is selected to anyone looking at it, and
      // said it to nobody else. Both places that had built this by hand were
      // missing it.
      aria-current={isActive || undefined}
      className={cx(
        'flex w-full cursor-pointer items-center gap-2 rounded-2lg p-2 text-left',
        'outline-none transition-colors duration-150 ease data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        isActive ? 'bg-background-secondary-hover' : 'data-[hovered]:bg-background-secondary-hover/60',
        className,
      )}
      {...props}
    >
      {icon && (
        <span
          data-slot="settings-nav-row-icon"
          className="flex size-5 shrink-0 items-center justify-center text-foreground-icon-secondary [&_svg]:size-5"
        >
          {icon}
        </span>
      )}
      <span
        data-slot="settings-nav-row-label"
        id={labelId}
        className={cx(
          'min-w-0 flex-1 truncate text-body-medium',
          isActive ? 'text-text-primary' : 'text-text-secondary',
        )}
      >
        {label}
      </span>
      {value && (
        <span
          data-slot="settings-nav-row-value"
          id={valueId}
          className="shrink-0 truncate text-caption-1-regular text-text-secondary"
        >
          {value}
        </span>
      )}
      {trailing === undefined ? <ChevronRight className="size-4 shrink-0 text-foreground-icon-secondary" /> : trailing}
    </AriaButton>
  )
}

/**
 * A row of a `SettingsCard` that opens something: a provider, a server.
 *
 * `SettingsNavRow` is the settings modal's *rail* row — its own rounded wash,
 * drawn on the page. A list of things inside a card is the other grammar
 * (settings-tools.tsx, `ServerRow`): the card's `pl-3`, `py-2.5 pr-2.5`, a
 * 52px floor and a rule under every row but the last. So the row carries no
 * fill of its own — a wash starting 12px in from the card's edge reads as a
 * mistake — and says "this goes somewhere" with the chevron, which steps up a
 * shade on hover.
 *
 * Named the way `SettingsNavRow` is: the label is the name, and the badge,
 * description and value describe it, so "Local tools" beside "stdio" is not
 * announced as one word.
 */
export function SettingsLinkRow({
  icon,
  label,
  badge,
  description,
  value,
  className,
  ...props
}: Omit<AriaButtonProps, 'value' | 'className' | 'children'> & {
  className?: string
  icon?: React.ReactNode
  label: React.ReactNode
  /** A tag beside the label — a transport, a kind. */
  badge?: React.ReactNode
  /** A second line under the label. */
  description?: React.ReactNode
  /** Shown at the end of the row, before the chevron. */
  value?: React.ReactNode
}) {
  const labelId = React.useId()
  const badgeId = React.useId()
  const descriptionId = React.useId()
  const valueId = React.useId()
  const describedBy = [badge && badgeId, description && descriptionId, value && valueId].filter(Boolean).join(' ')
  return (
    <AriaButton
      data-slot="settings-link-row"
      aria-labelledby={labelId}
      aria-describedby={describedBy || undefined}
      className={cx(
        'group/link-row flex min-h-[52px] w-full cursor-pointer items-center gap-2.5 py-2.5 pr-2.5 text-left',
        'border-b border-separator-border last:border-b-0',
        'outline-none data-[focus-visible]:rounded-lg data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
      {...props}
    >
      {icon && (
        <span data-slot="settings-link-row-icon" className="flex shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      <span data-slot="settings-link-row-text" className="flex min-w-0 flex-1 flex-col">
        <span data-slot="settings-link-row-title" className="flex min-w-0 items-center gap-2">
          <span
            id={labelId}
            data-slot="settings-link-row-label"
            className="truncate text-body-medium text-text-primary"
          >
            {label}
          </span>
          {badge && (
            <span id={badgeId} data-slot="settings-link-row-badge" className="flex shrink-0 items-center">
              {badge}
            </span>
          )}
        </span>
        {description && (
          <span
            id={descriptionId}
            data-slot="settings-link-row-description"
            className="truncate text-body-2-regular text-text-secondary"
          >
            {description}
          </span>
        )}
      </span>
      {value && (
        <span
          id={valueId}
          data-slot="settings-link-row-value"
          className="max-w-[40%] shrink-0 truncate text-body-2-regular text-text-secondary"
        >
          {value}
        </span>
      )}
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-foreground-icon-tertiary transition-colors duration-150 ease group-data-[hovered]/link-row:text-foreground-icon-secondary"
      />
    </AriaButton>
  )
}

/**
 * The last row of a list card, which adds one more.
 *
 * settings-tools.tsx's `NewServerRow`: a 32px tertiary tile holding a plus,
 * the action in `body-medium` and what it does underneath. The tile is what
 * answers the hover, as it is there. Named by its label alone — the
 * description is a description.
 */
export function SettingsAddRow({
  label,
  description,
  icon = <Plus className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />,
  className,
  ...props
}: Omit<AriaButtonProps, 'className' | 'children'> & {
  className?: string
  label: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
}) {
  const labelId = React.useId()
  const descriptionId = React.useId()
  return (
    <AriaButton
      data-slot="settings-add-row"
      aria-labelledby={labelId}
      aria-describedby={description ? descriptionId : undefined}
      className={cx(
        'group/add-row flex min-h-[52px] w-full cursor-pointer items-center gap-2.5 py-2.5 pr-2.5 text-left',
        'border-b border-separator-border last:border-b-0',
        'outline-none data-[focus-visible]:rounded-lg data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-border-focus-ring',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        data-slot="settings-add-row-tile"
        className={cx(
          'flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-tertiary-default',
          'transition-colors duration-150 ease group-data-[hovered]/add-row:bg-background-tertiary-hover',
        )}
      >
        {icon}
      </span>
      <span data-slot="settings-add-row-text" className="flex min-w-0 flex-col">
        <span id={labelId} data-slot="settings-add-row-label" className="truncate text-body-medium text-text-primary">
          {label}
        </span>
        {description && (
          <span
            id={descriptionId}
            data-slot="settings-add-row-description"
            className="truncate text-body-2-regular text-text-secondary"
          >
            {description}
          </span>
        )}
      </span>
    </AriaButton>
  )
}

/**
 * A small grey tag on a settings card: a kind, a transport, a category.
 *
 * settings-general.tsx's "Current plan" tag. Not `Chip`: every Chip fill is
 * `background-secondary`, which is exactly the card's own colour, so on a
 * card a Chip is text with no box. The registry answers that with the
 * tertiary step, and so does this.
 */
export function SettingsTag({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="settings-tag"
      className={cx(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-md bg-background-tertiary-default px-1.5 py-0.5',
        'text-caption-1-medium whitespace-nowrap text-text-secondary',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A quiet text action inside a list — "Show all 15", "Show output".
 *
 * settings-tools.tsx's `InlineAction`: tertiary ink stepping up to secondary
 * on hover, no fill, no box. A full-width grey button in that place outweighs
 * the rows it is only offering more of.
 */
export function SettingsInlineAction({
  className,
  ...props
}: Omit<AriaButtonProps, 'className'> & { className?: string }) {
  return (
    <AriaButton
      data-slot="settings-inline-action"
      className={cx(
        'w-fit cursor-pointer rounded-sm text-body-2-regular whitespace-nowrap text-text-secondary',
        'outline-none transition-colors duration-150 ease',
        'data-[hovered]:text-text-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        className,
      )}
      {...props}
    />
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
      className={cx('flex items-center gap-1 text-caption-1-regular text-status-success-soft-foreground', className)}
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
 * and `SettingsRow`'s 52px, so nothing moves when the real thing replaces it.
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
      className={cx('mx-auto w-full max-w-settings space-y-6', className)}
      {...props}
    >
      <div data-slot="settings-skeleton-header" className="space-y-2">
        <Skeleton className="h-5 w-40 rounded-md" />
        <Skeleton className="h-3 w-64 rounded-md" />
      </div>
      {/* One card of rows, sized to `SettingsRow`'s 52px rather than the 44px
          the navigation row used to be, so nothing moves when the real thing
          replaces it. */}
      <div data-slot="settings-skeleton-rows" className="space-y-1">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-[52px] w-full rounded-2xl" />
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
  (
    | { label: React.ReactNode; ariaLabel?: never; ariaLabelledBy?: never }
    | { label?: never; ariaLabel: string; ariaLabelledBy?: never }
    // Named by something already on screen — a `SettingsRow`'s label, which is
    // a `<p>` and cannot label a control itself.
    | { label?: never; ariaLabel?: never; ariaLabelledBy: string }
  )

/**
 * The seven-layer `Select` every panel was writing out by hand.
 *
 * The lines saved are not the reason. React Aria hands `onChange` a `Key | null`,
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
  ariaLabelledBy,
  description,
  placeholder,
  disabled,
  className,
  triggerClassName,
  itemClassName,
}: SettingsSelectProps<T>) {
  return (
    <Select
      data-slot="settings-select"
      className={className}
      label={label}
      description={description}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
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
  )
}
