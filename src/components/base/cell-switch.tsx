import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'
import {
  Switch as AriaSwitch,
  type SwitchProps as AriaSwitchProps,
  type SwitchRenderProps,
} from 'react-aria-components'
import { cx } from '@/utils/cx'
import { SwitchTrack, type SwitchSize } from './switch/switch'

/**
 * A settings row that is a switch: the whole row is the label, the toggle sits
 * at its end. The registry's `SwitchCard` is the same idea with a fixed
 * layout; this one is composed, because the rows here carry descriptions,
 * icons and hints in more shapes than one card can hold.
 *
 *   <CellSwitch isSelected={on} onChange={setOn}>
 *     <CellSwitch.Trigger>
 *       <CellSwitch.Label>Enable</CellSwitch.Label>
 *       <CellSwitch.Control />
 *     </CellSwitch.Trigger>
 *   </CellSwitch>
 *
 * The root is React Aria's `Switch` (a `<label>` wrapping a visually hidden
 * checkbox, so the row is clickable and the switch is keyboard-operable); the
 * `Control` draws the registry's track from the switch's own render state,
 * which the root shares through context.
 */

type CellSwitchSize = 'sm' | 'md'

const SwitchStateContext = createContext<SwitchRenderProps | null>(null)
const SwitchSizeContext = createContext<SwitchSize>('md')

export interface CellSwitchProps extends Omit<AriaSwitchProps, 'className' | 'children' | 'style'> {
  size?: CellSwitchSize
  className?: string
  children?: ReactNode
}

function CellSwitchRoot({ className, size = 'md', children, ...props }: CellSwitchProps) {
  return (
    <AriaSwitch
      data-slot="cell-switch"
      data-size={size}
      {...props}
      className={cx('group/cell-switch block', className)}
    >
      {(state) => (
        <SwitchStateContext.Provider value={state}>
          <SwitchSizeContext.Provider value={size}>{children}</SwitchSizeContext.Provider>
        </SwitchStateContext.Provider>
      )}
    </AriaSwitch>
  )
}

function CellSwitchTrigger({ className, ...props }: ComponentProps<'div'>) {
  const size = useContext(SwitchSizeContext)
  return (
    <div
      data-slot="cell-switch-trigger"
      {...props}
      className={cx(
        'flex w-full cursor-[var(--cursor-interactive)] items-center gap-3 rounded-xl border border-border-button-default bg-background-primary-default shadow-xs transition-colors',
        size === 'sm' ? 'min-h-9 px-3 py-1.5' : 'min-h-11 px-3 py-2',
        'group-data-[hovered]/cell-switch:bg-background-primary-hover',
        'group-data-[disabled]/cell-switch:cursor-not-allowed group-data-[disabled]/cell-switch:opacity-60',
        className,
      )}
    />
  )
}

function CellSwitchLabel({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="cell-switch-label"
      {...props}
      className={cx('min-w-0 flex-1 text-body-medium text-text-primary', className)}
    />
  )
}

function CellSwitchDescription({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="cell-switch-description"
      {...props}
      className={cx('block text-caption-1-medium text-text-secondary', className)}
    />
  )
}

function CellSwitchControl({ className, ...props }: ComponentProps<'span'>) {
  const state = useContext(SwitchStateContext)
  const size = useContext(SwitchSizeContext)
  return (
    <span data-slot="cell-switch-control" {...props} className={cx('flex shrink-0 items-center', className)}>
      <SwitchTrack
        size={size}
        state={{
          isSelected: state?.isSelected ?? false,
          isDisabled: state?.isDisabled ?? false,
          isFocusVisible: state?.isFocusVisible ?? false,
        }}
      />
    </span>
  )
}

export const CellSwitch = Object.assign(CellSwitchRoot, {
  Trigger: CellSwitchTrigger,
  Label: CellSwitchLabel,
  Description: CellSwitchDescription,
  Control: CellSwitchControl,
})
