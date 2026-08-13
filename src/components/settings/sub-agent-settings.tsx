import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, ListBox, Select } from '@heroui/react'
import { api } from '@/api'
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
      api.fetchProviderModels(providerId).then(setModels).catch(() => setModels([]))
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

  function handleProvider(value: string) {
    const next = !value || value === '_default' ? '' : value
    setProviderId(next)
    setModelId('')
    persist(next, '')
  }

  function handleModel(value: string) {
    const next = !value || value === '_none' ? '' : value
    setModelId(next)
    persist(providerId, next)
  }

  const providerOptions = [
    { value: '_default', label: t('settings.subAgent.followParent') },
    ...providers.map((p) => ({ value: p.id, label: p.name })),
  ]
  const modelOptions = [
    { value: '_none', label: t('settings.assistant.selectModel') },
    ...models.map((m) => ({ value: m.id, label: m.name })),
  ]

  return (
    <div className="space-y-1.5">
      <p className="block text-xs text-muted">{t(`settings.subAgent.${kind}`)}</p>
      <p className="text-xs text-muted">{t(`settings.subAgent.${kind}Hint`)}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select
          fullWidth
          aria-label={t('settings.assistant.provider')}
          value={providerId || '_default'}
          onChange={(v) => handleProvider(String(v ?? ''))}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {providerOptions.map((o) => (
                <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                  {o.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {/* A provider whose model list has not been fetched yet still has to be
            usable, so the picker degrades to a plain id field rather than to
            nothing — the same fallback the assistant editor makes. */}
        {models.length > 0 ? (
          <Select
            fullWidth
            aria-label={t('settings.assistant.model')}
            value={modelId || '_none'}
            onChange={(v) => handleModel(String(v ?? ''))}
            placeholder={t('settings.assistant.selectModel')}
            isDisabled={!providerId}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {modelOptions.map((o) => (
                  <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                    {o.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        ) : (
          <Input
            fullWidth
            aria-label={t('settings.assistant.model')}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onBlur={() => persist(providerId, modelId)}
            placeholder={t('settings.assistant.modelPlaceholder')}
            disabled={!providerId}
          />
        )}
      </div>
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
      <div>
        <h2 className="text-lg font-medium">{t('settings.subAgent.title')}</h2>
        <p className="text-xs text-muted mt-1">{t('settings.subAgent.subtitle')}</p>
      </div>
      {KINDS.map((kind) => (
        <KindRow key={kind} kind={kind} providers={providers} />
      ))}
    </div>
  )
}
