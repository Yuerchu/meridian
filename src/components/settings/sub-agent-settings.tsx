import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { SettingsHeader } from './primitives'
import { ProviderModelPicker } from './provider-model-picker'
import type { ModelInfo, Provider } from '@/types'

/** The two built-in kinds. A third one is a settings feature, not a loop one. */
const KINDS = ['explore', 'agent'] as const
type Kind = (typeof KINDS)[number]

/** Matches `default_model_preference` in `commands/sub_agent.rs`. */
const preferenceKey = (kind: Kind) => `sub_agent.${kind}.model`

/**
 * One kind's default model.
 *
 * The stored value is a single string, `<provider_id>:<model_id>` — the same
 * shape the model itself names on `run_agent.model`. Writing the pair as one
 * preference rather than two is what keeps "what the settings page saved" and
 * "what the tool accepts" from drifting apart.
 */
function KindRow({ kind, providers }: { kind: Kind; providers: Provider[] }) {
  const { t } = useTranslation()
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    api.getPreference(preferenceKey(kind)).then((v) => {
      // Split on the first colon only: a model id may well contain one
      // (`qwen:7b`), and the backend's `split_once` reads it the same way.
      const at = v ? v.indexOf(':') : -1
      if (!v || at < 0) return
      setProviderId(v.slice(0, at))
      setModelId(v.slice(at + 1))
    })
  }, [kind])

  useEffect(() => {
    if (providerId) {
      api
        .fetchProviderModels(providerId)
        .then(setModels)
        .catch(() => setModels([]))
    } else {
      setModels([])
    }
  }, [providerId])

  // An incomplete pair is stored as empty rather than as half a name: the
  // backend reads a blank preference as "follow the parent", which is the only
  // thing a provider with no model chosen could honestly mean.
  function persist(provider: string, model: string) {
    api.setPreference(preferenceKey(kind), provider && model ? `${provider}:${model}` : '')
  }

  return (
    <div className="space-y-1.5">
      <p className="block text-xs text-muted">{t(`settings.subAgent.${kind}`)}</p>
      <p className="text-xs text-muted">{t(`settings.subAgent.${kind}Hint`)}</p>
      <ProviderModelPicker
        providers={providers}
        models={models}
        providerId={providerId}
        modelId={modelId}
        onChange={(provider, model) => {
          setProviderId(provider)
          setModelId(model)
        }}
        // No Save button here: the preference is written as soon as the pair
        // settles. `onChange` alone would write one per keystroke in the
        // fallback field.
        onCommit={persist}
        emptyProviderLabel={t('settings.subAgent.followParent')}
        labelMode="aria"
        isModelDisabledWithoutProvider
      />
    </div>
  )
}

/**
 * Which model each kind of delegated run uses when the model does not name one.
 *
 * Two preferences rather than columns on `assistants`: a sub-agent is not an
 * assistant the user can open and edit, and giving it a row would mean it shows
 * up in every list that offers one.
 */
export function SubAgentSettings({ providers }: { providers: Provider[] }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <SettingsHeader title={t('settings.subAgent.title')} subtitle={t('settings.subAgent.subtitle')} />
      {KINDS.map((kind) => (
        <KindRow key={kind} kind={kind} providers={providers} />
      ))}
    </div>
  )
}
