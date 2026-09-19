import type { ComponentProps, ReactNode, Ref } from 'react'
import {
  Button as AriaButton,
  Group as AriaGroup,
  Input as AriaInput,
  SearchField as AriaSearchField,
  TextArea as AriaTextArea,
  type ButtonProps as AriaButtonProps,
  type InputProps as AriaInputProps,
  type SearchFieldProps as AriaSearchFieldProps,
  type TextAreaProps as AriaTextAreaProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { InputBase, TextField, type InputBaseProps, type TextFieldProps } from './input/input'
import { TextareaBase, type TextareaBaseProps } from './textarea/textarea'

/**
 * The text controls, all on the registry's field shell (`input/input.tsx`,
 * `textarea/textarea.tsx`) so a form composes as boardui intends:
 *
 *   <TextField isInvalid={…}>
 *     <Label>Name</Label>
 *     <Input value={…} onChange={…} />
 *     <Description>…</Description>
 *   </TextField>
 *
 * Every control here is React Aria's element, which is what makes the
 * composition work: `TextField` publishes label, description and validation
 * state through context and only RAC's `Input`/`TextArea` read it. A native
 * `<input>` in the same place looks identical and is labelled by nothing.
 *
 * `SearchField` is the same shell with the search affordances: RAC's
 * `SearchField` owns the value, Escape clears it, and the clear button is any
 * RAC button inside it (it receives its handler through context too).
 */

export { TextField, type TextFieldProps }

/**
 * Which surface the field sits on, which decides its fill. boardui's field is
 * the tertiary well, and in the dark theme that is the same neutral as the
 * primary surface — a field on a card, a modal or this app's main panel is
 * invisible until hovered. boardui's own settings page answers that by giving a
 * field on the lighter surface the secondary fill (`settings-storage`), and
 * that is the rule here: the well is always one step darker than what it is on.
 *
 * `primary` is the default because that is where almost every field in this
 * app lives; the sidebar's forms say `secondary`.
 */
export type FieldSurface = 'primary' | 'secondary'

const WELL: Record<FieldSurface, string> = {
  primary: 'bg-background-secondary-default',
  secondary: 'bg-background-tertiary-default',
}

export interface InputProps extends InputBaseProps {
  surface?: FieldSurface
}

export function Input({ surface = 'primary', fieldClassName, ...props }: InputProps) {
  return <InputBase data-slot="input" fieldClassName={cx(WELL[surface], fieldClassName)} {...props} />
}

export interface TextAreaProps extends TextareaBaseProps {
  surface?: FieldSurface
}

export function TextArea({ surface = 'primary', fieldClassName, ...props }: TextAreaProps) {
  return <TextareaBase data-slot="textarea" fieldClassName={cx(WELL[surface], fieldClassName)} {...props} />
}

/* ------------------------------------------------------------ SearchField */

interface SearchFieldRootProps extends Omit<AriaSearchFieldProps, 'className'> {
  className?: string
  surface?: FieldSurface
  children?: ReactNode
}

function SearchFieldRoot({ className, surface = 'primary', children, ...props }: SearchFieldRootProps) {
  return (
    <AriaSearchField
      data-slot="search-field"
      data-surface={surface}
      {...props}
      className={cx('group/search flex w-full flex-col gap-1', className)}
    >
      {children}
    </AriaSearchField>
  )
}

/** The field shell; the same ring and fill rules as `InputBase`. */
function SearchFieldGroup({ className, ...props }: ComponentProps<typeof AriaGroup>) {
  return (
    <AriaGroup
      data-slot="search-field-group"
      {...props}
      className={cx(
        'flex w-full items-center gap-2 rounded-2lg p-2 text-foreground-icon-tertiary',
        'bg-background-secondary-default group-data-[surface=secondary]/search:bg-background-tertiary-default',
        'ring-2 ring-transparent ring-inset transition-[background-color,box-shadow,color] duration-[var(--input-transition-ms)] ease',
        'data-[hovered]:ring-border-button-hover data-[focus-within]:ring-border-button-active',
        'group-data-[disabled]/search:bg-input-disabled-background',
        className as string,
      )}
    />
  )
}

function SearchFieldInput({ className, ...props }: Omit<AriaInputProps, 'className'> & { className?: string }) {
  return (
    <AriaInput
      data-slot="search-field-input"
      {...props}
      className={cx(
        'min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-body-regular text-text-primary outline-none',
        'placeholder:text-text-tertiary focus:placeholder:text-text-primary disabled:cursor-not-allowed disabled:text-input-disabled-text',
        '[&::-webkit-search-cancel-button]:hidden',
        className,
      )}
    />
  )
}

function SearchFieldSearchIcon({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="search-field-search-icon"
      aria-hidden
      {...props}
      className={cx('flex shrink-0 [&_svg]:size-4', className)}
    />
  )
}

interface SearchFieldClearButtonProps extends Omit<AriaButtonProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

/** Clears the field. Hidden by RAC while the field is empty. */
function SearchFieldClearButton({ className, ...props }: SearchFieldClearButtonProps) {
  return (
    <AriaButton
      data-slot="search-field-clear"
      {...props}
      className={cx(
        'flex shrink-0 cursor-[var(--cursor-interactive)] items-center rounded-full text-text-secondary outline-none',
        'data-[hovered]:text-text-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'group-data-[empty]/search:hidden [&_svg]:size-4',
        className,
      )}
    />
  )
}

export const SearchField = Object.assign(SearchFieldRoot, {
  Group: SearchFieldGroup,
  Input: SearchFieldInput,
  SearchIcon: SearchFieldSearchIcon,
  ClearButton: SearchFieldClearButton,
})

/* ------------------------------------------------------------- InputGroup */

interface InputGroupRootProps extends Omit<ComponentProps<typeof AriaGroup>, 'className'> {
  className?: string
  surface?: FieldSurface
}

/**
 * One field shell around a bare control and its adornments, for a control that
 * is not a form field — a log filter with an icon in front of it.
 */
function InputGroupRoot({ className, surface = 'primary', ...props }: InputGroupRootProps) {
  return (
    <AriaGroup
      data-slot="input-group"
      {...props}
      className={cx(
        'flex w-full items-center gap-2 rounded-2lg p-2 text-foreground-icon-tertiary',
        WELL[surface],
        'ring-2 ring-transparent ring-inset transition-[background-color,box-shadow,color] duration-[var(--input-transition-ms)] ease',
        'data-[hovered]:ring-border-button-hover data-[focus-within]:ring-border-button-active',
        className,
      )}
    />
  )
}

function InputGroupInput({
  className,
  ref,
  ...props
}: Omit<AriaInputProps, 'className'> & { className?: string; ref?: Ref<HTMLInputElement> }) {
  return (
    <AriaInput
      ref={ref}
      data-slot="input-group-input"
      {...props}
      className={cx(
        'min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-body-regular text-text-primary outline-none placeholder:text-text-tertiary',
        className,
      )}
    />
  )
}

function InputGroupTextArea({
  className,
  ref,
  ...props
}: Omit<AriaTextAreaProps, 'className'> & { className?: string; ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <AriaTextArea
      ref={ref}
      data-slot="input-group-textarea"
      {...props}
      className={cx(
        'min-w-0 flex-1 resize-none border-0 bg-transparent p-0 font-sans text-body-regular text-text-primary outline-none placeholder:text-text-tertiary',
        className,
      )}
    />
  )
}

function InputGroupPrefix({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="input-group-prefix" {...props} className={cx('flex shrink-0 [&_svg]:size-4', className)} />
}

function InputGroupSuffix({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="input-group-suffix" {...props} className={cx('flex shrink-0 [&_svg]:size-4', className)} />
}

export const InputGroup = Object.assign(InputGroupRoot, {
  Input: InputGroupInput,
  TextArea: InputGroupTextArea,
  Prefix: InputGroupPrefix,
  Suffix: InputGroupSuffix,
})
