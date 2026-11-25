import './remote-access-settings.css'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { draftToNumber, numberToDraft, PLAIN_INTEGER } from '@/lib/number-draft'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'

import { Check, Copy } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { writeClipboard } from '@/lib/clipboard'
import type { RemoteConfigInfoResponse, RemoteStatusResponse } from '@/types'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'

/** What `copiedAddress` holds after the token was copied; no address looks like it. */
const TOKEN_COPY_KEY = '<token>'
import { useSettingsDirtyRegistration } from './dirty-guard'

/** Mirrors `RemoteConfig::default()`; only used until the first load lands. */
const DEFAULTS: RemoteConfigInfoResponse = {
  enabled: false,
  host: '0.0.0.0',
  port: 8787,
  token: null,
}

/**
 * Letting a second device use this desktop.
 *
 * Two things here are not decoration. The address list is the whole reason the
 * panel is usable at all — otherwise turning this on means going and reading
 * `ipconfig`, which on Windows lists six adapters and no hint as to which one
 * the phone is on. And `connections` is the only signal that says a device
 * actually attached: `running` says a socket is bound, which is true whether
 * anybody dialled it or not.
 *
 * The token is never typed. The backend mints one whenever this is enabled
 * without one, and refuses to bind a non-loopback address with anything shorter
 * than 16 characters — a field the user could type into would be a field they
 * could type `1234` into, and the only feedback would be a server that will not
 * start.
 */
