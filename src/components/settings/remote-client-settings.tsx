import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Description, Input, Label, TextField } from '@/components/base'
import { ItemCard } from '@/components/base'

import { api } from '@/api'
import { useConnectionState } from '@/hooks/use-connection-state'
import { cn } from '@/lib/utils'
import { isRemote, probeRemote, readRemoteConfig, writeRemoteConfig, type ProbeResult } from '@/lib/transport'
import { useSettingsDirtyRegistration } from './dirty-guard'

/**
 * Where *this* device gets its Meridian from.
 *
 * The counterpart to `remote-access-settings.tsx`, and deliberately not in it:
 * that panel is one of the three the tab list hides on a phone, because a phone
 * is the client in this arrangement rather than the host. A phone that cannot
 * see the panel cannot type an address into it.
 *
 * It sits at the top of General for the same reason the theme and the language
 * do — those are the settings that describe the device in front of you rather
 * than the app's own state, and this one has to be, since in remote mode every
 * other setting on the page belongs to the machine across the room. It is also
 * the only control that still works when that machine has stopped answering,
 * which is exactly when someone comes looking for it.
 */
export function RemoteClientSettings() {
  const { t } = useTranslation()
  const state = useConnectionState()
  const [config] = useState(() => readRemoteConfig())

  const [host, setHost] = useState('')
  const [port, setPort] = useState('8787')
  const [token, setToken] = useState('')
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const parsedPort = Number(port)
  const validPort = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
  const dirty = host !== '' || port !== '8787' || token !== ''
  useSettingsDirtyRegistration('general', 'remote-client', !isRemote && dirty)

  const handleTest = async () => {
    if (!validPort) {
      setError(t('settings.validation.port'))
      return
    }
    setProbing(true)
    setError(null)
    try {
      setProbe(await probeRemote(host.trim(), parsedPort))
    } finally {
      setProbing(false)
    }
  }

  /**
   * The token first, then the address, then a reload.
   *
   * That order matters: the transport reads the address once at module load and
   * resolves the token from the keychain in its constructor, so an address
   * written before the token exists would produce a session that starts
   * authenticating with an empty string. The reload is what applies any of it —
   * see the note on `transport` about why this cannot be switched in place.
   */
  const handleConnect = async () => {
    setError(null)
    if (!validPort) {
      setError(t('settings.validation.port'))
      return
    }
    try {
      await api.setSecret({ key: 'REMOTE_TOKEN', value: token.trim() })
    } catch (err) {
      setError(String(err))
      return
    }
    writeRemoteConfig({ host: host.trim(), port: parsedPort })
    window.location.reload()
  }

  const handleDisconnect = () => {
    writeRemoteConfig(null)
    window.location.reload()
  }

  if (isRemote) {
    const offline = state === 'offline'
    return (
      <div data-slot="remote-client-connected" className="space-y-3">
        <p data-slot="remote-client-label" className="block text-xs font-medium text-muted">
          {t('settings.client.title')}
        </p>
        <ItemCard variant="outline">
          <ItemCard.Content className="min-w-0">
            <ItemCard.Title className="flex w-full items-center gap-2">
              {/* Decoration: the state it stands for is spelled out beside it. */}
              <span
                data-slot="remote-client-state-dot"
                aria-hidden
                className={cn(
                  'inline-block size-2 shrink-0 rounded-full',
                  state === 'connected' ? 'bg-success' : offline ? 'bg-danger' : 'bg-warning',
                )}
              />
              {t(`settings.client.state.${state}`)}
            </ItemCard.Title>
            <ItemCard.Description className="w-full truncate font-mono">
              {config ? `${config.host}:${config.port}` : t('settings.client.unknownHost')}
            </ItemCard.Description>
          </ItemCard.Content>
        </ItemCard>
        <Button variant="outline" onPress={handleDisconnect}>
          {t('settings.client.disconnect')}
        </Button>
        <p data-slot="remote-client-disconnect-hint" className="text-xs text-muted">
          {t('settings.client.disconnectHint')}
        </p>
      </div>
    )
  }

  return (
    <div data-slot="remote-client" className="space-y-3">
      <p data-slot="remote-client-label" className="block text-xs font-medium text-muted">
        {t('settings.client.title')}
      </p>
      <p data-slot="remote-client-intro" className="text-xs text-muted">
        {t('settings.client.intro')}
      </p>

      <div data-slot="remote-client-endpoint" className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-3">
        <TextField fullWidth>
          <Label>{t('settings.client.host')}</Label>
          <Input
            name="remoteClientHost"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.20"
          />
        </TextField>
        <TextField fullWidth type="number">
          <Label>{t('settings.client.port')}</Label>
          <Input
            min={1}
            max={65535}
            name="remoteClientPort"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="8787"
          />
        </TextField>
      </div>

      <TextField fullWidth type="password">
        <Label>{t('settings.client.token')}</Label>
        <Input
          name="remoteClientToken"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="max-w-xs"
        />
        <Description>{t('settings.client.tokenHint')}</Description>
      </TextField>

      <div data-slot="remote-client-actions" className="flex items-center gap-2">
        <Button variant="outline" onPress={handleTest} isDisabled={!host.trim() || probing} aria-busy={probing}>
          {probing ? t('settings.client.testing') : t('settings.client.test')}
        </Button>
        <Button onPress={handleConnect} isDisabled={!host.trim() || !token.trim()}>
          {t('settings.client.connect')}
        </Button>
      </div>

      {probe && <ProbeMessage probe={probe} />}
      {error && (
        <p data-slot="remote-client-error" role="alert" className="text-xs text-danger break-all">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * What the probe found, said in the terms of what to do about it.
 *
 * `role="status"` because pressing a button and getting a line of text that is
 * only a colour is no answer at all to anyone not looking at it.
 */
function ProbeMessage({ probe }: { probe: ProbeResult }) {
  const { t } = useTranslation()

  if (probe.ok) {
    return (
      <p data-slot="remote-client-probe-ok" role="status" className="text-xs text-success-soft-foreground">
        {t('settings.client.testOk', { version: probe.version })}
      </p>
    )
  }

  // A version mismatch names itself. Folded into "could not connect" it sends
  // the user back to check an address that was right all along.
  const message =
    probe.reason === 'client-too-old' || probe.reason === 'server-too-old'
      ? t(`settings.client.${probe.reason === 'client-too-old' ? 'testClientOld' : 'testServerOld'}`, {
          apiRev: probe.apiRev,
          minClientRev: probe.minClientRev,
        })
      : t(probe.reason === 'malformed' ? 'settings.client.testMalformed' : 'settings.client.testUnreachable')

  return (
    <p data-slot="remote-client-probe-failed" role="status" className="text-xs text-danger">
      {message}
    </p>
  )
}
