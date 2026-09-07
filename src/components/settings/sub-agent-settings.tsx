import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { SettingsHeader } from './primitives'
import { ProviderModelPicker } from './provider-model-picker'
import type { ProviderInfoResponse, ProviderModelInfoResponse } from '@/types'

/** The two built-in kinds. A third one is a settings feature, not a loop one. */
const KINDS = ['explore', 'agent'] as const
type Kind = (typeof KINDS)[number]

/** Matches `default_model_preference` in `commands/sub_agent.rs`. */
const PREFERENCE_KEYS = {
  explore: 'sub_agent.explore.model',
  agent: 'sub_agent.agent.model',
} as const

/**
 * One kind's default model.
 *
 * The stored value is a single string, `<provider_id>:<model_id>` — the same
 * shape the model itself names on `run_agent.model`. Writing the pair as one
 * preference rather than two is what keeps "what the settings page saved" and
 * "what the tool accepts" from drifting apart.
 */
function KindRow({ kind, providers }: { kind: Kind; providers: ProviderInfoResponse[] }) {
  const { t } = useTranslation()
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<ProviderModelInfoResponse[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getPreference({ key: PREFERENCE_KEYS[kind] }).then(({ value }) => {
      if (!value) return
      setProviderId(value.provider_id)
      setModelId(value.model_id)
    })
  }, [kind])

  useEffect(() => {
    if (providerId) {
      api
        .fetchProviderModels({ providerId, forceRefresh: null })
        .then(setModels)
        .catch(() => setModels([]))
    } else {
      setModels([])
    }
  }, [providerId])

  // An incomplete pair deletes the row: null is the one wire spelling of
  // "follow the parent", and a half-selected model never reaches storage.
  function persist(provider: string, model: string) {
    setError(null)
    api
      .setPreference({
        key: PREFERENCE_KEYS[kind],
        value: provider && model ? { providerId: provider, modelId: model } : null,
      })
      .catch((reason) => setError(String(reason)))
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
      {error && (
        <p role="alert" className="text-xs text-danger break-all">
          {error}
        </p>
      )}
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
export function SubAgentSettings({ providers }: { providers: ProviderInfoResponse[] }) {
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
