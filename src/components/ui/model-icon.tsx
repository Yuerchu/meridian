import { lazy, Suspense } from 'react'

/**
 * A provider's logo, loaded on demand.
 *
 * `@lobehub/icons` is ~1.9 MB: its entry point pulls in a React component for
 * every logo it knows, and `ModelIcon` matches against all of them, so there is
 * no subset to import instead. Deferring it keeps that weight out of the first
 * paint — the chunk is on local disk and lands within a frame or two, against a
 * placeholder of the right size so nothing shifts when it does.
 */
const LazyModelIcon = lazy(() => import('@lobehub/icons').then((m) => ({ default: m.ModelIcon })))

export interface ModelIconProps {
  model?: string
  size?: number
  shape?: 'circle' | 'square'
  type?: 'avatar' | 'mono' | 'color' | 'combine' | 'combine-color'
  className?: string
}

function ModelIcon({ size = 12, ...props }: ModelIconProps) {
  return (
    <Suspense
      fallback={<span className={props.className} style={{ display: 'inline-block', width: size, height: size }} />}
    >
      <LazyModelIcon size={size} {...props} />
    </Suspense>
  )
}

export { ModelIcon }
