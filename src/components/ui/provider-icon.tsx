import { lazy, Suspense } from 'react'
import { Cloud } from '@keyline-icons/react/two-tone'
import { ModelIcon } from './model-icon'

/**
 * A vendor's logo, loaded on demand.
 *
 * Same arrangement as {@link ModelIcon} and for the same reason: the icon set
 * is ~1.9 MB because its entry point pulls in a component for every mark it
 * knows, and both matchers scan all of them, so there is no subset to import
 * instead.
 */
const LazyProviderIcon = lazy(() => import('@lobehub/icons').then((m) => ({ default: m.ProviderIcon })))

export function ProviderIcon({
  provider,
  size = 16,
  className,
}: {
  provider: string
  size?: number
  className?: string
}) {
  return (
    <Suspense
      fallback={
        <span
          data-slot="provider-icon-placeholder"
          className={className}
          style={{ display: 'inline-block', width: size, height: size }}
        />
      }
    >
      <LazyProviderIcon provider={provider} size={size} className={className} />
    </Suspense>
  )
}

/**
 * The mark beside a provider's name, chosen or derived.
 *
 * Two matchers, deliberately. A chosen name comes out of the picker, whose
 * list is the icon set's own provider keys, so `ProviderIcon` — the matcher
 * those keys belong to — is the one that can resolve it. A derived name is
 * `catalog_id`, which is Meridian's vocabulary rather than the set's: most of
 * the seven entries happen to coincide with a provider key, `siliconflow` does
 * not (the set spells it `siliconcloud`), and `ModelIcon`'s looser keyword
 * matching is what has been resolving them. Routing the derived case through
 * the stricter matcher would silently drop logos that work today, for rows
 * whose owner never asked for anything to change.
 *
 * Which is also the answer for anyone who finds the derived mark wrong: pick
 * one. That is what the column is for.
 */
export function ProviderMark({
  icon,
  catalogId,
  providerType,
  size = 16,
  className,
}: {
  icon?: string | null
  catalogId?: string | null
  providerType?: string | null
  size?: number
  className?: string
}) {
  if (icon) return <ProviderIcon provider={icon} size={size} className={className} />
  const derived = catalogId ?? providerType
  if (derived) return <ModelIcon model={derived} size={size} className={className} />
  return <Cloud className={className} style={{ width: size, height: size }} />
}
