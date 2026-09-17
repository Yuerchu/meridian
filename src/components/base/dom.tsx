import { mergeRefs, useLayoutEffect } from '@react-aria/utils'
import { useRef, useMemo, type ReactElement } from 'react'

type DOMRenderFunction<E extends keyof React.JSX.IntrinsicElements> = (
  props: React.JSX.IntrinsicElements[E],
) => ReactElement

interface DOMRenderProps<E extends keyof React.JSX.IntrinsicElements> {
  render?: DOMRenderFunction<E>
}

function DOMElement<E extends keyof React.JSX.IntrinsicElements>(
  ElementType: E,
  props: DOMRenderProps<E> & React.JSX.IntrinsicElements[E],
) {
  const { ref: forwardedRef, render, ...otherProps } = props as Record<string, unknown>
  const elementRef = useRef<Element>(null)
  const ref = useMemo(() => mergeRefs(forwardedRef as React.Ref<Element>, elementRef), [forwardedRef, elementRef])

  useLayoutEffect(() => {
    if (import.meta.env.DEV && render && !elementRef.current) {
      console.warn(
        'Ref was not connected to DOM element returned by custom `render` function. ' +
          'Did you forget to pass through or merge the `ref`?',
      )
    }
  }, [ElementType, render])

  const domProps = { ...otherProps, ref }
  if (render) return render(domProps)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intrinsic element type union
  return <ElementType {...(domProps as Record<string, unknown> as any)} />
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic component cache
const domComponentCache: Record<string, any> = {}

type DOMComponents = {
  [E in keyof React.JSX.IntrinsicElements]: (props: DOMRenderProps<E> & React.JSX.IntrinsicElements[E]) => ReactElement
}

export const dom: DOMComponents = new Proxy({} as DOMComponents, {
  get(_target, elementType) {
    if (typeof elementType !== 'string') return undefined
    let res = domComponentCache[elementType]
    if (!res) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic element type
      res = DOMElement.bind(null, elementType as any)
      domComponentCache[elementType] = res
    }
    return res
  },
})
