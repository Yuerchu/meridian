import {
  Dialog,
  DialogTrigger,
  Modal,
  ModalOverlay,
  Input as AriaInput,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Header,
  type ListBoxItemProps,
} from 'react-aria-components'
import type { ComponentProps, ReactNode } from 'react'
import { cx } from '@/utils/cx'
import { Button } from './buttons/button'

interface CommandBackdropProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}

function CommandBackdrop({ isOpen, onOpenChange, children }: CommandBackdropProps) {
  return (
    <DialogTrigger>
      <ModalOverlay
        data-slot="command-backdrop"
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        isDismissable
        className="fixed inset-0 z-50 flex items-start justify-center bg-backdrop/50 pt-[15vh] backdrop-blur-sm data-[entering]:animate-in data-[entering]:fade-in-0 data-[exiting]:animate-out data-[exiting]:fade-out-0"
      >
        <Modal
          data-slot="command-modal"
          className="w-full data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[entering]:duration-150 data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95 data-[exiting]:duration-100"
        >
          {children}
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  )
}

interface CommandContainerProps extends ComponentProps<'div'> {
  size?: 'sm' | 'md' | 'lg'
}

function CommandContainer({ className, size = 'md', ...props }: CommandContainerProps) {
  return (
    <div
      data-slot="command-container"
      {...props}
      className={cx(
        'mx-auto overflow-hidden rounded-xl border border-border-button-default bg-background-primary-default shadow-dropdown',
        size === 'sm' && 'max-w-sm',
        size === 'md' && 'max-w-lg',
        size === 'lg' && 'max-w-2xl',
        className,
      )}
    />
  )
}

interface CommandDialogProps {
  'aria-label'?: string
  inputValue?: string
  onInputChange?: (value: string) => void
  className?: string
  children?: ReactNode
}

function CommandDialog({ className, inputValue: _iv, onInputChange: _oic, ...props }: CommandDialogProps) {
  return (
    <Dialog
      data-slot="command-dialog"
      {...props}
      className={cx('flex max-h-[60vh] flex-col outline-none', className)}
    />
  )
}

function CommandHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="command-header" {...props} className={cx('border-b border-separator-border px-3', className)} />
  )
}

function CommandInputGroupRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="command-input-group" {...props} className={cx('flex items-center gap-2 py-2', className)} />
}

function CommandInputGroupPrefix({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="command-input-prefix" {...props} className={cx('text-text-secondary', className)} />
}

function CommandInputGroupInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <AriaInput
      data-slot="command-input"
      {...props}
      className={cx('flex-1 bg-transparent text-sm outline-none placeholder:text-text-placeholder', className)}
    />
  )
}

function CommandInputGroupClearButton({
  className,
  'aria-label': ariaLabel,
}: {
  className?: string
  'aria-label'?: string
}) {
  return (
    <Button
      data-slot="command-clear"
      variant="ghost"
      iconOnly
      size="small"
      aria-label={ariaLabel}
      className={cx('size-6 text-text-secondary', className)}
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
    </Button>
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
      {...props}
      className={cx('overflow-y-auto p-1', className)}
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
    <ListBoxSection data-slot="command-group" className={cx('', className)}>
      {heading && (
        <Header data-slot="command-group-heading" className="px-2 py-1.5 text-xs font-medium text-text-secondary">
          {heading}
        </Header>
      )}
      {children}
    </ListBoxSection>
  )
}

interface CommandItemProps extends ListBoxItemProps {
  onAction?: () => void
}

function CommandItem({ className, onAction: _onAction, ...props }: CommandItemProps) {
  return (
    <ListBoxItem
      data-slot="command-item"
      {...props}
      className={cx(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none',
        'data-[focused]:bg-background-secondary-default data-[focused]:text-text-primary',
        className as string,
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
        'flex items-center gap-2 border-t border-separator-border px-3 py-2 text-xs text-text-secondary',
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
