import './primitives.css'
import { Select } from '@/components/yuerchu-ui/components/select/select'
import { ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { Check, ChevronRight, Plus } from '@keyline-icons/react/two-tone'

import { titleIfTruncated } from '@/lib/truncation'

/**
 * The page-level pieces every settings panel shares: the pane and its width,
 * the header, the hand-rolled rows a card of settings rows can be made of (a
 * row that opens something, the row that adds one) and the small marks around
 * them. The card grammar itself — a group with its heading, a row with its
 * label and control — is the library's SettingsGroup / SettingsRow, which
 * names the row's control through React Aria context; use those directly.
 *
 * There is deliberately no `SettingsField`: `TextField` is one, and the panels
 * use it directly. It wires the label to its control itself, which is what
 * retired the `useId` that every field used to carry.
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
    <div data-slot="settings-pane" className={['m-settings-pane', className].filter(Boolean).join(' ')} {...props} />
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
    <div data-slot="settings-header" className={['m-settings-header', className].filter(Boolean).join(' ')} {...props}>
      <div data-slot="settings-header-text" className="m-settings-header__text">
        <h2 data-slot="settings-header-title" className="m-settings-header__title">
          {title}
        </h2>
        {subtitle && (
          <p data-slot="settings-header-subtitle" className="m-settings-header__subtitle">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div data-slot="settings-header-actions" className="m-settings-header__actions">
          {actions}
        </div>
      )}
    </div>
  )
}

/** The muted heading above a card. A heading, not a paragraph: it names a group. */
export function SettingsSectionLabel({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="settings-section-label"
      className={['m-settings-section-label', className].filter(Boolean).join(' ')}
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
      className={['m-settings-nav-row', className].filter(Boolean).join(' ')}
      {...props}
    >
      {icon && (
        <span data-slot="settings-nav-row-icon" className="m-settings-nav-row__icon">
          {icon}
        </span>
      )}
      <span data-slot="settings-nav-row-label" id={labelId} className="m-settings-nav-row__label">
        {label}
      </span>
      {value && (
        <span
          data-slot="settings-nav-row-value"
          onPointerEnter={titleIfTruncated}
          id={valueId}
          className="m-settings-nav-row__value"
        >
          {value}
        </span>
      )}
      {trailing === undefined ? (
        <ChevronRight size={16} aria-hidden className="m-settings-nav-row__chevron" />
      ) : (
        trailing
      )}
    </AriaButton>
  )
}

/**
 * A row of a settings card that opens something: a provider, a server.
 *
 * `SettingsNavRow` is the settings modal's *rail* row — its own rounded wash,
 * drawn on the page. A list of things inside a card is the other grammar: the
 * card's row padding, a rule under every row but the last, no fill of the
 * row's own, and "this goes somewhere" said by the chevron, which steps up a
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
  /** A tag beside the label — a transport, a kind. The library's Badge. */
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
      className={['m-settings-link-row', className].filter(Boolean).join(' ')}
      {...props}
    >
      {icon && (
        <span data-slot="settings-link-row-icon" className="m-settings-link-row__icon">
          {icon}
        </span>
      )}
      <span data-slot="settings-link-row-text" className="m-settings-link-row__text">
        <span data-slot="settings-link-row-title" className="m-settings-link-row__title">
          <span
            id={labelId}
            data-slot="settings-link-row-label"
            onPointerEnter={titleIfTruncated}
            className="m-settings-link-row__label"
          >
            {label}
          </span>
          {badge && (
            <span id={badgeId} data-slot="settings-link-row-badge" className="m-settings-link-row__badge">
              {badge}
            </span>
          )}
        </span>
        {description && (
          <span
            id={descriptionId}
            data-slot="settings-link-row-description"
            onPointerEnter={titleIfTruncated}
            className="m-settings-link-row__description"
          >
            {description}
          </span>
        )}
      </span>
      {value && (
        <span
          id={valueId}
          data-slot="settings-link-row-value"
          onPointerEnter={titleIfTruncated}
          className="m-settings-link-row__value"
        >
          {value}
        </span>
      )}
      <ChevronRight size={16} aria-hidden className="m-settings-link-row__chevron" />
    </AriaButton>
  )
}

/**
 * The last row of a list card, which adds one more.
 *
 * A tile holding a plus, the action in body text and what it does underneath.
 * The tile is what answers the hover, as it is there. Named by its label
 * alone — the description is a description.
 */
export function SettingsAddRow({
  label,
  description,
  icon = <Plus size={16} className="m-settings-add-row__glyph" aria-hidden />,
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
      className={['m-settings-add-row', className].filter(Boolean).join(' ')}
      {...props}
    >
      <span data-slot="settings-add-row-tile" className="m-settings-add-row__tile">
        {icon}
      </span>
      <span data-slot="settings-add-row-text" className="m-settings-add-row__text">
        <span
          id={labelId}
          data-slot="settings-add-row-label"
          onPointerEnter={titleIfTruncated}
          className="m-settings-add-row__label"
        >
          {label}
        </span>
        {description && (
          <span
            id={descriptionId}
            data-slot="settings-add-row-description"
            onPointerEnter={titleIfTruncated}
            className="m-settings-add-row__description"
          >
            {description}
          </span>
        )}
      </span>
    </AriaButton>
  )
}

/**
 * A quiet text action inside a list — "Show all 15", "Show output".
 *
 * Secondary ink stepping up to primary on hover, no fill, no box. A full-width
 * grey button in that place outweighs the rows it is only offering more of.
 */
export function SettingsInlineAction({
  className,
  ...props
}: Omit<AriaButtonProps, 'className'> & { className?: string }) {
  return (
    <AriaButton
      data-slot="settings-inline-action"
      className={['m-settings-inline-action', className].filter(Boolean).join(' ')}
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
      className={['m-saved-hint', className].filter(Boolean).join(' ')}
      {...props}
    >
      <Check size={14} aria-hidden className="m-saved-hint__icon" />
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
 * and a library settings row's height (12px padding over ~20px of text), so
 * nothing moves when the real thing replaces it.
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
      className={['m-settings-skeleton', className].filter(Boolean).join(' ')}
      {...props}
    >
      <div data-slot="settings-skeleton-header" className="m-settings-skeleton__header">
        <Skeleton width="10rem" />
        <Skeleton width="16rem" />
      </div>
      {/* One card of rows, sized to a library settings row — 12px padding
          each side of a ~20px line — so nothing moves when the real thing
          replaces it. */}
      <div data-slot="settings-skeleton-rows" className="m-settings-skeleton__rows">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} shape="rect" width="100%" height="44px" />
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
  size?: 'sm' | 'md' | 'lg'
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
 * A named, typed setting whose selection cannot be cleared.
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
  size,
}: SettingsSelectProps<T>) {
  return (
    <Select
      data-slot="settings-select"
      size={size}
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
    >
      {options.map((option) => (
        <ListBoxItem key={option.value} id={option.value} textValue={option.label}>
          {option.label}
        </ListBoxItem>
      ))}
    </Select>
  )
}
