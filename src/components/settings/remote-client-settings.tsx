import './remote-client-settings.css'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { draftToNumber, numberToDraft, PLAIN_INTEGER } from '@/lib/number-draft'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { PasswordField } from '@/components/yuerchu-ui/components/password-field/password-field'
import { api } from '@/api'
import { useConnectionState } from '@/hooks/use-connection-state'
import { isRemote, probeRemote, readRemoteConfig, writeRemoteConfig, type ProbeResult } from '@/lib/transport'
import { useSettingsDirtyRegistration } from './dirty-guard'
import { titleIfTruncated } from '@/lib/truncation'

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
    return (
      <div data-slot="remote-client-connected" className="m-remote-client">
        <p data-slot="remote-client-label" className="m-remote-client__label">
          {t('settings.client.title')}
        </p>
        <div className="m-remote-client__card">
          <p className="m-remote-client__state">
            {/* Decoration: the state it stands for is spelled out beside it. */}
            <span data-slot="remote-client-state-dot" data-state={state} aria-hidden className="m-remote-client__dot" />
            {t(`settings.client.state.${state}`)}
          </p>
          <p className="m-remote-client__host" onPointerEnter={titleIfTruncated}>
            {config ? `${config.host}:${config.port}` : t('settings.client.unknownHost')}
          </p>
        </div>
        <Button variant="secondary" onPress={handleDisconnect}>
          {t('settings.client.disconnect')}
        </Button>
        <p data-slot="remote-client-disconnect-hint" className="m-remote-client__hint">
          {t('settings.client.disconnectHint')}
        </p>
      </div>
    )
  }

  return (
    <div data-slot="remote-client" className="m-remote-client">
      <p data-slot="remote-client-label" className="m-remote-client__label">
        {t('settings.client.title')}
      </p>
      <p data-slot="remote-client-intro" className="m-remote-client__hint">
        {t('settings.client.intro')}
      </p>

      <div data-slot="remote-client-endpoint" className="m-remote-client__endpoint">
        <TextField
          label={t('settings.client.host')}
          name="remoteClientHost"
          value={host}
          onChange={setHost}
          placeholder="192.168.1.20"
        />
        <NumberField
          label={t('settings.client.port')}
          value={draftToNumber(port)}
          onChange={(value) => setPort(numberToDraft(value))}
          minValue={1}
          maxValue={65535}
          name="remoteClientPort"
          placeholder="8787"
          formatOptions={PLAIN_INTEGER}
        />
      </div>

      <PasswordField
        label={t('settings.client.token')}
        description={t('settings.client.tokenHint')}
        name="remoteClientToken"
        // A secret, not an account password; the library has no purpose for it yet (Yuerchu/ui#570).
        autoComplete="current-password"
        value={token}
        onChange={setToken}
        className="m-remote-client__token"
      />

      <div data-slot="remote-client-actions" className="m-remote-client__actions">
        <Button variant="secondary" onPress={handleTest} isDisabled={!host.trim() || probing} aria-busy={probing}>
          {probing ? t('settings.client.testing') : t('settings.client.test')}
        </Button>
        <Button onPress={handleConnect} isDisabled={!host.trim() || !token.trim()}>
          {t('settings.client.connect')}
        </Button>
      </div>

      {probe && <ProbeMessage probe={probe} />}
      {error && (
        <Alert data-slot="remote-client-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}
    </div>
  )
}

/**
 * What the probe found, said in the terms of what to do about it.
 *
 * Announced either way, because pressing a button and getting a line of text
 * that is only a colour is no answer at all to anyone not looking at it — a
 * success politely (`status`), a failure at once (`alert`), which is how every
 * other failure on these pages is announced.
 */
function ProbeMessage({ probe }: { probe: ProbeResult }) {
  const { t } = useTranslation()

  if (probe.ok) {
    return (
      <p data-slot="remote-client-probe-ok" role="status" className="m-remote-client__ok">
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
    <Alert data-slot="remote-client-probe-failed" tone="danger" shouldAnnounce>
      {message}
    </Alert>
  )
}
