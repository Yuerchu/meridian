import { Sheet } from './sheet'
import type { ComponentProps } from 'react'

interface DrawerProps {
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: 'left' | 'right' | 'top' | 'bottom'
  children?: React.ReactNode
}

function DrawerRoot({ isOpen, onOpenChange, placement = 'bottom', children }: DrawerProps) {
  return (
    <Sheet isOpen={isOpen} placement={placement} onOpenChange={onOpenChange}>
      <Sheet.Backdrop variant="opaque">
        <Sheet.Content>{children}</Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
  )
}

function DrawerDialog({
  className,
  ...props
}: {
  className?: string
  'aria-label'?: string
  children?: React.ReactNode
}) {
  return <Sheet.Dialog className={className} {...props} />
}

function DrawerHeader({ className, ...props }: ComponentProps<'div'>) {
  return <Sheet.Header className={className} {...props} />
}

function DrawerBody({ className, ...props }: ComponentProps<'div'>) {
  return <Sheet.Body className={className} {...props} />
}

function DrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return <Sheet.Footer className={className} {...props} />
}

function DrawerCloseTrigger({ className, ...props }: { className?: string; 'aria-label'?: string }) {
  return <Sheet.CloseTrigger className={className} {...props} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough
function DrawerBackdrop({ children }: any) {
  return <>{children}</>
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough
function DrawerContent({ children }: any) {
  return <>{children}</>
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough
function DrawerHandle(_props: any) {
  return null
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- passthrough
function DrawerTrigger({ children }: any) {
  return <>{children}</>
}

export const Drawer = Object.assign(DrawerRoot, {
  Trigger: DrawerTrigger,
  Backdrop: DrawerBackdrop,
  Content: DrawerContent,
  Dialog: DrawerDialog,
  Handle: DrawerHandle,
  Header: DrawerHeader,
  Heading: ({ className, ...props }: ComponentProps<'h2'>) => <Sheet.Heading className={className} {...props} />,
  Body: DrawerBody,
  Footer: DrawerFooter,
  CloseTrigger: DrawerCloseTrigger,
})
