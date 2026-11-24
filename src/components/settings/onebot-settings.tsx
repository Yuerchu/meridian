import './onebot-settings.css'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { draftToNumber, numberToDraft, PLAIN_INTEGER } from '@/lib/number-draft'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { PasswordField } from '@/components/yuerchu-ui/components/password-field/password-field'

import type {
  AssistantInfoResponse,
  OneBotConfigInfoResponse,
  OneBotConfigUpdateRequest,
  OneBotStatusInfoResponse,
  ReplyBank,
  ReplySeeds,
} from '@/types'
import { ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { Select } from '@/components/yuerchu-ui/components/select/select'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import { useSettingsDirtyRegistration } from './dirty-guard'

const EMPTY_REPLIES: ReplyBank = {
  empty_reply: [],
  busy: [],
  server_error: [],
  ack_approved: [],
  ack_denied: [],
}

const SEED_REPLIES: ReplySeeds = {
  empty_reply: '没搞明白你在说什么。',
  busy: '这个对话正在电脑端处理，请等它结束后再发。',
  server_error: '这边出了点问题。',
  ack_approved: '已批准执行。',
  ack_denied: '已拒绝，你写的理由会一并转达。',
}

const REPLY_SLOTS = ['empty_reply', 'busy', 'server_error', 'ack_approved', 'ack_denied'] as const
type ReplySlotId = (typeof REPLY_SLOTS)[number]

function emptyDrafts(): Record<ReplySlotId, string> {
  return { empty_reply: '', busy: '', server_error: '', ack_approved: '', ack_denied: '' }
}

function draftsFrom(bank: ReplyBank): Record<ReplySlotId, string> {
  return {
    empty_reply: bank.empty_reply.join('\n'),
    busy: bank.busy.join('\n'),
    server_error: bank.server_error.join('\n'),
    ack_approved: bank.ack_approved.join('\n'),
    ack_denied: bank.ack_denied.join('\n'),
  }
}

function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function bankFrom(drafts: Record<ReplySlotId, string>): ReplyBank {
  return {
    empty_reply: linesOf(drafts.empty_reply),
    busy: linesOf(drafts.busy),
    server_error: linesOf(drafts.server_error),
    ack_approved: linesOf(drafts.ack_approved),
    ack_denied: linesOf(drafts.ack_denied),
  }
}

export function OneBotSettings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<OneBotConfigInfoResponse>({
    enabled: false,
    host: '127.0.0.1',
    port: 6700,
    access_token: null,
    assistant_id: null,
    admin_users: [],
    ack_emoji_id: '76',
    voice_capture_sessions: [],
    voice_send_enabled: false,
    voice_send_groups: [],
    voice_tts_model: '',
    voice_tts_reference_id: '',
    replies: EMPTY_REPLIES,
    reply_seeds: SEED_REPLIES,
  })
  const [status, setStatus] = useState<OneBotStatusInfoResponse | null>(null)
  const [assistants, setAssistants] = useState<AssistantInfoResponse[]>([])
  const [adminInput, setAdminInput] = useState('')
  // The low-balance threshold used to sit here. It is `notify.balance.threshold`
  // now — one watcher feeding every outlet, rather than one living inside the
  // chat server — and it belongs on the notification settings page.
  //
  // Held as text like the admin list, and rewritten from what was saved, so an
  // entry the backend could not read disappears visibly instead of being
  // silently ignored.
  const [voiceCaptureInput, setVoiceCaptureInput] = useState('')
  const [voiceSendInput, setVoiceSendInput] = useState('')
  const [voiceReady, setVoiceReady] = useState<Awaited<ReturnType<typeof api.getVoiceSendReadiness>> | null>(null)
  const [fishKey, setFishKey] = useState('')
  const [fishKeySet, setFishKeySet] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, markSaved] = useTemporaryFlag()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [portInput, setPortInput] = useState('6700')
  const [replyDrafts, setReplyDrafts] = useState<Record<ReplySlotId, string>>(emptyDrafts)
  const [savedDraft, setSavedDraft] = useState<string | null>(null)
  const draft = JSON.stringify({
    ...config,
    port: portInput,
    adminInput,
    voiceCaptureInput,
    voiceSendInput,
    fishKey,
    replyDrafts,
  })
  const dirty = loaded && draft !== savedDraft
  useSettingsDirtyRegistration('onebot', 'onebot-config', dirty)

  const loadData = useCallback(async () => {
    setLoadError(null)
    try {
      const [cfg, sts, assts, hasFishKey, readiness] = await Promise.all([
        api.getOneBotConfig(),
        api.getOneBotStatus(),
        api.listAssistants(),
        api.getServiceKeyExists('FISH_AUDIO'),
        api.getVoiceSendReadiness(),
      ])
      const nextPort = cfg.port.toString()
      const nextAdmin = cfg.admin_users.join(', ')
      const nextCapture = cfg.voice_capture_sessions.join(', ')
      const nextSend = cfg.voice_send_groups.join(', ')
      setConfig(cfg)
      setStatus(sts)
      setAssistants(assts)
      setPortInput(nextPort)
      setAdminInput(nextAdmin)
      setVoiceCaptureInput(nextCapture)
      setVoiceSendInput(nextSend)
      const nextDrafts = draftsFrom(cfg.replies)
      setReplyDrafts(nextDrafts)
      setFishKeySet(hasFishKey)
      setVoiceReady(readiness)
      setSavedDraft(
        JSON.stringify({
          ...cfg,
          port: nextPort,
          adminInput: nextAdmin,
          voiceCaptureInput: nextCapture,
          voiceSendInput: nextSend,
          fishKey: '',
          replyDrafts: nextDrafts,
        }),
      )
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
        const sts = await api.getOneBotStatus()
        setStatus(sts)
      } catch {
        // ignore polling errors
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleSave = async () => {
    setError(null)
    const splitEntries = (value: string) =>
      value.trim()
        ? value
            .split(/[,，\s]+/)
            .map((entry) => entry.trim())
            .filter(Boolean)
        : []
    const port = Number(portInput)
    const adminEntries = splitEntries(adminInput)
    const adminUsers = adminEntries.map(Number)
    const voiceCaptureSessions = splitEntries(voiceCaptureInput)
    const voiceSendGroups = splitEntries(voiceSendInput)

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t('settings.validation.port'))
      return false
    }
    if (adminUsers.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      setError(t('settings.onebot.invalidAdmins'))
      return false
    }
    if (voiceCaptureSessions.some((value) => !/^\d+@(group|private):\d+$/.test(value))) {
      setError(t('settings.onebot.invalidVoiceCapture'))
      return false
    }
    if (voiceSendGroups.some((value) => !/^\d+@group:\d+$/.test(value))) {
      setError(t('settings.onebot.invalidVoiceSend'))
      return false
    }

    setSaving(true)
    try {
      // The key goes to the keychain, not into the config row. Saved first so
      // that the policy refresh below sees it — readiness counts the key as one
      // of its four parts, and watching preferences alone would miss it.
      if (fishKey.trim()) {
        await api.setServiceKey({ service: 'FISH_AUDIO', key: fishKey.trim() })
        setFishKey('')
        setFishKeySet(true)
      }

      const replies = bankFrom(replyDrafts)
      const request: OneBotConfigUpdateRequest = {
        enabled: config.enabled,
        host: config.host,
        port,
        access_token: config.access_token,
        assistant_id: config.assistant_id,
        admin_users: adminUsers,
        ack_emoji_id: config.ack_emoji_id,
        voice_capture_sessions: voiceCaptureSessions,
        voice_send_enabled: config.voice_send_enabled,
        voice_send_groups: voiceSendGroups,
        voice_tts_model: config.voice_tts_model,
        voice_tts_reference_id: config.voice_tts_reference_id,
        replies,
      }
      await api.saveOneBotConfig(request)
      const nextConfig: OneBotConfigInfoResponse = {
        ...request,
        reply_seeds: config.reply_seeds,
      }
      setConfig(nextConfig)
      const nextPort = port.toString()
      const nextAdmin = adminUsers.join(', ')
      const nextCapture = voiceCaptureSessions.join(', ')
      const nextSend = voiceSendGroups.join(', ')
      const nextDrafts = draftsFrom(replies)
      setPortInput(nextPort)
      setAdminInput(nextAdmin)
      setVoiceCaptureInput(nextCapture)
      setVoiceSendInput(nextSend)
      setReplyDrafts(nextDrafts)
      setSavedDraft(
        JSON.stringify({
          ...nextConfig,
          port: nextPort,
          adminInput: nextAdmin,
          voiceCaptureInput: nextCapture,
          voiceSendInput: nextSend,
          fishKey: '',
          replyDrafts: nextDrafts,
        }),
      )
      // Re-asked rather than assumed: the save is also what applies the policy,
      // so this is the moment the answer can change — and the moment somebody
      // is looking for it.
      setVoiceReady(await api.getVoiceSendReadiness())
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
    if (!(await handleSave())) return
    try {
      await api.startOneBot()
      const sts = await api.getOneBotStatus()
      setStatus(sts)
    } catch (err) {
      setError(String(err))
    }
  }

  const handleStop = async () => {
    try {
      await api.stopOneBot()
      const sts = await api.getOneBotStatus()
      setStatus(sts)
    } catch (err) {
      setError(String(err))
    }
  }

  const running = status?.running ?? false

  const assistantOptions = [
    { value: '_default', label: t('settings.assistant.providerDefault') },
    ...assistants.map((a) => ({ value: a.id, label: a.name })),
  ]

  if (loading) return <SettingsSkeleton />
  if (!loaded) {
    return (
      <SettingsPane>
        <SettingsHeader title={t('settings.onebot.title')} />
        <Alert
          tone="danger"
          shouldAnnounce
          heading={t('settings.onebot.loadError')}
          actions={
            <Button
              size="sm"
              variant="secondary"

              onPress={() => {
                setLoading(true)
                void loadData()
              }}
            >
              {t('settings.onebot.retry')}
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
      <SettingsHeader title={t('settings.onebot.title')} />

      <div data-slot="onebot-enable">
        <SettingsGroup>
          <SettingsRow
            label={t('settings.onebot.enable')}
            description={<span data-slot="onebot-enable-hint">{t('settings.onebot.enableHint')}</span>}
          >
            <Switch isSelected={config.enabled} onChange={(selected) => setConfig({ ...config, enabled: selected })} />
          </SettingsRow>
        </SettingsGroup>
      </div>

      <SettingsGroup>
        <div data-slot="onebot-endpoint" className="m-onebot__group-rows">
          <SettingsRow layout="stacked" label={t('settings.onebot.host')}>
            <TextField
              name="onebotHost"
              value={config.host}
              onChange={(e) => setConfig({ ...config, host: e })}
              placeholder="127.0.0.1"
            />
          </SettingsRow>
          <SettingsRow label={t('settings.onebot.port')}>
            <NumberField
              value={draftToNumber(portInput)}
              onChange={(value) => setPortInput(numberToDraft(value))}
              name="onebotPort"
              minValue={1}
              maxValue={65535}
              placeholder="6700"
              formatOptions={PLAIN_INTEGER}
            />
          </SettingsRow>
        </div>

        <SettingsRow layout="stacked" label={t('settings.onebot.accessToken')}>
          <PasswordField
            name="onebotAccessToken"
            // A secret, not an account password; the library has no purpose for it yet (Yuerchu/ui#570).
            autoComplete="current-password"
            value={config.access_token ?? ''}
            onChange={(value) => setConfig({ ...config, access_token: value || null })}
            placeholder={t('settings.onebot.accessTokenPlaceholder')}
          />
        </SettingsRow>

        <SettingsRow label={t('settings.onebot.assistant')} description={t('settings.onebot.assistantHint')}>
          <div className="m-onebot__select">
            <Select
              selectedKey={config.assistant_id ?? '_default'}
              onSelectionChange={(key) =>
                typeof key === 'string' && setConfig({ ...config, assistant_id: key === '_default' ? null : key })
              }
            >
              {assistantOptions.map((opt) => (
                <ListBoxItem key={opt.value} id={opt.value} textValue={opt.label}>
                  {opt.label}
                </ListBoxItem>
              ))}
            </Select>
          </div>
        </SettingsRow>

        <SettingsRow
          layout="stacked"
          label={t('settings.onebot.adminUsers')}
          description={t('settings.onebot.adminUsersHint')}
        >
          <TextField name="onebotAdminUsers" value={adminInput} onChange={setAdminInput} placeholder="12345, 67890" />
        </SettingsRow>

        <SettingsRow
          layout="stacked"
          label={t('settings.onebot.ackEmoji')}
          description={t('settings.onebot.ackEmojiHint')}
        >
          <TextField
            name="onebotAckEmoji"
            value={config.ack_emoji_id}
            onChange={(e) => setConfig({ ...config, ack_emoji_id: e })}
            placeholder="76"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        heading={t('settings.onebot.replies.title')}
        description={t('settings.onebot.replies.hint')}
        headingLevel={3}
      >
        {REPLY_SLOTS.map((slot) => (
          <SettingsRow
            key={slot}
            layout="stacked"
            label={t(`settings.onebot.replies.${slot}`)}
            description={t('settings.onebot.replies.lineHint')}
          >
            <TextArea
              rows={3}
              value={replyDrafts[slot]}
              placeholder={config.reply_seeds[slot]}
              onChange={(e) => setReplyDrafts({ ...replyDrafts, [slot]: e })}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          layout="stacked"
          label={t('settings.onebot.voiceCapture')}
          description={t('settings.onebot.voiceCaptureHint')}
        >
          <TextField
            name="onebotVoiceCapture"
            value={voiceCaptureInput}
            onChange={setVoiceCaptureInput}
            placeholder="10001@group:123, 10001@private:456"
          />
        </SettingsRow>

        <div data-slot="onebot-voice-send" className="m-onebot__group-rows">
          <SettingsRow
            label={t('settings.onebot.voiceSend')}
            description={<span data-slot="onebot-voice-send-hint">{t('settings.onebot.voiceSendHint')}</span>}
          >
            <Switch
              isSelected={config.voice_send_enabled}
              onChange={(selected) => setConfig({ ...config, voice_send_enabled: selected })}
            />
          </SettingsRow>
        </div>

        {config.voice_send_enabled && (
          <>
            <SettingsRow
              layout="stacked"
              label={t('settings.onebot.voiceSendGroups')}
              description={t('settings.onebot.voiceSendGroupsHint')}
            >
              <TextField
                name="onebotVoiceSendGroups"
                value={voiceSendInput}
                onChange={setVoiceSendInput}
                placeholder="10001@group:123"
              />
            </SettingsRow>

            <div data-slot="onebot-voice-tts" className="m-onebot__group-rows">
              <SettingsRow
                layout="stacked"
                label={t('settings.onebot.voiceTtsModel')}
                description={t('settings.onebot.voiceTtsModelHint')}
              >
                <TextField
                  name="onebotVoiceModel"
                  value={config.voice_tts_model}
                  onChange={(e) => setConfig({ ...config, voice_tts_model: e })}
                  placeholder="s2.1-pro-free"
                />
              </SettingsRow>
              <SettingsRow
                layout="stacked"
                label={t('settings.onebot.voiceTtsVoice')}
                description={t('settings.onebot.voiceTtsVoiceHint')}
              >
                <TextField
                  name="onebotVoiceReference"
                  value={config.voice_tts_reference_id}
                  onChange={(e) => setConfig({ ...config, voice_tts_reference_id: e })}
                  placeholder="9a9cf477…"
                />
              </SettingsRow>
            </div>

            {/* A key already in the keychain is drawn as saved, not as dots in the
                placeholder: the field stays empty (an empty draft keeps the stored
                key), and typing anything starts a new one. */}
            <SettingsRow
              layout="stacked"
              label={t('settings.onebot.fishKey')}
              description={t('settings.onebot.fishKeyHint')}
            >
              <PasswordField
                name="onebotFishAudioKey"
                // A secret, not an account password; the library has no purpose for it yet (Yuerchu/ui#570).
                autoComplete="current-password"
                value={fishKey}
                onChange={setFishKey}
                hasSavedPassword={fishKeySet && fishKey === ''}
              />
            </SettingsRow>
          </>
        )}
      </SettingsGroup>

      {/* The one failure this feature has that announces itself nowhere.
          Four things have to be present or `send_voice` is withheld from
          the model in all three places it could appear — and because the
          model cannot see the tool either, asking it produces "I have no
          voice tool" rather than anything about a setting. A placeholder
          that reads like a value (`s2.1-pro-free` in the model box) is all
          it takes. Reported from the backend rather than derived here,
          because one of the four is a keychain entry this page never
          sees. */}
      {config.voice_send_enabled && voiceReady && !voiceReady.ready && (
        <p data-slot="onebot-voice-not-ready" role="status" className="m-onebot__warning">
          {t('settings.onebot.voiceNotReady', {
            missing: [
              !voiceReady.has_model && t('settings.onebot.voiceTtsModel'),
              !voiceReady.has_reference_id && t('settings.onebot.voiceTtsVoice'),
              !voiceReady.has_api_key && t('settings.onebot.fishKey'),
            ]
              .filter(Boolean)
              .join(t('common.listSeparator')),
          })}
        </p>
      )}

      {error && (
        <Alert data-slot="onebot-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}

      <div data-slot="onebot-actions" className="m-onebot__actions">
        <Button variant="secondary" onPress={handleSave} isDisabled={saving}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {saved && (
          <span data-slot="onebot-saved" role="status" className="m-onebot__saved">
            {t('common.saved')}
          </span>
        )}
        {running ? (
          <Button variant="destructive" onPress={handleStop}>
            {t('settings.onebot.stop')}
          </Button>
        ) : (
          <Button onPress={handleStart}>{t('settings.onebot.start')}</Button>
        )}
      </div>

      {status && (
        <div className="m-onebot__status">
          <p className="m-onebot__status-title">
            {/* Decoration: the state it stands for is spelled out beside it. */}
            <span
              data-slot="onebot-status-dot"
              data-running={running || undefined}
              aria-hidden
              className="m-onebot__dot"
            />
            {running ? t('settings.onebot.statusRunning') : t('settings.onebot.statusStopped')}
          </p>
          {running && (
            <p className="m-onebot__hint">
              {t('settings.onebot.clients', { count: status.connected_clients })}
              {' · '}
              {status.host}:{status.port}
            </p>
          )}
        </div>
      )}
    </SettingsPane>
  )
}
