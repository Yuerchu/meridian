import { Fragment, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Description, Input, Label, Separator, TextField } from '@heroui/react'
import { ItemCard } from '@heroui-pro/react/item-card'
import { ItemCardGroup } from '@heroui-pro/react/item-card-group'
import { Check, Copy, TriangleExclamation } from '@gravity-ui/icons'

import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { cn } from '@/lib/utils'
import type { ListenConfigInfoResponse, ListenStatusResponse } from '@/types'
import { SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import { useSettingsDirtyRegistration } from './dirty-guard'

/** Mirrors `ListenConfig::default()`; only used until the first load lands. */
const DEFAULTS: ListenConfigInfoResponse = {
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
  const [config, setConfig] = useState<ListenConfigInfoResponse>(DEFAULTS)
  const [status, setStatus] = useState<ListenStatusResponse | null>(null)
  const [addresses, setAddresses] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, markSaved] = useTemporaryFlag()
  const [revealToken, setRevealToken] = useState(false)
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
        api.getListenConfig(),
        api.getListenStatus(),
        api.getListenAddresses(),
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
        setStatus(await api.getListenStatus())
      } catch {
        // Polling failures are not worth a banner: the next tick will say.
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  /**
   * Read the config back after anything that could have minted a token.
   *
   * `save`, `start` and `stop` all answer with the status rather than the
   * config, and the backend creates a token behind the first two — so the panel
   * would otherwise go on showing "generated on first save" for a server that
   * already has one.
   */
  const adoptConfig = async () => {
    try {
      const next = await api.getListenConfig()
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
      setStatus(await api.saveListenConfig({ ...config, port }))
      await adoptConfig()
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
    // started: `start_listen` reads the stored config, not this one.
    if (!(await handleSave())) return
    try {
      setStatus(await api.startListen())
      await adoptConfig()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleStop = async () => {
    setError(null)
    try {
      setStatus(await api.stopListen())
      await adoptConfig()
    } catch (err) {
      setError(String(err))
    }
  }

  const handleRegenerate = async () => {
    if (!(await confirm({ body: t('settings.remote.regenerateConfirm'), status: 'warning' }))) return
    setError(null)
    try {
      const next = await api.regenerateListenToken()
      const nextPort = next.port.toString()
      setConfig(next)
      setPortInput(nextPort)
      setSavedDraft(JSON.stringify({ ...next, token: undefined, port: nextPort }))
      setStatus(await api.getListenStatus())
    } catch (err) {
      setError(String(err))
    }
  }

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address)
    setCopiedAddress(address)
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
        <div role="alert" className="space-y-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <p>{t('settings.remote.loadError')}</p>
          {loadError && <p className="break-all">{loadError}</p>}
          <Button
            size="sm"
            variant="outline"
            onPress={() => {
              setLoading(true)
              void loadData()
            }}
          >
            {t('settings.remote.retry')}
          </Button>
        </div>
      </SettingsPane>
    )
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.remote.title')} subtitle={t('settings.remote.subtitle')} />

      <div className="flex items-start gap-2">
        {/* Label stays outside because a description sits under it; the id is
            what ties the two together. */}
        <Checkbox
          id="remote-enabled"
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
          <label htmlFor="remote-enabled" className="text-sm font-medium cursor-pointer">
            {t('settings.remote.enable')}
          </label>
          <p className="text-xs text-muted">{t('settings.remote.enableHint')}</p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border p-3">
        <TriangleExclamation className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground" aria-hidden />
        <p className="text-xs text-warning-soft-foreground">{t('settings.remote.trustWarning')}</p>
      </div>

      <div className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-3">
        <TextField fullWidth>
          <Label>{t('settings.remote.host')}</Label>
          <Input
            name="remoteAccessHost"
            value={config.host}
            onChange={(e) => setConfig({ ...config, host: e.target.value })}
            placeholder="0.0.0.0"
          />
          <Description>{t('settings.remote.hostHint')}</Description>
        </TextField>
        <TextField fullWidth type="number">
          <Label>{t('settings.remote.port')}</Label>
          <Input
            name="remoteAccessPort"
            inputMode="numeric"
            min={1}
            max={65535}
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            placeholder="8787"
          />
        </TextField>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted">{t('settings.remote.token')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            fullWidth
            aria-label={t('settings.remote.token')}
            name="remoteAccessToken"
            autoComplete="off"
            readOnly
            type={revealToken ? 'text' : 'password'}
            value={config.token ?? ''}
            placeholder={t('settings.remote.tokenPending')}
          />
          <Button variant="outline" onPress={() => setRevealToken(!revealToken)}>
            {revealToken ? t('settings.remote.hide') : t('settings.remote.reveal')}
          </Button>
          <Button variant="outline" onPress={handleRegenerate}>
            {t('settings.remote.regenerate')}
          </Button>
        </div>
        <p className="text-xs text-muted">{t('settings.remote.tokenHint')}</p>
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
            {t('settings.remote.stop')}
          </Button>
        ) : (
          <Button onPress={handleStart}>{t('settings.remote.start')}</Button>
        )}
      </div>

      {status && (
        <ItemCard variant="outline">
          <ItemCard.Content className="min-w-0">
            <ItemCard.Title className="flex w-full items-center gap-2">
              {/* Decoration: the state it stands for is spelled out beside it,
                so announcing the dot too would only say it twice. */}
              <span
                aria-hidden
                className={cn('inline-block size-2 shrink-0 rounded-full', running ? 'bg-success' : 'bg-muted')}
              />
              {running ? t('settings.remote.statusRunning') : t('settings.remote.statusStopped')}
            </ItemCard.Title>
            {running && (
              <ItemCard.Description className="w-full whitespace-normal">
                {t('settings.remote.connections', { count: status.connections })}
                {' · '}
                {status.host}:{status.port}
              </ItemCard.Description>
            )}
          </ItemCard.Content>
        </ItemCard>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted">{t('settings.remote.addresses')}</p>
        {addresses.length === 0 ? (
          <p className="text-xs text-muted">{t('settings.remote.addressesEmpty')}</p>
        ) : (
          <ItemCardGroup variant="outline">
            {addresses.map((address, index) => {
              const dialable = `${address}:${dialPort}`
              return (
                <Fragment key={address}>
                  {index > 0 && <Separator />}
                  <ItemCard>
                    <ItemCard.Content className="min-w-0">
                      <ItemCard.Title className="w-full break-all font-mono">{dialable}</ItemCard.Title>
                    </ItemCard.Content>
                    <ItemCard.Action>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        aria-label={t('settings.remote.copyAddress')}
                        onPress={() => copyAddress(dialable)}
                      >
                        {copied && copiedAddress === dialable ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </Button>
                    </ItemCard.Action>
                  </ItemCard>
                </Fragment>
              )
            })}
          </ItemCardGroup>
        )}
        <p className="text-xs text-muted">{t('settings.remote.addressesHint')}</p>
      </div>

      {confirmDialog}
    </SettingsPane>
  )
}
