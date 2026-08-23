import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Label, TextArea } from '@heroui/react'
import { api } from '@/api'
import { cn } from '@/lib/utils'
import type { AcpCheck, AcpConfig } from '@/types'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'

/**
 * Mirrors `AcpConfig::default()`. Duplicated rather than fetched because the
 * panel needs something to render on the first frame, and the backend answers
 * with the stored values a moment later anyway.
 */
const DEFAULTS: AcpConfig = {
  command: 'npx',
  args: ['-y', '@zed-industries/claude-code-acp'],
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
  const commandId = useId()
  const argsId = useId()
  const [config, setConfig] = useState<AcpConfig | null>(null)
  const [argsText, setArgsText] = useState('')
  const [saved, setSaved] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<AcpCheck | null>(null)
  /**
   * What is on disk, as opposed to what is in the fields.
   *
   * The check runs the *saved* command — `acp_check_adapter` reads the
   * preferences, not the form — so a verdict about an edited-but-unsaved field
   * is a verdict about something else entirely, delivered by the one control on
   * this page that looks authoritative. `save` already clears a stale verdict
   * for the same reason; this is the other direction.
   */
  const [onDisk, setOnDisk] = useState<AcpConfig | null>(null)
  /** Which check is the current one. See the picker's `generation`: the button
   *  is pressable again while a 120-second timeout is still outstanding, and
   *  the slow answer must not land on top of the fast one. */
  const attempt = useRef(0)

  useEffect(() => {
    api
      .acpGetConfig()
      .then((loaded) => {
        setConfig(loaded)
        setOnDisk(loaded)
        setArgsText(loaded.args.join('\n'))
      })
      .catch(() => {
        setConfig(DEFAULTS)
        setOnDisk(DEFAULTS)
        setArgsText(DEFAULTS.args.join('\n'))
      })
  }, [])

  const save = useCallback(async () => {
    if (!config) return
    const next = await api.acpSaveConfig({ command: config.command.trim(), args: parseArgs(argsText) })
    setConfig(next)
    setOnDisk(next)
    setArgsText(next.args.join('\n'))
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
      const verdict = await api.acpCheckAdapter()
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

      <div className="space-y-2">
        <Label htmlFor={commandId}>{t('settings.acp.command')}</Label>
        <Input
          id={commandId}
          fullWidth
          value={config.command}
          onChange={(e) => setConfig({ ...config, command: e.target.value })}
          placeholder={DEFAULTS.command}
        />
        <p className="text-xs text-muted">{t('settings.acp.commandHint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={argsId}>{t('settings.acp.args')}</Label>
        <TextArea
          id={argsId}
          fullWidth
          rows={3}
          spellCheck={false}
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted">{t('settings.acp.argsHint')}</p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={() => void save()} isDisabled={!config.command.trim()}>
          {t('common.save')}
        </Button>
        {/* Refused while the fields are ahead of the file: the check starts
            the *saved* command, so a verdict now would be about the previous
            one and would read as being about what is on screen. */}
        <Button variant="secondary" onClick={() => void runCheck()} isDisabled={checking || dirty}>
          {checking ? t('settings.acp.checking') : t('settings.acp.check')}
        </Button>
        {dirty && !checking && <p className="text-xs text-muted">{t('settings.acp.saveBeforeCheck')}</p>}
      </div>

      {check && (
        <div
          role="status"
          className={cn(
            'rounded-lg border px-3 py-2 text-xs',
            check.ok ? 'border-success text-success-soft-foreground' : 'border-danger text-danger',
          )}
        >
          {check.ok ? (
            <>
              <p>{t('settings.acp.checkOk', { agent: check.agent ?? t('settings.acp.unnamedAgent') })}</p>
              <p className="mt-1 text-muted">
                {t('settings.acp.protocolVersion', { version: check.protocol_version ?? '?' })}
                {check.load_session ? ` · ${t('settings.acp.supportsResume')}` : ''}
              </p>
            </>
          ) : (
            // The adapter's own stderr, which is where "command not found" and a
            // node stack trace both end up. Wrapped rather than truncated: the
            // useful part is often at the end.
            <p className="break-words whitespace-pre-wrap">{check.error}</p>
          )}
        </div>
      )}

      <p className="text-xs text-muted">{t('settings.acp.authNote')}</p>
    </SettingsPane>
  )
}
