import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { isRemote } from '@/lib/transport'
import { SettingsHeader } from './primitives'
import { ProviderModelPicker } from './provider-model-picker'
import type { ProviderInfoResponse, ProviderModelInfoResponse } from '@/types'

/** Matches `AUXILIARY_MODEL_PREFERENCE` in core's `agent::auxiliary`. */
const PREFERENCE_KEY = 'auxiliary.model'

/**
 * The model this app uses for its own background requests — compaction
 * summaries and conversation titles — instead of the conversation's model.
 *
 * Empty is "follow the conversation", which is how both worked before this
 * existed. Not offered to a remote client: the backend refuses the key there
 * (`is_server_owned`), because pointing it at another provider sends every
 * later summary, and so the whole transcript, to that provider.
 */
export function AuxiliaryModelSettings({ providers }: { providers: ProviderInfoResponse[] }) {
  if (isRemote) return null
  return <AuxiliaryModelRow providers={providers} />
}

function AuxiliaryModelRow({ providers }: { providers: ProviderInfoResponse[] }) {
  const { t } = useTranslation()
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<ProviderModelInfoResponse[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getPreference({ key: PREFERENCE_KEY })
      .then(({ value }) => {
        if (!value) return
        setProviderId(value.provider_id)
        setModelId(value.model_id)
      })
      .catch((reason) => setError(String(reason)))
  }, [])

  useEffect(() => {
    if (providerId) {
      api
        .fetchProviderModels({ providerId, forceRefresh: null })
        .then(setModels)
        // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- model list feeds the picker only; the saved pair is form state
        .catch(() => setModels([]))
    } else {
      setModels([])
    }
  }, [providerId])

  // An incomplete pair deletes the row: null is the one wire spelling of
  // "follow the conversation", and a half-selected model never reaches storage.
  function persist(provider: string, model: string) {
    setError(null)
    api
      .setPreference({
        key: PREFERENCE_KEY,
        value: provider && model ? { providerId: provider, modelId: model } : null,
      })
      .catch((reason) => setError(String(reason)))
  }

  return (
    <div data-slot="auxiliary-model-settings" className="space-y-4">
      <SettingsHeader title={t('settings.auxiliaryModel.title')} subtitle={t('settings.auxiliaryModel.subtitle')} />
      <ProviderModelPicker
        providers={providers}
        models={models}
        providerId={providerId}
        modelId={modelId}
        onChange={(provider, model) => {
          setProviderId(provider)
          setModelId(model)
        }}
        // Written as soon as the pair settles, like the sub-agent defaults.
        onCommit={persist}
        emptyProviderLabel={t('settings.auxiliaryModel.followConversation')}
        labelMode="aria"
        isModelDisabledWithoutProvider
      />
      {error && (
        <p
          data-slot="auxiliary-model-error"
          role="alert"
          className="text-caption-1-regular text-status-danger break-all"
        >
          {error}
        </p>
      )}
    </div>
  )
}
