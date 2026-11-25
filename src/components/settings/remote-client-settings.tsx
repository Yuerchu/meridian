import './remote-client-settings.css'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button as AriaButton, Disclosure, DisclosurePanel } from 'react-aria-components'
import { ChevronDown } from '@keyline-icons/react/two-tone'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { PasswordField } from '@/components/yuerchu-ui/components/password-field/password-field'
import { SettingsGroup } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { draftToNumber, numberToDraft, PLAIN_INTEGER } from '@/lib/number-draft'
import { api } from '@/api'
import { useConnectionState } from '@/hooks/use-connection-state'
import { isRemote, probeRemote, readRemoteConfig, writeRemoteConfig, type ProbeResult } from '@/lib/transport'
import { useSettingsDirtyRegistration } from './dirty-guard'

/**
 * Where *this* device gets its Meridian from.
 *
 * Rendered as a compact M3E-style collapsible summary card when running locally
 * so it stays reachable at the top of General without crowding everyday
 * appearance/language controls off mobile screens; expands inline into a
 * compact host+port / token form on tap, or stays open when connected.
 */
export function RemoteClientSettings() {
  const { t } = useTranslation()
  const state = useConnectionState()
  const [config] = useState(() => readRemoteConfig())

  const [expanded, setExpanded] = useState(false)
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
      await api.secrets.set({ key: 'REMOTE_TOKEN', value: token.trim() })
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
        <SettingsGroup
          heading={t('settings.client.title')}
          description={t('settings.client.disconnectHint')}
          headingLevel={3}
        >
          <div className="m-remote-client__connected-row">
            <div className="m-remote-client__connected-info">
              <p className="m-remote-client__state">
                <span
                  data-slot="remote-client-state-dot"
                  data-state={state}
                  aria-hidden
                  className="m-remote-client__dot"
                />
                {t(`settings.client.state.${state}`)}
              </p>
              <p className="m-remote-client__host">
                {config ? `${config.host}:${config.port}` : t('settings.client.unknownHost')}
              </p>
            </div>
            <Button variant="secondary" size="sm" onPress={handleDisconnect}>
              {t('settings.client.disconnect')}
            </Button>
          </div>
        </SettingsGroup>
      </div>
    )
  }

  const isOpen = expanded || dirty

  return (
    <div data-slot="remote-client" className="m-remote-client">
      <SettingsGroup>
        <Disclosure isExpanded={isOpen} onExpandedChange={setExpanded}>
          <AriaButton slot="trigger" className="m-remote-client__summary">
            <span data-slot="remote-client-label" className="m-remote-client__summary-title">
              {t('settings.client.title')}
            </span>
            <span className="m-remote-client__summary-end">
              <Badge size="sm" tone="neutral">
                {t('settings.client.localSummary')}
              </Badge>
              <ChevronDown
                size={16}
                aria-hidden
                data-expanded={isOpen || undefined}
                className="m-remote-client__chevron"
              />
            </span>
          </AriaButton>
          <DisclosurePanel>
            <div className="m-remote-client__panel">
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
              />

              <div data-slot="remote-client-actions" className="m-remote-client__actions">
                <Button
                  variant="secondary"
                  onPress={handleTest}
                  isDisabled={!host.trim() || probing}
                  aria-busy={probing}
                >
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
          </DisclosurePanel>
        </Disclosure>
      </SettingsGroup>
    </div>
  )
}

function ProbeMessage({ probe }: { probe: ProbeResult }) {
  const { t } = useTranslation()

  if (probe.ok) {
    return (
      <p data-slot="remote-client-probe-ok" role="status" className="m-remote-client__ok">
        {t('settings.client.testOk', { version: probe.version })}
      </p>
    )
  }

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
