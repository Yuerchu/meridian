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
import { cn } from '@/lib/utils'
import { Button } from './button'

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
      className={cn(
        'mx-auto overflow-hidden rounded-xl border border-border bg-overlay shadow-overlay',
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
      className={cn('flex max-h-[60vh] flex-col outline-none', className)}
    />
  )
}

function CommandHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="command-header" {...props} className={cn('border-b border-separator px-3', className)} />
}

function CommandInputGroupRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="command-input-group" {...props} className={cn('flex items-center gap-2 py-2', className)} />
}

function CommandInputGroupPrefix({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="command-input-prefix" {...props} className={cn('text-muted', className)} />
}

function CommandInputGroupInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <AriaInput
      data-slot="command-input"
      {...props}
      className={cn('flex-1 bg-transparent text-sm outline-none placeholder:text-muted', className)}
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
    // eslint-disable-next-line meridian-ui/icon-only-needs-tooltip -- clear button within input group
    <Button
      data-slot="command-clear"
      variant="ghost"
      isIconOnly
      size="sm"
      aria-label={ariaLabel}
      className={cn('size-6 text-muted', className)}
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
      className={cn('overflow-y-auto p-1', className)}
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
    <ListBoxSection data-slot="command-group" className={cn('', className)}>
      {heading && (
        <Header data-slot="command-group-heading" className="px-2 py-1.5 text-xs font-medium text-muted">
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
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none',
        'data-[focused]:bg-default data-[focused]:text-foreground',
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
      className={cn('flex items-center gap-2 border-t border-separator px-3 py-2 text-xs text-muted', className)}
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
