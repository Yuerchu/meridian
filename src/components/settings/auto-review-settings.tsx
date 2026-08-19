import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Input, ListBox, Select, TextArea } from '@heroui/react'
import { api } from '@/api'
import type { ModelInfo, Provider } from '@/types'
import { SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'

/**
 * Who answers a tool approval when the user is not there to.
 *
 * Everything here is a `preferences` key rather than a config struct, because
 * there is no server to restart and nothing to hand out — the turn loop reads
 * these once when it starts. That also means `remote::dispatch` has to refuse
 * the whole `autoreview.` prefix: pointing the model at something that waves
 * everything through is the difference between a settings write and permission
 * to run anything on the host.
 */
const KEYS = {
  enabled: 'autoreview.enabled',
  model: 'autoreview.model',
  escalate: 'autoreview.escalate',
  allow: 'autoreview.allow_rules',
  deny: 'autoreview.deny_rules',
  environment: 'autoreview.environment',
} as const

interface Settings {
  enabled: boolean
  model: string | null
  escalate: boolean
  allow: string
  deny: string
  environment: string
}

const DEFAULTS: Settings = {
  enabled: false,
  model: null,
  // On unless it was turned off: the second pass is what keeps false denials
  // from making the whole mode unusable, and it only runs when the cheap one
  // was not sure.
  escalate: true,
  allow: '',
  deny: '',
  environment: '',
}

/**
 * Which model reviews approvals.
 *
 * `<provider_id>:<model_id>`, split on the first colon only — a model id may
 * contain one (`qwen:7b`) and the backend's `split_once` reads it the same way.
 * The same shape `hooks.review_model` uses, and the same picker shape, but
 * deliberately not the same setting: that reviewer reads plans and diffs and
 * can afford to be slow, while this one stands between a person and a tool call
 * they are waiting on.
 */
function ModelPicker({
  providers,
  value,
  onChange,
}: {
  providers: Provider[]
  value: string | null
  onChange: (next: string | null) => void
}) {
  const { t } = useTranslation()
  // Half a pair is a state the user passes through — they pick a provider, and
  // only then a model — so it is held here rather than derived from `value`,
  // which stays null until the pair is complete.
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])

  const composed = providerId && modelId ? `${providerId}:${modelId}` : null

  useEffect(() => {
    if (value === composed) return
    const at = value ? value.indexOf(':') : -1
    setProviderId(at >= 0 ? value!.slice(0, at) : '')
    setModelId(at >= 0 ? value!.slice(at + 1) : '')
    // `composed` is read but deliberately not a dependency: it changes on every
    // pick, and re-running this then would undo the pick that changed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    if (!providerId) {
      setModels([])
      return
    }
    api
      .fetchProviderModels(providerId)
      .then(setModels)
      .catch(() => setModels([]))
  }, [providerId])

  const emit = (provider: string, model: string) => {
    setProviderId(provider)
    setModelId(model)
    onChange(provider && model ? `${provider}:${model}` : null)
  }

  const providerOptions = [
    { value: '_none', label: t('settings.hooks.selectProvider') },
    ...providers.map((p) => ({ value: p.id, label: p.name })),
  ]
  const modelOptions = [
    { value: '_none', label: t('settings.assistant.selectModel') },
    ...models.map((m) => ({ value: m.id, label: m.name })),
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Select
        fullWidth
        aria-label={t('settings.assistant.provider')}
        value={providerId || '_none'}
        onChange={(v) => emit(!v || v === '_none' ? '' : String(v), '')}
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
          usable, so this degrades to a plain id field rather than to nothing. */}
      {models.length > 0 ? (
        <Select
          fullWidth
          aria-label={t('settings.assistant.model')}
          value={modelId || '_none'}
          isDisabled={!providerId}
          onChange={(v) => emit(providerId, !v || v === '_none' ? '' : String(v))}
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
          onBlur={() => emit(providerId, modelId)}
          placeholder={t('settings.assistant.modelPlaceholder')}
          disabled={!providerId}
        />
      )}
    </div>
  )
}

