import { lazy, Suspense } from 'react'

/**
 * A model's logo, loaded on demand.
 *
 * `@lobehub/icons` is ~1.9 MB: `ModelIcon` matches against every logo it knows,
 * so there is no smaller subset. Deferring it keeps that weight out of the
 * first paint — the chunk is on local disk and lands within a frame or two,
 * against a placeholder of the right size so nothing shifts when it does.
 *
 * The feature module, not the package entry: the barrel also re-exports
 * `ModelTag` and `ProviderCombine`, which import `Tag`/`Divider` from
 * `@lobehub/ui/base-ui`. Those names are not in the ui version this set
 * currently resolves, and a production build fails on the missing export
 * even though this app never uses those two components.
 */
const LazyModelIcon = lazy(() => import('@lobehub/icons/es/features/ModelIcon'))

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
      fallback={
        <span
          data-slot="model-icon-placeholder"
          className={props.className}
          style={{ display: 'inline-block', width: size, height: size }}
        />
      }
    >
      <LazyModelIcon size={size} {...props} />
    </Suspense>
  )
}

export { ModelIcon }
