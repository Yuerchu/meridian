import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { Button, Checkbox, Description, Input, Label, TextField } from '@heroui/react'
import { ItemCard } from '@heroui-pro/react/item-card'
import { cn } from '@/lib/utils'
import type { Assistant } from '@/types'
import { SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from './primitives'
import { useSettingsDirtyRegistration } from './dirty-guard'

interface OneBotConfig {
  enabled: boolean
  host: string
  port: number
  access_token: string | null
  assistant_id: string | null
  admin_users: number[]
  ack_emoji_id: string
  /**
   * Null switches the balance watcher off, which is the default — it makes
   * periodic requests with the user's API keys. Zero keeps it but drops the
   * early warning: the admins hear only when an upstream reports the account
   * unusable.
   */
  balance_alert_threshold: number | null
  /**
   * Which `(bot account, session)` pairs keep the voice notes people send.
   *
   * Written `<bot>@group:123`. The account is part of it rather than a
   * footnote: two bots each pulled into the same group are two independent
   * consents, and one of them being allowed to keep audio says nothing about
   * the other.
   *
   * Empty is the default and means nothing is kept anywhere.
   */
  voice_capture_sessions: string[]
  voice_send_enabled: boolean
  voice_send_groups: string[]
  voice_tts_model: string
  voice_tts_reference_id: string
}

interface OneBotStatus {
  enabled: boolean
  running: boolean
  connected_clients: number
  host: string
  port: number
}

export function OneBotSettings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<OneBotConfig>({
    enabled: false,
    host: '127.0.0.1',
    port: 6700,
    access_token: null,
    assistant_id: null,
    admin_users: [],
    ack_emoji_id: '76',
    balance_alert_threshold: null,
    voice_capture_sessions: [],
    voice_send_enabled: false,
    voice_send_groups: [],
    voice_tts_model: '',
    voice_tts_reference_id: '',
  })
  const [status, setStatus] = useState<OneBotStatus | null>(null)
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [adminInput, setAdminInput] = useState('')
  // Held as text like the admin list, so a half-typed "1." is representable.
  // Empty is a real setting here — it switches the watcher off.
  const [balanceInput, setBalanceInput] = useState('')
  // Same shape again. Rewritten from what was saved, so an entry the backend
  // could not read disappears visibly instead of being silently ignored.
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
  const [savedDraft, setSavedDraft] = useState<string | null>(null)
  const draft = JSON.stringify({
    ...config,
    port: portInput,
    adminInput,
    balanceInput,
    voiceCaptureInput,
    voiceSendInput,
    fishKey,
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
      const nextBalance = cfg.balance_alert_threshold?.toString() ?? ''
      const nextCapture = (cfg.voice_capture_sessions ?? []).join(', ')
      const nextSend = (cfg.voice_send_groups ?? []).join(', ')
      setConfig(cfg)
      setStatus(sts)
      setAssistants(assts)
      setPortInput(nextPort)
      setAdminInput(nextAdmin)
      setBalanceInput(nextBalance)
      setVoiceCaptureInput(nextCapture)
      setVoiceSendInput(nextSend)
      setFishKeySet(hasFishKey)
      setVoiceReady(readiness)
      setSavedDraft(
        JSON.stringify({
          ...cfg,
          port: nextPort,
          adminInput: nextAdmin,
          balanceInput: nextBalance,
          voiceCaptureInput: nextCapture,
          voiceSendInput: nextSend,
          fishKey: '',
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
    const balanceText = balanceInput.trim()
    const threshold = balanceText === '' ? null : Number(balanceText)
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
    if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) {
      setError(t('settings.onebot.invalidBalance'))
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
        await api.setServiceKey('FISH_AUDIO', fishKey.trim())
        setFishKey('')
        setFishKeySet(true)
      }

      const newConfig = {
        ...config,
        port,
        admin_users: adminUsers,
        balance_alert_threshold: threshold,
        voice_capture_sessions: voiceCaptureSessions,
        voice_send_groups: voiceSendGroups,
      }
      await api.saveOneBotConfig(newConfig)
      setConfig(newConfig)
      const nextPort = port.toString()
      const nextAdmin = adminUsers.join(', ')
      const nextBalance = threshold?.toString() ?? ''
      const nextCapture = voiceCaptureSessions.join(', ')
      const nextSend = voiceSendGroups.join(', ')
      setPortInput(nextPort)
      setAdminInput(nextAdmin)
      setBalanceInput(nextBalance)
      setVoiceCaptureInput(nextCapture)
      setVoiceSendInput(nextSend)
      setSavedDraft(
        JSON.stringify({
          ...newConfig,
          port: nextPort,
          adminInput: nextAdmin,
          balanceInput: nextBalance,
          voiceCaptureInput: nextCapture,
          voiceSendInput: nextSend,
          fishKey: '',
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
        <div role="alert" className="space-y-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <p>{t('settings.onebot.loadError')}</p>
          {loadError && <p className="break-all">{loadError}</p>}
          <Button
            size="sm"
            variant="outline"
            onPress={() => {
              setLoading(true)
              void loadData()
            }}
          >
            {t('settings.onebot.retry')}
          </Button>
        </div>
      </SettingsPane>
    )
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.onebot.title')} />

      <div className="flex items-start gap-2">
        {/* Label stays outside because a description sits under it; the id is
            what ties the two together. */}
        <Checkbox
          id="onebot-enabled"
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
          <label htmlFor="onebot-enabled" className="text-sm font-medium cursor-pointer">
            {t('settings.onebot.enable')}
          </label>
          <p className="text-xs text-muted">{t('settings.onebot.enableHint')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-3">
        <TextField fullWidth>
          <Label>{t('settings.onebot.host')}</Label>
          <Input
            name="onebotHost"
            value={config.host}
            onChange={(e) => setConfig({ ...config, host: e.target.value })}
            placeholder="127.0.0.1"
          />
        </TextField>
        <TextField fullWidth type="number">
          <Label>{t('settings.onebot.port')}</Label>
          <Input
            name="onebotPort"
            inputMode="numeric"
            min={1}
            max={65535}
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            placeholder="6700"
          />
        </TextField>
      </div>

      <TextField fullWidth type="password">
        <Label>{t('settings.onebot.accessToken')}</Label>
        <Input
          name="onebotAccessToken"
          autoComplete="off"
          value={config.access_token ?? ''}
          onChange={(e) => setConfig({ ...config, access_token: e.target.value || null })}
          placeholder={t('settings.onebot.accessTokenPlaceholder')}
        />
      </TextField>

      <SettingsSelect
        label={t('settings.onebot.assistant')}
        value={config.assistant_id ?? '_default'}
        options={assistantOptions}
        onChange={(v) => setConfig({ ...config, assistant_id: v === '_default' ? null : v })}
        description={t('settings.onebot.assistantHint')}
        fullWidth
      />

      <TextField fullWidth>
        <Label>{t('settings.onebot.adminUsers')}</Label>
        <Input
          name="onebotAdminUsers"
          value={adminInput}
          onChange={(e) => setAdminInput(e.target.value)}
          placeholder="12345, 67890"
        />
        <Description>{t('settings.onebot.adminUsersHint')}</Description>
      </TextField>

      <TextField fullWidth>
        <Label>{t('settings.onebot.voiceCapture')}</Label>
        <Input
          name="onebotVoiceCapture"
          value={voiceCaptureInput}
          onChange={(e) => setVoiceCaptureInput(e.target.value)}
          placeholder="10001@group:123, 10001@private:456"
        />
        <Description>{t('settings.onebot.voiceCaptureHint')}</Description>
      </TextField>

      <div className="flex items-start gap-2">
        <Checkbox
          id="onebot-voice-send"
          isSelected={config.voice_send_enabled}
          onChange={(selected) => setConfig({ ...config, voice_send_enabled: selected })}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
        <div className="space-y-0.5">
          <label htmlFor="onebot-voice-send" className="text-sm font-medium cursor-pointer">
            {t('settings.onebot.voiceSend')}
          </label>
          <p className="text-xs text-muted">{t('settings.onebot.voiceSendHint')}</p>
        </div>
      </div>

      {config.voice_send_enabled && (
        <>
          <TextField fullWidth>
            <Label>{t('settings.onebot.voiceSendGroups')}</Label>
            <Input
              name="onebotVoiceSendGroups"
              value={voiceSendInput}
              onChange={(e) => setVoiceSendInput(e.target.value)}
              placeholder="10001@group:123"
            />
            <Description>{t('settings.onebot.voiceSendGroupsHint')}</Description>
          </TextField>

          <div className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-3">
            <TextField fullWidth>
              <Label>{t('settings.onebot.voiceTtsModel')}</Label>
              <Input
                name="onebotVoiceModel"
                value={config.voice_tts_model}
                onChange={(e) => setConfig({ ...config, voice_tts_model: e.target.value })}
                placeholder="s2.1-pro-free"
              />
              <Description>{t('settings.onebot.voiceTtsModelHint')}</Description>
            </TextField>
            <TextField fullWidth>
              <Label>{t('settings.onebot.voiceTtsVoice')}</Label>
              <Input
                name="onebotVoiceReference"
                value={config.voice_tts_reference_id}
                onChange={(e) => setConfig({ ...config, voice_tts_reference_id: e.target.value })}
                placeholder="9a9cf477…"
              />
              <Description>{t('settings.onebot.voiceTtsVoiceHint')}</Description>
            </TextField>
          </div>

          <TextField fullWidth>
            <Label>{t('settings.onebot.fishKey')}</Label>
            <Input
              type="password"
              name="onebotFishAudioKey"
              autoComplete="off"
              value={fishKey}
              onChange={(e) => setFishKey(e.target.value)}
              placeholder={fishKeySet ? '••••••••' : ''}
            />
            <Description>{t('settings.onebot.fishKeyHint')}</Description>
          </TextField>

          {/* The one failure this feature has that announces itself nowhere.
              Four things have to be present or `send_voice` is withheld from
              the model in all three places it could appear — and because the
              model cannot see the tool either, asking it produces "I have no
              voice tool" rather than anything about a setting. A placeholder
              that reads like a value (`s2.1-pro-free` in the model box) is all
              it takes. Reported from the backend rather than derived here,
              because one of the four is a keychain entry this page never
              sees. */}
          {voiceReady && !voiceReady.ready && (
            <p role="status" className="text-xs text-warning">
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
        </>
      )}

      <TextField fullWidth>
        <Label>{t('settings.onebot.ackEmoji')}</Label>
        <Input
          name="onebotAckEmoji"
          value={config.ack_emoji_id}
          onChange={(e) => setConfig({ ...config, ack_emoji_id: e.target.value })}
          placeholder="76"
        />
        <Description>{t('settings.onebot.ackEmojiHint')}</Description>
      </TextField>

      <TextField fullWidth>
        <Label>{t('settings.onebot.balanceAlert')}</Label>
        <Input
          name="onebotBalanceThreshold"
          inputMode="decimal"
          value={balanceInput}
          onChange={(e) => setBalanceInput(e.target.value)}
          placeholder={t('settings.onebot.balanceAlertPlaceholder')}
        />
        <Description>{t('settings.onebot.balanceAlertHint')}</Description>
      </TextField>

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
            {t('settings.onebot.stop')}
          </Button>
        ) : (
          <Button onPress={handleStart}>{t('settings.onebot.start')}</Button>
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
              {running ? t('settings.onebot.statusRunning') : t('settings.onebot.statusStopped')}
            </ItemCard.Title>
            {running && (
              <ItemCard.Description className="w-full whitespace-normal">
                {t('settings.onebot.clients', { count: status.connected_clients })}
                {' · '}
                {status.host}:{status.port}
              </ItemCard.Description>
            )}
          </ItemCard.Content>
        </ItemCard>
      )}
    </SettingsPane>
  )
}
