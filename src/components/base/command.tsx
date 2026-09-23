import type { ComponentProps, ReactNode } from 'react'
import {
  Autocomplete,
  Button as AriaButton,
  Dialog,
  Header,
  Input as AriaInput,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Modal as AriaModal,
  ModalOverlay,
  SearchField as AriaSearchField,
  useFilter,
  type ButtonProps as AriaButtonProps,
  type DialogProps,
  type InputProps as AriaInputProps,
  type ListBoxItemProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { MODAL_BACKDROP, MODAL_BACKDROP_MOTION, MODAL_MOTION, OVERLAY_SURFACE } from './overlay-motion'

/**
 * A command palette: a search box over a list, in a modal.
 *
 *   <Command.Backdrop isOpen onOpenChange>
 *     <Command.Container size="md">
 *       <Command.Dialog aria-label="…" inputValue={q} onInputChange={setQ}>
 *         <Command.Header>
 *           <Command.InputGroup aria-label="…">
 *             <Command.InputGroup.Prefix><SearchIcon /></Command.InputGroup.Prefix>
 *             <Command.InputGroup.Input placeholder="…" />
 *             <Command.InputGroup.ClearButton aria-label="Clear" />
 *           </Command.InputGroup>
 *         </Command.Header>
 *         <Command.List aria-label="…" renderEmptyState={…}>
 *           <Command.Group heading="Actions"><Command.Item id="new" textValue="New" onAction={…}>New</Command.Item></Command.Group>
 *         </Command.List>
 *       </Command.Dialog>
 *     </Command.Container>
 *   </Command.Backdrop>
 *
 * `Command.Dialog` is React Aria's `Autocomplete`: it owns the query, filters
 * the list by each item's `textValue` (contains, base sensitivity), and routes
 * the arrow keys and Enter from the input to the list while focus stays in the
 * input. The search field, its clear button and the list are all RAC's and
 * find each other through `Autocomplete`'s contexts; a plain `<input>` here
 * would type into nothing.
 */

interface CommandBackdropProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}

function CommandBackdrop({ isOpen, onOpenChange, children }: CommandBackdropProps) {
  return (
    <ModalOverlay
      data-slot="command-backdrop"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={cx(
        'fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]',
        MODAL_BACKDROP,
        MODAL_BACKDROP_MOTION,
      )}
    >
      <AriaModal data-slot="command-modal" className={cx('w-full', MODAL_MOTION)}>
        {children}
      </AriaModal>
    </ModalOverlay>
  )
}

interface CommandContainerProps extends ComponentProps<'div'> {
  size?: 'sm' | 'md' | 'lg'
}

const containerSize = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

function CommandContainer({ className, size = 'md', ...props }: CommandContainerProps) {
  return (
    <div
      data-slot="command-container"
      {...props}
      className={cx('mx-auto overflow-hidden', OVERLAY_SURFACE, containerSize[size], className)}
    />
  )
}

interface CommandDialogProps extends Omit<DialogProps, 'className' | 'children'> {
  inputValue?: string
  defaultInputValue?: string
  onInputChange?: (value: string) => void
  className?: string
  children?: ReactNode
}

function CommandDialog({
  className,
  inputValue,
  defaultInputValue,
  onInputChange,
  children,
  ...props
}: CommandDialogProps) {
  const { contains } = useFilter({ sensitivity: 'base' })
  return (
    <Dialog data-slot="command-dialog" {...props} className={cx('flex max-h-[60vh] flex-col outline-none', className)}>
      <Autocomplete
        inputValue={inputValue}
        defaultInputValue={defaultInputValue}
        onInputChange={onInputChange}
        filter={contains}
      >
        {children}
      </Autocomplete>
    </Dialog>
  )
}

function CommandHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-header"
      {...props}
      className={cx('border-b border-border-button-default px-3', className)}
    />
  )
}

function CommandInputGroupRoot({
  className,
  ...props
}: Omit<ComponentProps<typeof AriaSearchField>, 'className'> & { className?: string }) {
  return (
    <AriaSearchField
      data-slot="command-input-group"
      autoFocus
      {...props}
      className={cx('group/command-search flex items-center gap-2 py-2', className)}
    />
  )
}

