import { SettingsStack, useSettingsStack } from '../settings-stack'
import { ModelPage } from './model-page'
import { ProviderListPage } from './provider-list-page'
import { ProviderPage } from './provider-page'

/**
 * Providers, as pages.
 *
 * The list is the root, a provider is a page over it, and one of its models is
 * a page over that. What used to be here — a selection feeding a two-column
 * layout on a desktop and a drilldown on a phone, with an auto-selected first
 * row to keep the second column from looking broken — is all gone: the stack is
 * the same three pages at every width.
 *
 * What is left in this file is the wiring. Each page fetches what it needs by
 * id, so there is no state to coordinate and nothing to invalidate when
 * something is renamed or deleted; coming back to a page remounts it, and
 * remounting is the refresh.
 */
type ProviderLevel =
  { kind: 'provider'; providerId: string } | { kind: 'model'; providerId: string; modelId: string; apiFormat: string }

export function ProviderSettings() {
  const stack = useSettingsStack<ProviderLevel>()

  return (
    <SettingsStack stack={stack}>
      {(level) => {
        if (level === null) {
          return <ProviderListPage onOpen={(providerId) => stack.push({ kind: 'provider', providerId })} />
        }
        if (level.kind === 'provider') {
          return (
            <ProviderPage
              key={level.providerId}
              providerId={level.providerId}
              onOpenModel={(modelId, apiFormat) =>
                stack.push({ kind: 'model', providerId: level.providerId, modelId, apiFormat })
              }
              // Unguarded: the draft it is asking about belongs to a row that
              // no longer exists, so the question would be about nothing.
              onDeleted={() => stack.reset()}
            />
          )
        }
        return (
          <ModelPage
            key={`${level.providerId}/${level.modelId}`}
            providerId={level.providerId}
            modelId={level.modelId}
            apiFormat={level.apiFormat}
            // Stays on the page after a save: a form whose Save button makes
            // the form disappear reads as a crash rather than as a success.
            onSaved={() => {}}
            onDeleted={() => stack.reset(1)}
          />
        )
      }}
    </SettingsStack>
  )
}
