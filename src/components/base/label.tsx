import { Label as BoardLabel, type LabelProps as BoardLabelProps } from './input/label'

/**
 * A field's visible name: the registry's `input/label.tsx`, so a field the app
 * composes itself gets the same type, the required asterisk (`isRequired`) and
 * the info glyph (`tooltip`) as the registry's own `Input`. Inside a
 * `TextField`, `Select`, `CheckboxGroup` or `RadioGroup` React Aria wires it to
 * the control (`htmlFor` / `aria-labelledby`) through context; outside one it
 * is a caption in the same style.
 */
export interface LabelProps extends Omit<BoardLabelProps, 'className' | 'children'> {
  className?: string
  children?: BoardLabelProps['children']
}

export function Label({ children, ...props }: LabelProps) {
  return (
    <BoardLabel data-slot="label" {...props}>
      {children}
    </BoardLabel>
  )
}
