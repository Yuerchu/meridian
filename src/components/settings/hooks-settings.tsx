import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Input, Label, ListBox, Select } from '@heroui/react'
import { api } from '@/api'
import type { Assistant, HooksConfig, HooksStatus, ModelInfo, Provider } from '@/types'
import { SettingsHeader, SettingsPane } from './primitives'

const DEFAULTS: HooksConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 8765,
  token: null,
  review_model: null,
  assistant_id: null,
  timeout_secs: 300,
}

/**
 * Which model reviews plans.
 *
 * Stored as one string, `<provider_id>:<model_id>`, split on the first colon
 * only — a model id may contain one (`qwen:7b`), and the backend's `split_once`
 * reads it the same way.
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
  // Held here rather than derived from `value`, because half a pair is a real
  // state the user passes through: they pick a provider, and only then a model.
  // Deriving both from `value` — which is null until the pair is complete —
  // means picking a provider immediately un-picks it.
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])

  const composed = providerId && modelId ? `${providerId}:${modelId}` : null

  // Adopt whatever the config says, but only when it disagrees with what is
  // already on screen. Without that guard this fights the two setters above on
  // every keystroke; with it, it fires once when the config finishes loading.
  useEffect(() => {
    if (value === composed) return
    const at = value ? value.indexOf(':') : -1
    // Split on the first colon only: a model id may well contain one
    // (`qwen:7b`), and the backend's `split_once` reads it the same way.
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
    api.fetchProviderModels(providerId).then(setModels).catch(() => setModels([]))
  }, [providerId])

  // An incomplete pair is stored as nothing rather than as half a name: the
  // backend refuses to review without a model, and "half a model" would be a
  // slower way of saying the same thing. The half pair still lives in local
  // state, so the picker shows it while the user finishes choosing.
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
        onChange={(v) => {
          const next = !v || v === '_none' ? '' : String(v)
          emit(next, '')
        }}
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
          nothing — the same fallback the sub-agent settings make. */}
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
          // Typed straight into local state and only committed on blur, so a
          // half-typed model id is not persisted a character at a time.
          onChange={(e) => setModelId(e.target.value)}
          onBlur={() => emit(providerId, modelId)}
          placeholder={t('settings.assistant.modelPlaceholder')}
          disabled={!providerId}
        />
      )}
    </div>
  )
}

/**
 * The endpoint another coding agent's hooks post to.
 *
 * The plugin finds the port and token through the handshake file this server
 * writes, so there is nothing here for the user to copy into a config — which
 * is why the panel shows the handshake path rather than a settings snippet.
 */
