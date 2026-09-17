import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { TrashBin } from '@gravity-ui/icons'
import { Button, Checkbox, Description, Input, Label, Separator, Spinner, TextField, Tooltip } from '@/components/base'
import { ItemCard } from '@/components/base'
import { ItemCardGroup } from '@/components/base'
import { api } from '@/api'
import type { VoiceCorpusDeleteResponse, VoiceCorpusSessionInfoResponse } from '@/types'
import { can } from '@/lib/capabilities'
import { SettingsHeader, SettingsPane } from './primitives'
import { useConfirm } from '@/hooks/use-confirm'

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
    if (!(await confirm({ body: t('settings.voiceCorpus.deleteSessionConfirm', { handle: session.handle }) }))) return
    await run(async () =>
      deleteMessage(await api.deleteVoiceCorpus({ selector: { kind: 'session', handle: session.handle } }), 'deleted'),
    )
  }

  const forgetSender = async () => {
    const id = senderInput.trim()
    if (!id || !(await confirm({ body: t('settings.voiceCorpus.forgetSenderConfirm', { sender: id }) }))) return
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
        <p data-slot="voice-corpus-error" role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p data-slot="voice-corpus-notice" role="status" className="text-muted text-sm">
          {notice}
        </p>
      )}

      {loading ? (
        <div
          data-slot="voice-corpus-loading"
          role="status"
          aria-label={t('common.loading')}
          className="flex items-center gap-2 text-sm text-muted"
        >
          <Spinner aria-hidden="true" size="sm" />
          {t('common.loading')}
        </div>
      ) : sessions.length === 0 ? (
        <p data-slot="voice-corpus-empty" className="text-muted text-sm">
          {t('settings.voiceCorpus.empty')}
        </p>
      ) : (
        <ItemCardGroup variant="outline">
          {sessions.map((session, index) => (
            <Fragment key={session.handle}>
              {index > 0 && <Separator />}
              <ItemCard>
                <ItemCard.Content className="min-w-0">
                  <ItemCard.Title className="w-full truncate font-mono">
                    {t(`settings.voiceCorpus.kind.${session.kind}`)} · {session.handle}
                  </ItemCard.Title>
                  <ItemCard.Description className="w-full whitespace-normal">
                    {t('settings.voiceCorpus.summary', {
                      clips: session.clips,
                      size: formatSize(session.bytes, sizeNumber),
                      untranscribed: session.untranscribed,
                    })}
                  </ItemCard.Description>
                </ItemCard.Content>
                <ItemCard.Action>
                  <Tooltip delay={0}>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      isDisabled={busy}
                      onPress={() => deleteSession(session)}
                      aria-label={t('settings.voiceCorpus.deleteSession')}
                    >
                      <TrashBin />
                    </Button>
                    <Tooltip.Content>{t('settings.voiceCorpus.deleteSession')}</Tooltip.Content>
                  </Tooltip>
                </ItemCard.Action>
              </ItemCard>
            </Fragment>
          ))}
        </ItemCardGroup>
      )}

      <TextField fullWidth>
        <Label>{t('settings.voiceCorpus.forgetSender')}</Label>
        <div data-slot="voice-corpus-forget-row" className="flex gap-2">
          <Input value={senderInput} onChange={(e) => setSenderInput(e.target.value)} placeholder="12345" />
          <Button variant="ghost" isDisabled={busy || !senderInput.trim()} onPress={forgetSender}>
            {t('settings.voiceCorpus.forget')}
          </Button>
        </div>
        <Description>{t('settings.voiceCorpus.forgetSenderHint')}</Description>
      </TextField>

      {can.exportToDisk && (
        <div data-slot="voice-corpus-export" className="flex flex-col gap-2">
          {/* HeroUI's Checkbox draws nothing on its own — the box and its input
              live in Control/Indicator, so a bare one is a label you cannot
              press. */}
          <Checkbox className="text-sm" isSelected={includeUntranscribed} onChange={setIncludeUntranscribed}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              {t('settings.voiceCorpus.includeUntranscribed')}
            </Checkbox.Content>
          </Checkbox>
          <Checkbox className="text-sm" isSelected={includeSender} onChange={setIncludeSender}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              {t('settings.voiceCorpus.includeSender')}
            </Checkbox.Content>
          </Checkbox>
          <Description>{t('settings.voiceCorpus.exportHint')}</Description>
          <Button variant="ghost" isDisabled={busy || sessions.length === 0} onPress={exportBundle}>
            {t('settings.voiceCorpus.export')}
          </Button>
        </div>
      )}
      {confirmDialog}
    </SettingsPane>
  )
}
