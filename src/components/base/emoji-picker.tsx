import { createContext, useContext, type ComponentProps, type Key, type ReactNode } from 'react'
import {
  Button as AriaButton,
  Popover as AriaPopover,
  DialogTrigger,
  Dialog,
  type ButtonProps as AriaButtonProps,
  type PopoverProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { OVERLAY_MOTION } from './overlay-motion'
import { Button, type ButtonProps } from './buttons/button'

interface EmojiPickerCtx {
  selectedKey: Key | null
  onSelectionChange?: (key: Key) => void
  /** The root's `aria-label`, which names the popover's dialog. */
  label?: string
}

const EmojiPickerContext = createContext<EmojiPickerCtx>({ selectedKey: null })

interface EmojiPickerProps {
  'aria-label'?: string
  isOpen?: boolean
  selectedKey?: Key | null
  size?: 'sm' | 'md' | 'lg'
  onOpenChange?: (open: boolean) => void
  onSelectionChange?: (key: Key) => void
  children?: ReactNode
}

function EmojiPickerRoot({
  isOpen,
  onOpenChange,
  selectedKey = null,
  onSelectionChange,
  children,
  'aria-label': label,
}: EmojiPickerProps) {
  return (
    <EmojiPickerContext.Provider value={{ selectedKey, onSelectionChange, label }}>
      <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
        {children}
      </DialogTrigger>
    </EmojiPickerContext.Provider>
  )
}

interface EmojiPickerTriggerProps {
  'aria-label'?: string
  className?: string
  onPress?: () => void
  leadingIcon: ButtonProps['leadingIcon']
}

function EmojiPickerTrigger({ className, onPress, leadingIcon, ...props }: EmojiPickerTriggerProps) {
  return (
    <Button
      data-slot="emoji-picker-trigger"
      variant="neutral"
      iconOnly
      size="small"
      onPress={onPress}
      leadingIcon={leadingIcon}
      className={className}
      aria-label={props['aria-label']}
    />
  )
}

function EmojiPickerPopover({ className, ...props }: Omit<PopoverProps, 'children'> & { children?: ReactNode }) {
  const { label } = useContext(EmojiPickerContext)
  return (
    <AriaPopover
      data-slot="emoji-picker-popover"
      {...props}
      className={cx(
        'w-72 overflow-hidden rounded-xl border border-border-button-default bg-background-primary-default shadow-dropdown',
        OVERLAY_MOTION,
        className as string,
      )}
    >
      <Dialog aria-label={label} className="outline-none">
        {props.children}
      </Dialog>
    </AriaPopover>
  )
}

function EmojiPickerContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="emoji-picker-content" {...props} className={cx('flex flex-col', className)} />
}

interface EmojiPickerGridProps<T> extends Omit<ComponentProps<'div'>, 'children'> {
  items?: T[]
  renderEmptyState?: () => ReactNode
  children?: (item: T) => ReactNode
}

function EmojiPickerGrid<T>({ className, items, children, renderEmptyState, ...props }: EmojiPickerGridProps<T>) {
  if (!items?.length && renderEmptyState) {
    return (
      <div data-slot="emoji-picker-grid-empty" className="flex items-center justify-center p-4">
        {renderEmptyState()}
      </div>
    )
  }
  return (
    <div
      data-slot="emoji-picker-grid"
      role="grid"
      {...props}
      className={cx('grid grid-cols-8 gap-0.5 overflow-y-auto p-2', className)}
    >
      {items?.map((item, i) => (
        <div data-slot="emoji-picker-grid-cell" key={i}>
          {children?.(item)}
        </div>
      ))}
    </div>
  )
}

interface EmojiPickerItemProps extends Omit<AriaButtonProps, 'id' | 'className' | 'isDisabled' | 'onPress'> {
  id?: string | number
  disabled?: boolean
  textValue?: string
  className?: string
}

function EmojiPickerItem({ className, id, disabled, textValue, ...props }: EmojiPickerItemProps) {
  const { onSelectionChange } = useContext(EmojiPickerContext)
  return (
    <AriaButton
      data-slot="emoji-picker-item"
      isDisabled={disabled}
      aria-label={textValue}
      onPress={() => id != null && onSelectionChange?.(id)}
      {...props}
      className={cx(
        'flex size-8 cursor-pointer items-center justify-center rounded-md text-title-3-regular',
        'outline-none transition-colors duration-150 ease data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
        'data-[hovered]:bg-background-secondary-default data-[pressed]:bg-background-secondary-hover data-[disabled]:cursor-default data-[disabled]:opacity-50',
        className,
      )}
    />
  )
}

function EmojiPickerFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="emoji-picker-footer" {...props} className={cx('border-t border-separator-border p-1', className)} />
  )
}

export const EmojiPicker = Object.assign(EmojiPickerRoot, {
  Trigger: EmojiPickerTrigger,
  Popover: EmojiPickerPopover,
  Content: EmojiPickerContent,
  Grid: EmojiPickerGrid,
  Item: EmojiPickerItem,
  Footer: EmojiPickerFooter,
})
