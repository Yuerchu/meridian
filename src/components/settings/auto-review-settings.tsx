import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Description, Input, Label, Select, SelectItem, TextArea, TextField } from '@/components/base'
import { CellSwitch } from '@/components/base'
import { api } from '@/api'
import type { PreferenceModelSelectionRequest, ProviderInfoResponse, ProviderModelInfoResponse } from '@/types'
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
  // Not an `autoreview.` key, and deliberately not in that prefix: this one
  // decides how long a person is waited *for*, which is the opposite question
  // and grants nothing. It lives on this panel because this is where approval
  // behaviour is, and there is no second panel to put it on.
  ttl: 'approvals.ttl_minutes',
} as const

interface Settings {
  enabled: boolean
  model: string | null
  escalate: boolean
  allow: string
  deny: string
  environment: string
  ttl: string
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
  ttl: '30',
}

/** A week. Past this the deadline is doing nothing a person would notice. */
const MAX_TTL_MINUTES = 7 * 24 * 60

/**
 * What to store for whatever was typed.
 *
 * Zero is kept, because "never expire" is a real answer and not a mistake.
 * Anything unreadable becomes the default instead: read as zero by the backend
 * it would turn a typo into questions that stand for ever, which is the one
 * outcome nobody would be choosing on purpose.
 */
function normaliseTtl(raw: string): number {
  const n = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(n) || n < 0) return Number(DEFAULTS.ttl)
  return Math.min(n, MAX_TTL_MINUTES)
}

