import { Label as AriaLabel, type LabelProps as AriaLabelProps } from 'react-aria-components'
import { cx } from '@/utils/cx'

/**
 * A field's visible name. Inside a `TextField`, `Select`, `CheckboxGroup` or
 * `RadioGroup` React Aria wires it to the control (`htmlFor` /
 * `aria-labelledby`) through context; outside one it is a caption in the same
 * style. The registry's `input/label.tsx` adds the required asterisk and info
 * glyph for its composed `Input`; this is the bare form the rest of the app
 * places beside its own controls.
 */
export interface LabelProps extends Omit<AriaLabelProps, 'className'> {
  className?: string
}

export function Label({ className, ...props }: LabelProps) {
  return (
    <AriaLabel
      data-slot="label"
      {...props}
      className={cx('flex cursor-default items-center gap-0.5 text-body-medium text-text-primary', className)}
    />
  )
}
