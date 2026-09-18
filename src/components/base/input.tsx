import {
  TextField as AriaTextField,
  SearchField as AriaSearchField,
  type TextFieldProps as AriaTextFieldProps,
  type SearchFieldProps as AriaSearchFieldProps,
} from 'react-aria-components'
import { forwardRef, type ComponentProps } from 'react'
import { cx } from '@/utils/cx'

const INPUT_BASE = [
  'w-full rounded-2lg border border-border-button-default bg-background-primary-default',
  'px-2.5 py-2 text-body-medium text-text-primary shadow-xs',
  'outline-none placeholder:text-text-placeholder',
  'transition-[background-color,border-color,box-shadow] duration-200 ease',
  'hover:border-border-button-hover',
  'focus:ring-2 focus:ring-border-focus-ring focus:ring-offset-2',
  'disabled:cursor-not-allowed disabled:bg-background-primary-disabled disabled:text-text-tertiary disabled:shadow-none',
].join(' ')

interface InputProps extends ComponentProps<'input'> {
  fullWidth?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, fullWidth: _fw, ...props },
  ref,
) {
  return <input ref={ref} data-slot="input" {...props} className={cx(INPUT_BASE, className)} />
})

export function TextField({
  className,
  fullWidth: _fullWidth,
  ...props
}: AriaTextFieldProps & { className?: string; fullWidth?: boolean }) {
  return <AriaTextField data-slot="text-field" {...props} className={cx('flex flex-col gap-1.5', className)} />
}

interface TextAreaProps extends ComponentProps<'textarea'> {
  fullWidth?: boolean
  variant?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, fullWidth: _fw, variant: _v, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      {...props}
      className={cx(INPUT_BASE, 'min-h-[80px] resize-y', className)}
    />
  )
})

function SearchFieldRoot({
  className,
  fullWidth: _fw,
  variant: _v,
  ...props
}: AriaSearchFieldProps & { className?: string; fullWidth?: boolean; variant?: string }) {
  return <AriaSearchField data-slot="search-field" {...props} className={cx('flex flex-col gap-1.5', className)} />
}

function SearchFieldGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="search-field-group" {...props} className={cx('flex items-center gap-1', className)} />
}

function SearchFieldInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="search-field-input"
      {...props}
      className={cx(
        'flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-placeholder',
        className,
      )}
    />
  )
}

function SearchFieldSearchIcon({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="search-field-search-icon" {...props} className={cx('text-text-secondary', className)} />
}

function SearchFieldClearButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      data-slot="search-field-clear"
      type="button"
      {...props}
      className={cx('text-text-secondary hover:text-text-primary', className)}
    />
  )
}

export const SearchField = Object.assign(SearchFieldRoot, {
  Group: SearchFieldGroup,
  Input: SearchFieldInput,
  SearchIcon: SearchFieldSearchIcon,
  ClearButton: SearchFieldClearButton,
})

function InputGroupRoot({ className, fullWidth: _fw, ...props }: ComponentProps<'div'> & { fullWidth?: boolean }) {
  return <div data-slot="input-group" {...props} className={cx('flex items-center gap-1', className)} />
}

function InputGroupPrefix({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="input-group-prefix" {...props} className={cx('flex shrink-0 text-text-secondary', className)} />
  )
}

function InputGroupSuffix({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="input-group-suffix" {...props} className={cx('flex shrink-0 text-text-secondary', className)} />
  )
}

export const InputGroup = Object.assign(InputGroupRoot, {
  Input,
  TextArea,
  Prefix: InputGroupPrefix,
  Suffix: InputGroupSuffix,
})