function modelSelection(value: string | null): PreferenceModelSelectionRequest | null {
  const at = value?.indexOf(':') ?? -1
  if (!value || at <= 0 || at === value.length - 1) return null
  return { providerId: value.slice(0, at), modelId: value.slice(at + 1) }
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
  providers: ProviderInfoResponse[]
  value: string | null
  onChange: (next: string | null) => void
}) {
  const { t } = useTranslation()
  // Half a pair is a state the user passes through — they pick a provider, and
  // only then a model — so it is held here rather than derived from `value`,
  // which stays null until the pair is complete.
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<ProviderModelInfoResponse[]>([])

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
      .fetchProviderModels({ providerId, forceRefresh: null })
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
    <div data-slot="model-picker" className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-3">
      <Select
        aria-label={t('settings.assistant.provider')}
        selectedKey={providerId || '_none'}
        onSelectionChange={(v) => emit(!v || v === '_none' ? '' : String(v), '')}
      >
        {providerOptions.map((o) => (
          <SelectItem key={o.value} id={o.value} textValue={o.label}>
            {o.label}
          </SelectItem>
        ))}
      </Select>
      {/* A provider whose model list has not been fetched yet still has to be
          usable, so this degrades to a plain id field rather than to nothing. */}
      {models.length > 0 ? (
        <Select
          aria-label={t('settings.assistant.model')}
          selectedKey={modelId || '_none'}
          isDisabled={!providerId}
          onSelectionChange={(v) => emit(providerId, !v || v === '_none' ? '' : String(v))}
        >
          {modelOptions.map((o) => (
            <SelectItem key={o.value} id={o.value} textValue={o.label}>
              {o.label}
            </SelectItem>
          ))}
        </Select>
      ) : (
        <Input
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
  return (
    <TextField>
      <Label>{label}</Label>
      <TextArea rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <Description>{hint}</Description>
    </TextField>
  )
}

export function AutoReviewSettings() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [providers, setProviders] = useState<ProviderInfoResponse[]>([])
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
      const [enabled, model, escalate, allow, deny, environment, ttl, provs] = await Promise.all([
        api.getPreference({ key: KEYS.enabled }),
        api.getPreference({ key: KEYS.model }),
        api.getPreference({ key: KEYS.escalate }),
        api.getPreference({ key: KEYS.allow }),
        api.getPreference({ key: KEYS.deny }),
        api.getPreference({ key: KEYS.environment }),
        api.getPreference({ key: KEYS.ttl }),
        api.listProviders(),
      ])
      setSettings({
        enabled: enabled.value ?? false,
        model: model.value ? `${model.value.provider_id}:${model.value.model_id}` : null,
        escalate: escalate.value ?? true,
        allow: allow.value ?? '',
        deny: deny.value ?? '',
        environment: environment.value ?? '',
        // Unset reads as the default rather than as blank, so the field always
        // shows the number that is actually in force. The backend applies the
        // same default; agreeing on it here means the box is not a lie the
        // first time it is opened.
        ttl: String(ttl.value ?? DEFAULTS.ttl),
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
        api.setPreference({ key: KEYS.enabled, value: settings.enabled }),
        api.setPreference({ key: KEYS.model, value: modelSelection(settings.model) }),
        api.setPreference({ key: KEYS.escalate, value: settings.escalate }),
        api.setPreference({ key: KEYS.allow, value: settings.allow }),
        api.setPreference({ key: KEYS.deny, value: settings.deny }),
        api.setPreference({ key: KEYS.environment, value: settings.environment }),
        // Normalised on the way out, so the backend's parse never has to guess:
        // anything that is not a number becomes the default rather than
        // silently disabling the deadline, which is what an unparseable value
        // would otherwise do if the backend read it as zero.
        api.setPreference({ key: KEYS.ttl, value: normaliseTtl(settings.ttl) }),
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

      {/* Above the reviewer, because it applies whether or not there is one:
          this is how long a person is waited for, and the reviewer is who
          answers when nobody does. */}
      <TextField>
        <Label>{t('settings.approvals.ttl')}</Label>
        <Input
          type="number"
          min={0}
          max={MAX_TTL_MINUTES}
          className="max-w-32"
          value={settings.ttl}
          onChange={(e) => setSettings({ ...settings, ttl: e.target.value })}
        />
        <Description>{t('settings.approvals.ttlHint')}</Description>
        {normaliseTtl(settings.ttl) === 0 && (
          <p data-slot="approvals-ttl-never" className="text-xs text-status-warning-soft-foreground">
            {t('settings.approvals.ttlNever')}
          </p>
        )}
      </TextField>

      <div data-slot="autoreview-enable" className="space-y-1.5">
        <CellSwitch
          aria-label={t('settings.autoReview.enable')}
          aria-describedby="autoreview-enabled-hint"
          isSelected={settings.enabled}
          onChange={(selected) => setSettings({ ...settings, enabled: selected })}
        >
          <CellSwitch.Trigger className="pointer-coarse:h-11">
            <CellSwitch.Label>{t('settings.autoReview.enable')}</CellSwitch.Label>
            <CellSwitch.Control />
          </CellSwitch.Trigger>
        </CellSwitch>
        <p id="autoreview-enabled-hint" data-slot="autoreview-enable-hint" className="text-xs text-text-secondary">
          {t('settings.autoReview.enableHint')}
        </p>
      </div>

      <div data-slot="autoreview-model" className="space-y-1.5">
        <span data-slot="autoreview-model-label" className="text-sm font-medium">
          {t('settings.autoReview.model')}
        </span>
        <p data-slot="autoreview-model-hint" className="text-xs text-text-secondary">
          {t('settings.autoReview.modelHint')}
        </p>
        <ModelPicker
          providers={providers}
          value={settings.model}
          onChange={(model) => setSettings({ ...settings, model })}
        />
        {incomplete && (
          <p data-slot="autoreview-no-model" className="text-xs text-status-warning-soft-foreground">
            {t('settings.autoReview.noModel')}
          </p>
        )}
      </div>

      <div data-slot="autoreview-escalate" className="space-y-1.5">
        <CellSwitch
          aria-label={t('settings.autoReview.escalate')}
          aria-describedby="autoreview-escalate-hint"
          isSelected={settings.escalate}
          onChange={(selected) => setSettings({ ...settings, escalate: selected })}
        >
          <CellSwitch.Trigger className="pointer-coarse:h-11">
            <CellSwitch.Label>{t('settings.autoReview.escalate')}</CellSwitch.Label>
            <CellSwitch.Control />
          </CellSwitch.Trigger>
        </CellSwitch>
        <p id="autoreview-escalate-hint" data-slot="autoreview-escalate-hint" className="text-xs text-text-secondary">
          {t('settings.autoReview.escalateHint')}
        </p>
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

      {error && (
        <p data-slot="autoreview-error" className="text-xs text-status-danger">
          {error}
        </p>
      )}

      <div data-slot="autoreview-actions" className="flex items-center gap-3">
        <Button onPress={handleSave} isDisabled={saving}>
          {t('common.save')}
        </Button>
        {saved && (
          <span data-slot="autoreview-saved" className="text-xs text-status-success">
            {t('common.saved')}
          </span>
        )}
      </div>
    </SettingsPane>
  )
}