function RuleBox({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string
  hint: string
  value: string
  placeholder: string
  onChange: (next: string) => void
}) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <p className="text-xs text-muted">{hint}</p>
      <TextArea
        id={id}
        fullWidth
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function AutoReviewSettings() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    [],
  )

  const load = useCallback(async () => {
    try {
      const [enabled, model, escalate, allow, deny, environment, provs] = await Promise.all([
        api.getPreference(KEYS.enabled),
        api.getPreference(KEYS.model),
        api.getPreference(KEYS.escalate),
        api.getPreference(KEYS.allow),
        api.getPreference(KEYS.deny),
        api.getPreference(KEYS.environment),
        api.listProviders(),
      ])
      setSettings({
        enabled: enabled === 'true',
        model: model || null,
        escalate: escalate !== 'false',
        allow: allow ?? '',
        deny: deny ?? '',
        environment: environment ?? '',
      })
      setProviders(provs)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await Promise.all([
        api.setPreference(KEYS.enabled, String(settings.enabled)),
        api.setPreference(KEYS.model, settings.model ?? ''),
        api.setPreference(KEYS.escalate, String(settings.escalate)),
        api.setPreference(KEYS.allow, settings.allow),
        api.setPreference(KEYS.deny, settings.deny),
        api.setPreference(KEYS.environment, settings.environment),
      ])
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <SettingsSkeleton />

  // Turned on without a model is off, and saying so beats a switch that reads
  // as enabled while nothing happens.
  const incomplete = settings.enabled && !settings.model

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.autoReview.title')} subtitle={t('settings.autoReview.description')} />

      <div className="flex items-start gap-2">
        <Checkbox
          id="autoreview-enabled"
          isSelected={settings.enabled}
          onChange={(selected) => setSettings({ ...settings, enabled: selected })}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
        <div className="space-y-0.5">
          <label htmlFor="autoreview-enabled" className="text-sm font-medium cursor-pointer">
            {t('settings.autoReview.enable')}
          </label>
          <p className="text-xs text-muted">{t('settings.autoReview.enableHint')}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t('settings.autoReview.model')}</span>
        <p className="text-xs text-muted">{t('settings.autoReview.modelHint')}</p>
        <ModelPicker
          providers={providers}
          value={settings.model}
          onChange={(model) => setSettings({ ...settings, model })}
        />
        {incomplete && <p className="text-xs text-warning-soft-foreground">{t('settings.autoReview.noModel')}</p>}
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="autoreview-escalate"
          isSelected={settings.escalate}
          onChange={(selected) => setSettings({ ...settings, escalate: selected })}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
        <div className="space-y-0.5">
          <label htmlFor="autoreview-escalate" className="text-sm font-medium cursor-pointer">
            {t('settings.autoReview.escalate')}
          </label>
          <p className="text-xs text-muted">{t('settings.autoReview.escalateHint')}</p>
        </div>
      </div>

      <RuleBox
        label={t('settings.autoReview.environment')}
        hint={t('settings.autoReview.environmentHint')}
        value={settings.environment}
        placeholder={t('settings.autoReview.environmentPlaceholder')}
        onChange={(environment) => setSettings({ ...settings, environment })}
      />
      <RuleBox
        label={t('settings.autoReview.allow')}
        hint={t('settings.autoReview.allowHint')}
        value={settings.allow}
        placeholder={t('settings.autoReview.allowPlaceholder')}
        onChange={(allow) => setSettings({ ...settings, allow })}
      />
      <RuleBox
        label={t('settings.autoReview.deny')}
        hint={t('settings.autoReview.denyHint')}
        value={settings.deny}
        placeholder={t('settings.autoReview.denyPlaceholder')}
        onChange={(deny) => setSettings({ ...settings, deny })}
      />

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} isDisabled={saving}>
          {t('common.save')}
        </Button>
        {saved && <span className="text-xs text-success">{t('common.saved')}</span>}
      </div>
    </SettingsPane>
  )
}
