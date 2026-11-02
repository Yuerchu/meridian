import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { isRemote } from '@/lib/transport'
import { ProviderModelPicker } from './provider-model-picker'
import { SettingsRow, SettingsSection } from './primitives'
import type { ProviderInfoResponse, ProviderModelInfoResponse } from '@/types'

const PREFERENCE_KEY = 'emoji.suggest.model'

/**
 * Which model looks at a sticker for "generate suggestion".
 *
 * Empty follows the default assistant, which is how the command worked
 * before this existed. Not offered to a remote client: the backend refuses
 * the key (`is_server_owned`) because sticker images go to that provider.
 */
export function EmojiSuggestSettings() {
  if (isRemote) return null
  return <EmojiSuggestRow />
}

function EmojiSuggestRow() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderInfoResponse[]>([])
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<ProviderModelInfoResponse[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listProviders()
      .then(setProviders)
      .catch((reason) => setError(String(reason)))
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
    <div data-slot="emoji-suggest">
      <SettingsSection label={t('settings.emoji.suggestModelSection')}>
        <SettingsRow
          stacked
          label={t('settings.emoji.suggestModel')}
          description={t('settings.emoji.suggestModelHint')}
        >
          <ProviderModelPicker
            providers={providers}
            models={models}
            providerId={providerId}
            modelId={modelId}
            onChange={(provider, model) => {
              setProviderId(provider)
              setModelId(model)
            }}
            onCommit={persist}
            emptyProviderLabel={t('settings.emoji.suggestModelFollow')}
            labelMode="aria"
            isModelDisabledWithoutProvider
          />
        </SettingsRow>
        {error && (
          <p
            data-slot="emoji-suggest-error"
            role="alert"
            className="px-3 pb-2.5 text-caption-1-regular text-status-danger break-all"
          >
            {error}
          </p>
        )}
      </SettingsSection>
    </div>
  )
}