export function HooksSettings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<HooksConfig>(DEFAULTS)
  const [status, setStatus] = useState<HooksStatus | null>(null)
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [revealToken, setRevealToken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hostId = useId()
  const portId = useId()
  const timeoutId = useId()

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

  const loadData = useCallback(async () => {
    try {
      const [cfg, sts, assts, provs] = await Promise.all([
        api.getHooksConfig(),
        api.getHooksStatus(),
        api.listAssistants(),
        api.listProviders(),
      ])
      setConfig(cfg)
      setStatus(sts)
      setAssistants(assts)
      setProviders(provs)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        setStatus(await api.getHooksStatus())
      } catch {
        // Polling failures are not worth a banner: the next tick will say.
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      // The saved config comes back because the backend mints the token on
      // first save; dropping the reply would leave the panel showing none.
      setConfig(await api.saveHooksConfig(config))
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
      return true
    } catch (err) {
      setError(String(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleStart = async () => {
    if (!(await handleSave())) return
    try {
      await api.startHooks()
      setStatus(await api.getHooksStatus())
    } catch (err) {
      setError(String(err))
    }
  }

  const handleStop = async () => {
    try {
      await api.stopHooks()
      setStatus(await api.getHooksStatus())
    } catch (err) {
      setError(String(err))
    }
  }

  const handleRegenerate = async () => {
    setError(null)
    try {
      setConfig({ ...config, token: await api.regenerateHooksToken() })
    } catch (err) {
      setError(String(err))
    }
  }

  const running = status?.running ?? false
  const assistantOptions = [
    { value: '_default', label: t('settings.hooks.defaultAssistant') },
    ...assistants.map((a) => ({ value: a.id, label: a.name })),
  ]

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.hooks.title')} />

      <div className="flex items-start gap-2">
        <Checkbox
          id="hooks-enabled"
          isSelected={config.enabled}
          onChange={(selected) => setConfig({ ...config, enabled: selected })}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
        <div className="space-y-0.5">
          <label htmlFor="hooks-enabled" className="text-sm font-medium cursor-pointer">
            {t('settings.hooks.enable')}
          </label>
          <p className="text-xs text-muted">{t('settings.hooks.enableHint')}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="block text-xs font-medium text-muted">{t('settings.hooks.reviewModel')}</p>
        <ModelPicker
          providers={providers}
          value={config.review_model}
          onChange={(review_model) => setConfig({ ...config, review_model })}
        />
        <p className="text-xs text-muted">{t('settings.hooks.reviewModelHint')}</p>
      </div>

      <div className="space-y-1.5">
        <Select
          fullWidth
          value={config.assistant_id ?? '_default'}
          onChange={(v) => {
            if (v) setConfig({ ...config, assistant_id: v === '_default' ? null : String(v) })
          }}
        >
          <Label className="block text-xs font-medium text-muted">
            {t('settings.hooks.assistant')}
          </Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {assistantOptions.map((o) => (
                <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                  {o.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <p className="text-xs text-muted">{t('settings.hooks.assistantHint')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor={hostId} className="block text-xs font-medium text-muted">
            {t('settings.hooks.host')}
          </label>
          <Input
            fullWidth
            id={hostId}
            value={config.host}
            onChange={(e) => setConfig({ ...config, host: e.target.value })}
            placeholder="127.0.0.1"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={portId} className="block text-xs font-medium text-muted">
            {t('settings.hooks.port')}
          </label>
          <Input
            fullWidth
            id={portId}
            type="number"
            min={1}
            max={65535}
            value={config.port}
            onChange={(e) =>
              setConfig({
                ...config,
                port: Math.min(65535, Math.max(1, parseInt(e.target.value, 10) || 8765)),
              })
            }
            placeholder="8765"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={timeoutId} className="block text-xs font-medium text-muted">
          {t('settings.hooks.timeout')}
        </label>
        <Input
          fullWidth
          id={timeoutId}
          type="number"
          min={10}
          // Mirrors MAX_TIMEOUT_SECS in hooks/mod.rs. The backend clamps too —
          // this is only so the field cannot offer a number that cannot happen.
          max={1200}
          value={config.timeout_secs}
          onChange={(e) =>
            setConfig({
              ...config,
              timeout_secs: Math.min(1200, Math.max(10, parseInt(e.target.value, 10) || 600)),
            })
          }
        />
        <p className="text-xs text-muted">{t('settings.hooks.timeoutHint')}</p>
      </div>

      <div className="space-y-1.5">
        <p className="block text-xs font-medium text-muted">{t('settings.hooks.token')}</p>
        <div className="flex items-center gap-2">
          <Input
            fullWidth
            aria-label={t('settings.hooks.token')}
            readOnly
            type={revealToken ? 'text' : 'password'}
            value={config.token ?? ''}
            placeholder={t('settings.hooks.tokenPending')}
          />
          <Button variant="outline" onClick={() => setRevealToken(!revealToken)}>
            {revealToken ? t('settings.hooks.hide') : t('settings.hooks.reveal')}
          </Button>
          <Button variant="outline" onClick={handleRegenerate}>
            {t('settings.hooks.regenerate')}
          </Button>
        </div>
        <p className="text-xs text-muted">{t('settings.hooks.tokenHint')}</p>
      </div>

      {error && <p className="text-xs text-danger break-all">{error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <Button variant="outline" onClick={handleSave} isDisabled={saving}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {running ? (
          <Button variant="danger-soft" onClick={handleStop}>
            {t('settings.hooks.stop')}
          </Button>
        ) : (
          <Button onClick={handleStart}>{t('settings.hooks.start')}</Button>
        )}
      </div>

      {status && (
        <div className="rounded-lg border p-3 space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${running ? 'bg-success' : 'bg-muted'}`} />
            <span className="font-medium">
              {running ? t('settings.hooks.statusRunning') : t('settings.hooks.statusStopped')}
            </span>
          </div>
          {running && (
            <p className="text-xs text-muted break-all">
              http://{status.host}:{status.port}/hooks/exit-plan
            </p>
          )}
          {/* The one thing worth showing when nothing works: the plugin reads
              this file to find us, so its absence is the whole diagnosis. */}
          {status.handshake_path && (
            <p className="text-xs text-muted break-all">
              {t('settings.hooks.handshake')}: {status.handshake_path}
            </p>
          )}
        </div>
      )}
    </SettingsPane>
  )
}
