import { createContext, useContext, type ComponentProps, type Key, type ReactNode } from 'react'
import { Popover as AriaPopover, DialogTrigger, Dialog, type PopoverProps } from 'react-aria-components'
import { cx } from '@/utils/cx'
import { OVERLAY_MOTION } from './overlay-motion'
import { Button } from './buttons/button'

interface EmojiPickerCtx {
  selectedKey: Key | null
  onSelectionChange?: (key: Key) => void
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

function EmojiPickerRoot({ isOpen, onOpenChange, selectedKey = null, onSelectionChange, children }: EmojiPickerProps) {
  return (
    <EmojiPickerContext.Provider value={{ selectedKey, onSelectionChange }}>
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
  children?: ReactNode
}

function EmojiPickerTrigger({ className, onPress, children, ...props }: EmojiPickerTriggerProps) {
  return (
    <Button
      data-slot="emoji-picker-trigger"
      variant="ghost"
      iconOnly
      size="small"
      onPress={onPress}
      className={cx('text-text-secondary', className)}
      aria-label={props['aria-label']}
    >
      {children}
    </Button>
  )
}

function EmojiPickerPopover({ className, ...props }: Omit<PopoverProps, 'children'> & { children?: ReactNode }) {
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
      <Dialog className="outline-none">{props.children}</Dialog>
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

interface EmojiPickerItemProps extends Omit<ComponentProps<'button'>, 'id'> {
  id?: string | number
  disabled?: boolean
  textValue?: string
}

function EmojiPickerItem({ className, id, disabled, textValue, ...props }: EmojiPickerItemProps) {
  const { onSelectionChange } = useContext(EmojiPickerContext)
  return (
    <button
      data-slot="emoji-picker-item"
      type="button"
      disabled={disabled}
      aria-label={textValue}
      onClick={() => id != null && onSelectionChange?.(id)}
      {...props}
      className={cx(
        'flex size-8 items-center justify-center rounded-md text-lg hover:bg-background-secondary-default disabled:opacity-50',
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
