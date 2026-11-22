import type { ComponentProps, ReactNode } from 'react'
import {
  Button as AriaButton,
  Group as AriaGroup,
  Input as AriaInput,
  SearchField as AriaSearchField,
  type ButtonProps as AriaButtonProps,
  type InputProps as AriaInputProps,
  type SearchFieldProps as AriaSearchFieldProps,
} from 'react-aria-components'
import { Search, X } from '@keyline-icons/react/two-tone'
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

export type InputProps = InputBaseProps

export function Input(props: InputProps) {
  return <InputBase data-slot="input" {...props} />
}

export type TextAreaProps = TextareaBaseProps

export function TextArea(props: TextAreaProps) {
  return <TextareaBase data-slot="textarea" {...props} />
}

/* ------------------------------------------------------------ SearchField */

interface SearchFieldRootProps extends Omit<AriaSearchFieldProps, 'className'> {
  className?: string
  children?: ReactNode
}

function SearchFieldRoot({ className, children, ...props }: SearchFieldRootProps) {
  return (
    <AriaSearchField
      data-slot="search-field"
      {...props}
      className={cx('group/search flex w-full flex-col gap-1', className)}
    >
      {children}
    </AriaSearchField>
  )
}

/** The field shell; the registry field's fill and ring (`input/input.tsx`). */
function SearchFieldGroup({ className, ...props }: ComponentProps<typeof AriaGroup>) {
  return (
    <AriaGroup
      data-slot="search-field-group"
      {...props}
      className={cx(
        'flex w-full items-center gap-2 rounded-2lg p-2 text-foreground-icon-tertiary',
        'bg-background-tertiary-default',
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
        'placeholder:text-text-secondary focus:placeholder:text-text-primary disabled:cursor-not-allowed disabled:text-input-disabled-text',
        '[&::-webkit-search-cancel-button]:hidden',
        className,
      )}
    />
  )
}

/**
 * The magnifier at the field's start. Drawn by the part itself: it was an empty
 * slot that expected a glyph as its child, and every one of the four search
 * fields in the app wrote `<SearchField.SearchIcon />` and got nothing. A child
 * still replaces it.
 */
function SearchFieldSearchIcon({ className, children, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="search-field-search-icon"
      aria-hidden
      {...props}
      className={cx('flex shrink-0 [&_svg]:size-4', className)}
    >
      {children ?? <Search />}
    </span>
  )
}

interface SearchFieldClearButtonProps extends Omit<AriaButtonProps, 'className' | 'children'> {
  className?: string
  children?: ReactNode
}

/**
 * Clears the field. Hidden by RAC while the field is empty. Draws its own ×,
 * for the reason the search icon does; React Aria's SearchField names it.
 */
function SearchFieldClearButton({ className, children, ...props }: SearchFieldClearButtonProps) {
  return (
    <AriaButton
      data-slot="search-field-clear"
      {...props}
      className={cx(
        'flex shrink-0 cursor-pointer items-center rounded-full text-text-secondary outline-none',
        'data-[hovered]:text-text-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'group-data-[empty]/search:hidden [&_svg]:size-4',
        className,
      )}
    >
      {children ?? <X aria-hidden />}
    </AriaButton>
  )
}

export const SearchField = Object.assign(SearchFieldRoot, {
  Group: SearchFieldGroup,
  Input: SearchFieldInput,
  SearchIcon: SearchFieldSearchIcon,
  ClearButton: SearchFieldClearButton,
})
