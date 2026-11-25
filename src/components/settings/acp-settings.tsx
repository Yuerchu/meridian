import './acp-settings.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { api } from '@/api'
import type { AcpCheckResponse, AcpConfigInfoResponse } from '@/types'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import { useSettingsDirtyRegistration } from './dirty-guard'

/**
 * Mirrors `AcpConfig::default()`. A placeholder only: the form is drawn from
 * what the backend answers, never from this — a failed read drawn as the
 * default command is one Save away from replacing the one the user configured.
 */
const DEFAULTS: AcpConfigInfoResponse = {
  command: 'npx',
  args: ['-y', '@agentclientprotocol/claude-agent-acp@0.84.0'],
}

/**
 * Arguments, one per line.
 *
 * Not a space-separated field: an argument containing a space is ordinary on
 * Windows — a path under `Program Files` — and splitting one back apart is how
 * that breaks. Blank lines are dropped rather than sent as empty arguments,
 * which some commands treat as a positional.
 */
function parseArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function AcpSettings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AcpConfigInfoResponse | null>(null)
  const [argsText, setArgsText] = useState('')
  const [saved, setSaved] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<AcpCheckResponse | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  /**
   * What is on disk, as opposed to what is in the fields.
   *
   * The check runs the *saved* command — `acp_check_adapter` reads the
   * preferences, not the form — so a verdict about an edited-but-unsaved field
   * is a verdict about something else entirely, delivered by the one control on
   * this page that looks authoritative. `save` already clears a stale verdict
   * for the same reason; this is the other direction.
   */
  const [onDisk, setOnDisk] = useState<AcpConfigInfoResponse | null>(null)
  /** Which check is the current one. See the picker's `generation`: the button
   *  is pressable again while a 120-second timeout is still outstanding, and
   *  the slow answer must not land on top of the fast one. */
  const attempt = useRef(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    api.acp
      .getConfig()
      .then((loaded) => {
        if (cancelled) return
        setConfig(loaded)
        setOnDisk(loaded)
        setArgsText(loaded.args.join('\n'))
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoadError(String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  const save = useCallback(async () => {
    if (!config) return
    setSaveError(null)
    let next: AcpConfigInfoResponse
    try {
      next = await api.acp.setConfig({ command: config.command.trim(), args: parseArgs(argsText) })
      setConfig(next)
      setOnDisk(next)
      setArgsText(next.args.join('\n'))
    } catch (reason) {
      setSaveError(String(reason))
      return
    }
    // A stale verdict is worse than none: it was about the command that was
    // configured a moment ago, and it is the one thing on this page that looks
    // authoritative.
    //
    // Clearing it is not enough on its own. `acp_check_adapter` runs the saved
    // command with a 120-second budget, so a check started before this save is
    // still outstanding — and it would land afterwards, under the new command,
    // saying something true about the old one. Retiring its generation is what
    // stops that; `checking` goes with it, because the answer that would have
    // cleared the spinner is no longer allowed to touch anything.
    attempt.current += 1
    setChecking(false)
    setCheck(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [config, argsText])

  const runCheck = useCallback(async () => {
    const mine = ++attempt.current
    setChecking(true)
    setCheck(null)
    try {
      const verdict = await api.acp.testAdapter()
      if (attempt.current === mine) setCheck(verdict)
    } catch (err) {
      if (attempt.current === mine) {
        setCheck({ ok: false, agent: null, protocol_version: null, load_session: false, error: String(err) })
      }
    } finally {
      if (attempt.current === mine) setChecking(false)
    }
  }, [])

  /** The fields say something the saved configuration does not. */
  const dirty =
    config !== null &&
    onDisk !== null &&
    (config.command.trim() !== onDisk.command || parseArgs(argsText).join('\n') !== onDisk.args.join('\n'))
  useSettingsDirtyRegistration('acp', 'acp-config', dirty)

  // No form without the stored configuration: `acp.command` is a binary this
  // app executes, and a Save over a form it could not read would replace it.
  if (!config && loadError !== null) {
    return (
      <SettingsPane>
        <SettingsHeader title={t('settings.acp.title')} subtitle={t('settings.acp.subtitle')} />
        <Alert
          data-slot="acp-load-error"
          tone="danger"
          shouldAnnounce
          heading={t('settings.acp.loadError')}
          actions={
            <Button size="sm" variant="secondary" onPress={() => setLoadAttempt((n) => n + 1)}>
              {t('common.retry')}
            </Button>
          }
        >
          {loadError}
        </Alert>
      </SettingsPane>
    )
  }

  // First load only. A refresh gets the spinner on the button that asked for it.
  if (!config) {
    return (
      <SettingsPane>
        <SettingsSkeleton rows={3} />
      </SettingsPane>
    )
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title={t('settings.acp.title')}
        subtitle={t('settings.acp.subtitle')}
        actions={saved ? <SavedHint /> : null}
      />

      <SettingsGroup>
        <SettingsRow layout="stacked" label={t('settings.acp.command')} description={t('settings.acp.commandHint')}>
          <TextField
            name="acpCommand"
            value={config.command}
            onChange={(e) => setConfig({ ...config, command: e })}
            placeholder={DEFAULTS.command}
          />
        </SettingsRow>

        <SettingsRow layout="stacked" label={t('settings.acp.args')} description={t('settings.acp.argsHint')}>
          <TextArea
            name="acpArgs"
            rows={3}
            spellCheck="false"
            value={argsText}
            onChange={setArgsText}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void save()
            }}
          />
        </SettingsRow>
      </SettingsGroup>

      {saveError && (
        <Alert data-slot="acp-save-error" tone="danger" shouldAnnounce>
          {saveError}
        </Alert>
      )}

      <div data-slot="acp-actions" className="m-acp__actions">
        <Button variant="primary" onPress={() => void save()} isDisabled={!config.command.trim()}>
          {t('common.save')}
        </Button>
        {/* Refused while the fields are ahead of the file: the check starts
            the *saved* command, so a verdict now would be about the previous
            one and would read as being about what is on screen. */}
        <Button variant="secondary" onPress={() => void runCheck()} isDisabled={checking || dirty}>
          {checking ? t('settings.acp.checking') : t('settings.acp.check')}
        </Button>
        {dirty && !checking && (
          <p data-slot="acp-save-before-check" className="m-acp__note">
            {t('settings.acp.saveBeforeCheck')}
          </p>
        )}
      </div>

      {check && (
        <Alert data-slot="acp-check-result" tone={check.ok ? 'success' : 'danger'} shouldAnnounce>
          {check.ok ? (
            <>
              <p data-slot="acp-check-agent">
                {t('settings.acp.checkOk', { agent: check.agent ?? t('settings.acp.unnamedAgent') })}
              </p>
              <p data-slot="acp-check-protocol" className="m-acp__note">
                {t('settings.acp.protocolVersion', { version: check.protocol_version ?? '?' })}
                {check.load_session ? ` · ${t('settings.acp.supportsResume')}` : ''}
              </p>
            </>
          ) : (
            // The adapter's own stderr, which is where "command not found" and a
            // node stack trace both end up. Wrapped rather than truncated: the
            // useful part is often at the end.
            <p data-slot="acp-check-error">{check.error}</p>
          )}
        </Alert>
      )}

      <p data-slot="acp-auth-note" className="m-acp__note">
        {t('settings.acp.authNote')}
      </p>
    </SettingsPane>
  )
}