function CommandInputGroupPrefix({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-input-prefix"
      aria-hidden
      {...props}
      className={cx('flex shrink-0 text-foreground-icon-secondary [&_svg]:size-4', className)}
    />
  )
}

function CommandInputGroupInput({ className, ...props }: Omit<AriaInputProps, 'className'> & { className?: string }) {
  return (
    <AriaInput
      data-slot="command-input"
      {...props}
      className={cx(
        'min-w-0 flex-1 border-0 bg-transparent p-0 text-body-regular text-text-primary outline-none placeholder:text-text-tertiary',
        '[&::-webkit-search-cancel-button]:hidden',
        className,
      )}
    />
  )
}

function CommandInputGroupClearButton({
  className,
  'aria-label': ariaLabel,
  ...props
}: Omit<AriaButtonProps, 'className' | 'children'> & { className?: string; 'aria-label': string }) {
  return (
    <AriaButton
      data-slot="command-clear"
      aria-label={ariaLabel}
      {...props}
      className={cx(
        'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-secondary outline-none',
        'data-[hovered]:bg-background-secondary-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'group-data-[empty]/command-search:hidden',
        className,
      )}
    >
      <svg
        data-slot="command-clear-icon"
        className="size-3"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </AriaButton>
  )
}

const CommandInputGroup = Object.assign(CommandInputGroupRoot, {
  Prefix: CommandInputGroupPrefix,
  Input: CommandInputGroupInput,
  ClearButton: CommandInputGroupClearButton,
})

interface CommandListProps {
  'aria-label'?: string
  renderEmptyState?: () => ReactNode
  className?: string
  children?: ReactNode
}

function CommandList({ className, renderEmptyState, children, ...props }: CommandListProps) {
  return (
    <ListBox
      data-slot="command-list"
      renderEmptyState={renderEmptyState}
      selectionMode="none"
      {...props}
      className={cx(
        'flex flex-col gap-0.5 overflow-y-auto p-2 outline-none',
        '[&:empty]:hidden data-[empty]:p-4 data-[empty]:text-center data-[empty]:text-body-regular data-[empty]:text-text-tertiary',
        className,
      )}
    >
      {children}
    </ListBox>
  )
}

interface CommandGroupProps {
  heading?: ReactNode
  children?: ReactNode
  className?: string
}

function CommandGroup({ heading, children, className }: CommandGroupProps) {
  return (
    <ListBoxSection data-slot="command-group" className={cx('flex flex-col gap-0.5 not-first:pt-1', className)}>
      {heading && (
        <Header data-slot="command-group-heading" className="px-2 py-1 text-caption-1-medium text-text-secondary">
          {heading}
        </Header>
      )}
      {children}
    </ListBoxSection>
  )
}

interface CommandItemProps extends Omit<ListBoxItemProps, 'className' | 'style'> {
  className?: string
}

function CommandItem({ className, ...props }: CommandItemProps) {
  return (
    <ListBoxItem
      data-slot="command-item"
      {...props}
      className={cx(
        'flex cursor-pointer items-center gap-2 rounded-2lg px-2 py-1.5 text-body-medium text-text-primary outline-none select-none',
        'data-[focused]:bg-dropdown-item-hover-background data-[disabled]:cursor-not-allowed data-[disabled]:text-text-disabled',
        className,
      )}
    />
  )
}

function CommandFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="command-footer"
      {...props}
      className={cx(
        'flex items-center gap-2 border-t border-border-button-default px-3 py-2 text-caption-1-medium text-text-secondary',
        className,
      )}
    />
  )
}

function CommandRoot({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

export const Command = Object.assign(CommandRoot, {
  Backdrop: CommandBackdrop,
  Container: CommandContainer,
  Dialog: CommandDialog,
  Header: CommandHeader,
  InputGroup: CommandInputGroup,
  List: CommandList,
  Group: CommandGroup,
  Item: CommandItem,
  Footer: CommandFooter,
})
