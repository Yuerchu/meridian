import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { TrashBin } from '@gravity-ui/icons'
import { Button, Card, Checkbox, Description, Input, Label, TextField } from '@heroui/react'
import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { SettingsHeader, SettingsPane } from './primitives'

interface CorpusSession {
  label: string
  bot_self_id: number
  session: string
  clips: number
  bytes: number
  untranscribed: number
  last_captured_at: number
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<CorpusSession[]>([])
  const [senderInput, setSenderInput] = useState('')
  const [includeSender, setIncludeSender] = useState(false)
  const [includeUntranscribed, setIncludeUntranscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSessions(await api.listVoiceCorpus())
    } catch (err) {
      setError(String(err))
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

  const deleteSession = (session: CorpusSession) =>
    run(async () => {
      const report = await api.deleteVoiceCorpus({
        kind: 'bot_session',
        bot_self_id: session.bot_self_id,
        session: session.session,
      })
      // Failures are listed rather than folded into the count: the files and
      // the rows can fail independently, and one number cannot say which half.
      return report.failures.length > 0
        ? t('settings.voiceCorpus.deletedWithFailures', { clips: report.clips, failures: report.failures.length })
        : t('settings.voiceCorpus.deleted', { clips: report.clips })
    })

  const forgetSender = () =>
    run(async () => {
      const id = senderInput.trim()
      if (!id) return null
      const report = await api.deleteVoiceCorpus({ kind: 'sender', id })
      // Deleting history and refusing the future are two actions. This button
      // does both because that is what "delete my voice" almost always means —
      // but they are two calls, and the wording says so.
      await api.setVoiceOptout(id, true)
      setSenderInput('')
      return t('settings.voiceCorpus.forgot', { clips: report.clips })
    })

  const exportBundle = () =>
    run(async () => {
      const dir = await save({ title: t('settings.voiceCorpus.export'), defaultPath: 'voice-corpus' })
      if (!dir) return null
      const report = await api.exportVoiceCorpus(dir, includeSender, includeUntranscribed)
      return t('settings.voiceCorpus.exported', { clips: report.clips, skipped: report.skipped })
    })

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.voiceCorpus.title')} subtitle={t('settings.voiceCorpus.description')} />

      {error && <p className="text-danger text-sm">{error}</p>}
      {notice && <p className="text-muted text-sm">{notice}</p>}

      {sessions.length === 0 ? (
        <p className="text-muted text-sm">{t('settings.voiceCorpus.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((session) => (
            <Card key={`${session.bot_self_id}-${session.session}`} className="flex-row items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm">{session.label}</p>
                <p className="text-muted text-xs">
                  {t('settings.voiceCorpus.summary', {
                    clips: session.clips,
                    size: formatSize(session.bytes),
                    untranscribed: session.untranscribed,
                  })}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={busy}
                onPress={() => deleteSession(session)}
                aria-label={t('settings.voiceCorpus.deleteSession')}
              >
                <TrashBin />
              </Button>
            </Card>
          ))}
        </div>
      )}

      <TextField fullWidth>
        <Label>{t('settings.voiceCorpus.forgetSender')}</Label>
        <div className="flex gap-2">
          <Input value={senderInput} onChange={(e) => setSenderInput(e.target.value)} placeholder="12345" />
          <Button variant="ghost" isDisabled={busy || !senderInput.trim()} onPress={forgetSender}>
            {t('settings.voiceCorpus.forget')}
          </Button>
        </div>
        <Description>{t('settings.voiceCorpus.forgetSenderHint')}</Description>
      </TextField>

      {can.exportToDisk && (
        <div className="flex flex-col gap-2">
          <Checkbox isSelected={includeUntranscribed} onChange={setIncludeUntranscribed}>
            {t('settings.voiceCorpus.includeUntranscribed')}
          </Checkbox>
          <Checkbox isSelected={includeSender} onChange={setIncludeSender}>
            {t('settings.voiceCorpus.includeSender')}
          </Checkbox>
          <Description>{t('settings.voiceCorpus.exportHint')}</Description>
          <Button variant="ghost" isDisabled={busy || sessions.length === 0} onPress={exportBundle}>
            {t('settings.voiceCorpus.export')}
          </Button>
        </div>
      )}
    </SettingsPane>
  )
}