export function RemoteAccessSettings() {
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const [config, setConfig] = useState<RemoteConfigInfoResponse>(DEFAULTS)
  const [status, setStatus] = useState<RemoteStatusResponse | null>(null)
  const [addresses, setAddresses] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, markSaved] = useTemporaryFlag()
  const [copied, markCopied] = useTemporaryFlag()
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [portInput, setPortInput] = useState('8787')
  const [savedDraft, setSavedDraft] = useState<string | null>(null)
  const draft = JSON.stringify({ ...config, token: undefined, port: portInput })
  const dirty = loaded && draft !== savedDraft
  useSettingsDirtyRegistration('remote', 'remote-access-config', dirty)

  const loadData = useCallback(async () => {
    setLoadError(null)
    try {
      const [cfg, sts, addrs] = await Promise.all([
        api.remote.getConfig(),
        api.remote.getStatus(),
        api.remote.listAddresses(),
      ])
      setConfig(cfg)
      setStatus(sts)
      setAddresses(addrs)
      const nextPort = cfg.port.toString()
      setPortInput(nextPort)
      setSavedDraft(JSON.stringify({ ...cfg, token: undefined, port: nextPort }))
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
        setStatus(await api.remote.getStatus())
      } catch {
        // Polling failures are not worth a banner: the next tick will say.
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  /**
   * Read the config back after anything that could have minted a token.
   *
   * `start` and `stop` answer with the status rather than the
   * config, and the backend creates a token behind the first — so the panel
   * would otherwise go on showing "generated on first save" for a server that
   * already has one.
   */
  const adoptConfig = async () => {
    try {
      const next = await api.remote.getConfig()
      const nextPort = next.port.toString()
      setConfig(next)
      setPortInput(nextPort)
      setSavedDraft(JSON.stringify({ ...next, token: undefined, port: nextPort }))
    } catch (err) {
      setError(String(err))
    }
  }

  const handleSave = async () => {
    setError(null)
    const port = Number(portInput)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t('settings.validation.port'))
      return false
    }
    setSaving(true)
    try {
      const next = await api.remote.setConfig({ ...config, port })
      const nextPort = next.port.toString()
      setConfig(next)
      setPortInput(nextPort)
      setSavedDraft(JSON.stringify({ ...next, token: undefined, port: nextPort }))
      setStatus(await api.remote.getStatus())
      markSaved()
      return true
    } catch (err) {
      setError(String(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleStart = async () => {
    // Saved first, so that a host or port edited but not committed is what gets
    // started: `start_remote` reads the stored config, not this one.
    if (!(await handleSave())) return
    try {
      setStatus(await api.remote.start())
      await adoptConfig()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleStop = async () => {
    setError(null)
    try {
      setStatus(await api.remote.stop())
      await adoptConfig()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleRegenerate = async () => {
    if (
      !(await confirm({
        description: t('settings.remote.regenerateConfirm'),
        confirmLabel: t('settings.remote.regenerate'),
      }))
    )
      return
    setError(null)
    try {
      const next = await api.remote.resetToken()
      const nextPort = next.port.toString()
      setConfig(next)
      setPortInput(nextPort)
      setSavedDraft(JSON.stringify({ ...next, token: undefined, port: nextPort }))
      setStatus(await api.remote.getStatus())
    } catch (err) {
      setError(String(err))
    }
  }

  /**
   * Copies, and says so only once the clipboard has actually taken it.
   *
   * `writeText` is a promise that rejects — a WebView without clipboard
   * permission, a page without focus — and the tick used to be drawn before it
   * had answered, so a failed copy looked exactly like a good one and the next
   * paste put something else into the other device.
   */
  const copyText = async (text: string, key: string) => {
    setError(null)
    try {
      await writeClipboard(text)
    } catch (reason) {
      setError(t('settings.remote.copyFailed', { error: String(reason) }))
      return
    }
    setCopiedAddress(key)
    markCopied()
  }

  const running = status?.running ?? false
  // The port a device should dial is the one the server is actually on. They
  // differ exactly while an edited port has not been saved yet, and offering
  // the unsaved one would be offering an address nothing answers at.
  const dialPort = status?.port ?? config.port

  if (loading) return <SettingsSkeleton />
  if (!loaded) {
    return (
      <SettingsPane>
        <SettingsHeader title={t('settings.remote.title')} subtitle={t('settings.remote.subtitle')} />
        <Alert
          tone="danger"
          shouldAnnounce
          heading={t('settings.remote.loadError')}
          actions={
            <Button
              size="sm"
              variant="secondary"

              onPress={() => {
                setLoading(true)
                void loadData()
              }}
            >
              {t('settings.remote.retry')}
            </Button>
          }
        >
          {loadError}
        </Alert>
      </SettingsPane>
    )
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.remote.title')} subtitle={t('settings.remote.subtitle')} />

      <div data-slot="remote-enable">
        <SettingsGroup>
          <SettingsRow
            label={t('settings.remote.enable')}
            description={<span data-slot="remote-enable-hint">{t('settings.remote.enableHint')}</span>}
          >
            <Switch isSelected={config.enabled} onChange={(selected) => setConfig({ ...config, enabled: selected })} />
          </SettingsRow>
        </SettingsGroup>
      </div>

      <Alert data-slot="remote-trust-warning" tone="warning">
        <span data-slot="remote-trust-warning-text">{t('settings.remote.trustWarning')}</span>
      </Alert>

      <SettingsGroup>
        <div data-slot="remote-endpoint" className="m-remote__group-rows">
          <SettingsRow layout="stacked" label={t('settings.remote.host')} description={t('settings.remote.hostHint')}>
            <TextField
              name="remoteAccessHost"
              value={config.host}
              onChange={(e) => setConfig({ ...config, host: e })}
              placeholder="0.0.0.0"
            />
          </SettingsRow>
          <SettingsRow label={t('settings.remote.port')}>
            <NumberField
              value={draftToNumber(portInput)}
              onChange={(value) => setPortInput(numberToDraft(value))}
              name="remoteAccessPort"
              minValue={1}
              maxValue={65535}
              placeholder="8787"
              formatOptions={PLAIN_INTEGER}
            />
          </SettingsRow>
        </div>

        {/* A generated key shown read-only, with copy: the library's rule is not to
            mask a key nobody types, so there is no reveal toggle. */}
        <div data-slot="remote-token" className="m-remote__group-rows">
          <SettingsRow
            layout="stacked"
            label={t('settings.remote.token')}
            description={<span data-slot="remote-token-hint">{t('settings.remote.tokenHint')}</span>}
          >
            <div data-slot="remote-token-row" className="m-remote__token-row">
              <TextField
                name="remoteAccessToken"
                isReadOnly
                spellCheck="false"
                value={config.token ?? ''}
                placeholder={t('settings.remote.tokenPending')}
                className="m-remote__token-field"
              />
              {/* Copied rather than revealed and retyped: the other device needs it
                  character for character, and it is long on purpose. */}
              <Button
                variant="secondary"
                icon={copied && copiedAddress === TOKEN_COPY_KEY ? <Check /> : <Copy />}
                isDisabled={!config.token}
                onPress={() => config.token && void copyText(config.token, TOKEN_COPY_KEY)}
              >
                {t('settings.remote.copyToken')}
              </Button>
              <Button variant="secondary" onPress={handleRegenerate}>
                {t('settings.remote.regenerate')}
              </Button>
            </div>
          </SettingsRow>
        </div>
      </SettingsGroup>

      {error && (
        <Alert data-slot="remote-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}

      <div data-slot="remote-actions" className="m-remote__actions">
        <Button variant="secondary" onPress={handleSave} isDisabled={saving}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {saved && (
          <span data-slot="remote-saved" role="status" className="m-remote__saved">
            {t('common.saved')}
          </span>
        )}
        {running ? (
          <Button variant="destructive" onPress={handleStop}>
            {t('settings.remote.stop')}
          </Button>
        ) : (
          <Button onPress={handleStart}>{t('settings.remote.start')}</Button>
        )}
      </div>

      {status && (
        <div className="m-remote__status">
          <p className="m-remote__status-title">
            {/* Decoration: the state it stands for is spelled out beside it. */}
            <span
              data-slot="remote-status-dot"
              data-running={running || undefined}
              aria-hidden
              className="m-remote__dot"
            />
            {running ? t('settings.remote.statusRunning') : t('settings.remote.statusStopped')}
          </p>
          {running && (
            <p className="m-remote__hint">
              {t('settings.remote.connections', { count: status.connections })}
              {' · '}
              {status.host}:{status.port}
            </p>
          )}
        </div>
      )}

      <div data-slot="remote-addresses">
        <SettingsGroup
          heading={<span data-slot="remote-addresses-label">{t('settings.remote.addresses')}</span>}
          description={<span data-slot="remote-addresses-hint">{t('settings.remote.addressesHint')}</span>}
          headingLevel={3}
        >
          {addresses.length === 0 ? (
            <div className="m-remote__empty-row">
              <p data-slot="remote-addresses-empty" className="m-remote__hint">
                {t('settings.remote.addressesEmpty')}
              </p>
            </div>
          ) : (
            addresses.map((address) => {
              const dialable = `${address}:${dialPort}`
              return (
                <SettingsRow key={address} label={<span className="m-remote__address-text">{dialable}</span>}>
                  <TooltipTrigger>
                    <Button
                      icon={copied && copiedAddress === dialable ? <Check /> : <Copy />}
                      size="sm"
                      variant="ghost"
                      aria-label={t('settings.remote.copyAddress')}
                      onPress={() => void copyText(dialable, dialable)}
                    />
                    <Tooltip>{t('settings.remote.copyAddress')}</Tooltip>
                  </TooltipTrigger>
                </SettingsRow>
              )
            })
          )}
        </SettingsGroup>
      </div>

      {confirmDialog}
    </SettingsPane>
  )
}
