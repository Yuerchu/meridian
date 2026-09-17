import {
  TextField as AriaTextField,
  SearchField as AriaSearchField,
  type TextFieldProps as AriaTextFieldProps,
  type SearchFieldProps as AriaSearchFieldProps,
} from 'react-aria-components'
import { forwardRef, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends ComponentProps<'input'> {
  fullWidth?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, fullWidth: _fw, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      data-slot="input"
      {...props}
      className={cn(
        'w-full rounded-field border border-field-border bg-field px-3 py-2 text-sm text-field-foreground outline-none placeholder:text-field-placeholder',
        'focus:ring-2 focus:ring-focus',
        'disabled:opacity-50',
        className,
      )}
    />
  )
})

export function TextField({
  className,
  fullWidth: _fullWidth,
  ...props
}: AriaTextFieldProps & { className?: string; fullWidth?: boolean }) {
  return <AriaTextField data-slot="text-field" {...props} className={cn('flex flex-col gap-1.5', className)} />
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
      className={cn(
        'w-full rounded-field border border-field-border bg-field px-3 py-2 text-sm text-field-foreground outline-none placeholder:text-field-placeholder',
        'focus:ring-2 focus:ring-focus',
        'disabled:opacity-50',
        className,
      )}
    />
  )
})

function SearchFieldRoot({
  className,
  fullWidth: _fw,
  variant: _v,
  ...props
}: AriaSearchFieldProps & { className?: string; fullWidth?: boolean; variant?: string }) {
  return <AriaSearchField data-slot="search-field" {...props} className={cn('flex flex-col gap-1.5', className)} />
}

function SearchFieldGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="search-field-group" {...props} className={cn('flex items-center gap-1', className)} />
}

function SearchFieldInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="search-field-input"
      {...props}
      className={cn('flex-1 bg-transparent text-sm outline-none placeholder:text-field-placeholder', className)}
    />
  )
}

function SearchFieldSearchIcon({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="search-field-search-icon" {...props} className={cn('text-muted', className)} />
}

function SearchFieldClearButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      data-slot="search-field-clear"
      type="button"
      {...props}
      className={cn('text-muted hover:text-foreground', className)}
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
  return <div data-slot="input-group" {...props} className={cn('flex items-center gap-1', className)} />
}

function InputGroupPrefix({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="input-group-prefix" {...props} className={cn('flex shrink-0 text-muted', className)} />
}

function InputGroupSuffix({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="input-group-suffix" {...props} className={cn('flex shrink-0 text-muted', className)} />
}

export const InputGroup = Object.assign(InputGroupRoot, {
  Input,
  TextArea,
  Prefix: InputGroupPrefix,
  Suffix: InputGroupSuffix,
})
