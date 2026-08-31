import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Input, Label, ListBox, Select } from '@heroui/react'
import { ItemCard } from '@heroui-pro/react/item-card'
import { api } from '@/api'
import { cn } from '@/lib/utils'
import type { Assistant, HooksConfig, HooksStatus, ModelInfo, Provider } from '@/types'
import { SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import { useConfirm } from '@/hooks/use-confirm'
import { useSettingsDirtyRegistration } from './dirty-guard'

const DEFAULTS: HooksConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 8765,
  token: null,
  review_model: null,
  assistant_id: null,
  timeout_secs: 600,
  max_rounds: 5,
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
  onDirtyChange,
}: {
  providers: Provider[]
  value: string | null
  onChange: (next: string | null) => void
  onDirtyChange?: (dirty: boolean) => void
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
    onDirtyChange?.(false)
    // `composed` is read but deliberately not a dependency: it changes on every
    // pick, and re-running this then would undo the pick that changed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

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

  // An incomplete pair is stored as nothing rather than as half a name: the
  // backend refuses to review without a model, and "half a model" would be a
  // slower way of saying the same thing. The half pair still lives in local
  // state, so the picker shows it while the user finishes choosing.
  const emit = (provider: string, model: string) => {
    setProviderId(provider)
    setModelId(model)
    onChange(provider && model ? `${provider}:${model}` : null)
    onDirtyChange?.(Boolean(provider) && !model)
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
    <div className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-3">
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
          onChange={(e) => {
            setModelId(e.target.value)
            onDirtyChange?.(true)
          }}
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
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [portInput, setPortInput] = useState('8765')
  const [timeoutInput, setTimeoutInput] = useState('600')
  const [roundsInput, setRoundsInput] = useState('5')
  const [savedDraft, setSavedDraft] = useState<string | null>(null)
  const [modelDraftDirty, setModelDraftDirty] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hostId = useId()
  const portId = useId()
  const timeoutId = useId()
  const roundsId = useId()
  const draft = JSON.stringify({
    ...config,
    token: undefined,
    port: portInput,
    timeout_secs: timeoutInput,
    max_rounds: roundsInput,
  })
  const dirty = loaded && (draft !== savedDraft || modelDraftDirty)
  useSettingsDirtyRegistration('hooks', 'hooks-config', dirty)

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    [],
  )

  const loadData = useCallback(async () => {
    setLoadError(null)
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
      const nextPort = cfg.port.toString()
      const nextTimeout = cfg.timeout_secs.toString()
      const nextRounds = cfg.max_rounds.toString()
      setPortInput(nextPort)
      setTimeoutInput(nextTimeout)
      setRoundsInput(nextRounds)
      setSavedDraft(
        JSON.stringify({
          ...cfg,
          token: undefined,
          port: nextPort,
          timeout_secs: nextTimeout,
          max_rounds: nextRounds,
        }),
      )
      setLoaded(true)
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

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
    setError(null)
    const port = Number(portInput)
    const timeout = Number(timeoutInput)
    const rounds = Number(roundsInput)
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !Number.isInteger(timeout) ||
      timeout < 10 ||
      timeout > 1200 ||
      !Number.isInteger(rounds) ||
      rounds < 0 ||
      rounds > 20
    ) {
      setError(t('settings.hooks.invalidNumbers'))
      return false
    }
    setSaving(true)
    try {
      // The saved config comes back because the backend mints the token on
      // first save; dropping the reply would leave the panel showing none.
      const savedConfig = await api.saveHooksConfig({
        ...config,
        port,
        timeout_secs: timeout,
        max_rounds: rounds,
      })
      setConfig(savedConfig)
      setPortInput(savedConfig.port.toString())
      setTimeoutInput(savedConfig.timeout_secs.toString())
      setRoundsInput(savedConfig.max_rounds.toString())
      setSavedDraft(
        JSON.stringify({
          ...savedConfig,
          token: undefined,
          port: savedConfig.port.toString(),
          timeout_secs: savedConfig.timeout_secs.toString(),
          max_rounds: savedConfig.max_rounds.toString(),
        }),
      )
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
    if (!(await confirm({ body: t('settings.hooks.regenerateConfirm'), status: 'warning' }))) return
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

  if (loading) return <SettingsSkeleton />
  if (!loaded) {
    return (
      <SettingsPane>
        <SettingsHeader title={t('settings.hooks.title')} />
        <div role="alert" className="space-y-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <p>{t('settings.hooks.loadError')}</p>
          {loadError && <p className="break-all">{loadError}</p>}
          <Button
            size="sm"
            variant="outline"
            onPress={() => {
              setLoading(true)
              void loadData()
            }}
          >
            {t('settings.hooks.retry')}
          </Button>
        </div>
      </SettingsPane>
    )
  }

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
          onDirtyChange={setModelDraftDirty}
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
          <Label className="block text-xs font-medium text-muted">{t('settings.hooks.assistant')}</Label>
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

      <div className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor={hostId} className="block text-xs font-medium text-muted">
            {t('settings.hooks.host')}
          </label>
          <Input
            fullWidth
            id={hostId}
            name="hooksHost"
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
            name="hooksPort"
            inputMode="numeric"
            type="number"
            min={1}
            max={65535}
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
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
          name="hooksTimeout"
          inputMode="numeric"
          type="number"
          min={10}
          // Mirrors MAX_TIMEOUT_SECS in hooks/mod.rs. The backend clamps too —
          // this is only so the field cannot offer a number that cannot happen.
          max={1200}
          value={timeoutInput}
          onChange={(e) => setTimeoutInput(e.target.value)}
        />
        <p className="text-xs text-muted">{t('settings.hooks.timeoutHint')}</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={roundsId} className="block text-xs font-medium text-muted">
          {t('settings.hooks.maxRounds')}
        </label>
        <Input
          fullWidth
          id={roundsId}
          name="hooksMaxRounds"
          inputMode="numeric"
          type="number"
          min={0}
          max={20}
          value={roundsInput}
          onChange={(e) => setRoundsInput(e.target.value)}
        />
        <p className="text-xs text-muted">
          {roundsInput === '0' ? t('settings.hooks.maxRoundsUnlimited') : t('settings.hooks.maxRoundsHint')}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="block text-xs font-medium text-muted">{t('settings.hooks.token')}</p>
        <div className="flex items-center gap-2">
          <Input
            fullWidth
            aria-label={t('settings.hooks.token')}
            name="hooksToken"
            autoComplete="off"
            readOnly
            type={revealToken ? 'text' : 'password'}
            value={config.token ?? ''}
            placeholder={t('settings.hooks.tokenPending')}
          />
          <Button variant="outline" onPress={() => setRevealToken(!revealToken)}>
            {revealToken ? t('settings.hooks.hide') : t('settings.hooks.reveal')}
          </Button>
          <Button variant="outline" onPress={handleRegenerate}>
            {t('settings.hooks.regenerate')}
          </Button>
        </div>
        <p className="text-xs text-muted">{t('settings.hooks.tokenHint')}</p>
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger break-all">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button variant="outline" onPress={handleSave} isDisabled={saving}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {saved && (
          <span role="status" className="sr-only">
            {t('common.saved')}
          </span>
        )}
        {running ? (
          <Button variant="danger-soft" onPress={handleStop}>
            {t('settings.hooks.stop')}
          </Button>
        ) : (
          <Button onPress={handleStart}>{t('settings.hooks.start')}</Button>
        )}
      </div>

      {status && (
        <ItemCard variant="outline">
          <ItemCard.Content className="min-w-0">
            <ItemCard.Title className="flex w-full items-center gap-2">
              <span
                aria-hidden
                className={cn('inline-block size-2 shrink-0 rounded-full', running ? 'bg-success' : 'bg-muted')}
              />
              {running ? t('settings.hooks.statusRunning') : t('settings.hooks.statusStopped')}
            </ItemCard.Title>
            {running && (
              <ItemCard.Description className="w-full whitespace-normal break-all">
                http://{status.host}:{status.port}/hooks/exit-plan
              </ItemCard.Description>
            )}
            {/* The one thing worth showing when nothing works: the plugin reads
                this file to find us, so its absence is the whole diagnosis. */}
            {status.handshake_path && (
              <ItemCard.Description className="w-full whitespace-normal break-all">
                {t('settings.hooks.handshake')}: {status.handshake_path}
              </ItemCard.Description>
            )}
          </ItemCard.Content>
        </ItemCard>
      )}
      {confirmDialog}
    </SettingsPane>
  )
}
