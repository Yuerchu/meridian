import './voice-corpus-settings.css'
import { Checkbox } from '@/components/yuerchu-ui/components/checkbox/checkbox'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { Bin } from '@keyline-icons/react/two-tone'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { api } from '@/api'
import type { VoiceCorpusDeleteResponse, VoiceCorpusSessionInfoResponse } from '@/types'
import { can } from '@/lib/capabilities'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { SettingsHeader, SettingsPane } from './primitives'
import { useConfirm } from '@/hooks/use-confirm'
import { titleIfTruncated } from '@/lib/truncation'

function formatSize(bytes: number, number: Intl.NumberFormat): string {
  if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`
  return `${number.format(bytes / 1024 / 1024)} MB`
}

/**
 * Stored voice: what is kept, and the two separate ways to stop keeping it.
 *
 * A page of its own rather than a section of OneBot settings, because that
 * panel is hidden outright in remote mode — and deleting is exactly the action
 * someone performs from their phone. What is *not* here is the allowlist that
 * decides what gets kept in the first place; that stays with the connection it
 * belongs to.
 */
export function VoiceCorpusSettings() {
  const { t, i18n } = useTranslation()
  const [sessions, setSessions] = useState<VoiceCorpusSessionInfoResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [senderInput, setSenderInput] = useState('')
  const [includeSender, setIncludeSender] = useState(false)
  const [includeUntranscribed, setIncludeUntranscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  const sizeNumber = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, { maximumFractionDigits: 1 }),
    [i18n.language, i18n.resolvedLanguage],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSessions(await api.listVoiceCorpus())
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const message = await work()
      if (message) setNotice(message)
      await load()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  // Failures are listed rather than folded into the count: the files and the
  // rows can fail independently, and one number cannot say which half. Reading
  // only `clips` reports a delete that left the audio on disk as a clean one.
  const deleteMessage = (report: VoiceCorpusDeleteResponse, key: 'deleted' | 'forgot') =>
    report.failures.length > 0
      ? t('settings.voiceCorpus.deletedWithFailures', { clips: report.clips, failures: report.failures.length })
      : t(`settings.voiceCorpus.${key}`, { clips: report.clips })

  const deleteSession = async (session: VoiceCorpusSessionInfoResponse) => {
    if (
      !(await confirm({
        description: t('settings.voiceCorpus.deleteSessionConfirm', { handle: session.handle }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    await run(async () =>
      deleteMessage(await api.deleteVoiceCorpus({ selector: { kind: 'session', handle: session.handle } }), 'deleted'),
    )
  }

  const forgetSender = async () => {
    const id = senderInput.trim()
    if (
      !id ||
      !(await confirm({
        description: t('settings.voiceCorpus.forgetSenderConfirm', { sender: id }),
        confirmLabel: t('settings.voiceCorpus.forget'),
        tone: 'danger',
      }))
    )
      return
    await run(async () => {
      // One call. Deleting history and refusing the future are two actions, and
      // this button means both — but sent as two calls the barrier comes down
      // between them while the opt-out is not yet in force, so anything
      // recorded in the gap is a recording nothing will go back for.
      const report = await api.forgetVoiceSender({ senderId: id })
      setSenderInput('')
      return deleteMessage(report, 'forgot')
    })
  }

  const exportBundle = () =>
    run(async () => {
      const dir = await save({ title: t('settings.voiceCorpus.export'), defaultPath: 'voice-corpus' })
      if (!dir) return null
      const report = await api.exportVoiceCorpus({
        outputDir: dir,
        includeSender,
        includeUntranscribed,
      })
      return t('settings.voiceCorpus.exported', { clips: report.clips, skipped: report.skipped })
    })

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.voiceCorpus.title')} subtitle={t('settings.voiceCorpus.description')} />

      {error && (
        <Alert data-slot="voice-corpus-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}
      {notice && (
        <p data-slot="voice-corpus-notice" role="status" className="m-voice-corpus__notice">
          {notice}
        </p>
      )}

      <SettingsGroup>
        {loading ? (
          <div
            data-slot="voice-corpus-loading"
            role="status"
            aria-label={t('common.loading')}
            className="m-voice-corpus__loading"
          >
            <span aria-hidden>
              <Spinner size="sm" />
            </span>
            {t('common.loading')}
          </div>
        ) : sessions.length === 0 ? (
          <p data-slot="voice-corpus-empty" className="m-voice-corpus__empty">
            {t('settings.voiceCorpus.empty')}
          </p>
        ) : (
          sessions.map((session) => (
            <SettingsRow
              key={session.handle}
              label={
                <span className="m-voice-corpus__title" onPointerEnter={titleIfTruncated}>
                  {t(`settings.voiceCorpus.kind.${session.kind}`)} · {session.handle}
                </span>
              }
              description={
                <span className="m-voice-corpus__summary">
                  {t('settings.voiceCorpus.summary', {
                    clips: session.clips,
                    size: formatSize(session.bytes, sizeNumber),
                    untranscribed: session.untranscribed,
                  })}
                </span>
              }
            >
              <TooltipTrigger>
                <Button
                  icon={<Bin />}
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => deleteSession(session)}
                  aria-label={t('settings.voiceCorpus.deleteSession')}
                />
                <Tooltip>{t('settings.voiceCorpus.deleteSession')}</Tooltip>
              </TooltipTrigger>
            </SettingsRow>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          layout="stacked"
          label={t('settings.voiceCorpus.forgetSender')}
          description={t('settings.voiceCorpus.forgetSenderHint')}
        >
          <div data-slot="voice-corpus-forget-row" className="m-voice-corpus__forget">
            <TextField
              value={senderInput}
              onChange={setSenderInput}
              placeholder="12345"
              className="m-voice-corpus__sender"
            />
            <Button variant="secondary" isDisabled={busy || !senderInput.trim()} onPress={forgetSender}>
              {t('settings.voiceCorpus.forget')}
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>

      {can.exportToDisk && (
        <SettingsGroup>
          <div data-slot="voice-corpus-export" className="m-voice-corpus__export">
            <Checkbox isSelected={includeUntranscribed} onChange={setIncludeUntranscribed}>
              {t('settings.voiceCorpus.includeUntranscribed')}
            </Checkbox>
            <Checkbox isSelected={includeSender} onChange={setIncludeSender}>
              {t('settings.voiceCorpus.includeSender')}
            </Checkbox>
            <p data-slot="voice-corpus-export-hint" className="m-voice-corpus__notice">
              {t('settings.voiceCorpus.exportHint')}
            </p>
            <div>
              <Button variant="secondary" isDisabled={busy || sessions.length === 0} onPress={exportBundle}>
                {t('settings.voiceCorpus.export')}
              </Button>
            </div>
          </div>
        </SettingsGroup>
      )}
      {confirmDialog}
    </SettingsPane>
  )
}
