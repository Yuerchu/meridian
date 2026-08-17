import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { Button, Checkbox, Description, Input, Label, TextField } from '@heroui/react'
import { cn } from '@/lib/utils'
import type { Assistant } from '@/types'
import { SettingsHeader, SettingsPane, SettingsSelect } from './primitives'

interface OneBotConfig {
  enabled: boolean
  host: string
  port: number
  access_token: string | null
  assistant_id: string | null
  admin_users: number[]
  ack_emoji_id: string
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
  })
  const [status, setStatus] = useState<OneBotStatus | null>(null)
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [adminInput, setAdminInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, markSaved] = useTemporaryFlag()
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [cfg, sts, assts] = await Promise.all([api.getOneBotConfig(), api.getOneBotStatus(), api.listAssistants()])
      setConfig(cfg)
      setStatus(sts)
      setAssistants(assts)
      setAdminInput(cfg.admin_users.join(', '))
    } catch (err) {
      setError(String(err))
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
    setSaving(true)
    setError(null)
    try {
      const adminUsers = adminInput
        .split(/[,，\s]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0)

      const newConfig = { ...config, admin_users: adminUsers }
      await api.saveOneBotConfig(newConfig)
      setConfig(newConfig)
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

      <div className="grid grid-cols-2 gap-3">
        <TextField fullWidth>
          <Label>{t('settings.onebot.host')}</Label>
          <Input
            value={config.host}
            onChange={(e) => setConfig({ ...config, host: e.target.value })}
            placeholder="127.0.0.1"
          />
        </TextField>
        <TextField fullWidth type="number">
          <Label>{t('settings.onebot.port')}</Label>
          <Input
            min={1}
            max={65535}
            value={config.port}
            onChange={(e) =>
              setConfig({ ...config, port: Math.min(65535, Math.max(1, parseInt(e.target.value, 10) || 6700)) })
            }
            placeholder="6700"
          />
        </TextField>
      </div>

      <TextField fullWidth type="password">
        <Label>{t('settings.onebot.accessToken')}</Label>
        <Input
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
        <Input value={adminInput} onChange={(e) => setAdminInput(e.target.value)} placeholder="12345, 67890" />
        <Description>{t('settings.onebot.adminUsersHint')}</Description>
      </TextField>

      <TextField fullWidth>
        <Label>{t('settings.onebot.ackEmoji')}</Label>
        <Input
          value={config.ack_emoji_id}
          onChange={(e) => setConfig({ ...config, ack_emoji_id: e.target.value })}
          placeholder="76"
        />
        <Description>{t('settings.onebot.ackEmojiHint')}</Description>
      </TextField>

      {error && <p className="text-xs text-danger break-all">{error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <Button variant="outline" onClick={handleSave} isDisabled={saving}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {running ? (
          <Button variant="danger-soft" onClick={handleStop}>
            {t('settings.onebot.stop')}
          </Button>
        ) : (
          <Button onClick={handleStart}>{t('settings.onebot.start')}</Button>
        )}
      </div>

      {status && (
        <div className="rounded-lg border p-3 space-y-1 text-sm">
          <div className="flex items-center gap-2">
            {/* Decoration: the state it stands for is spelled out beside it,
                so announcing the dot too would only say it twice. */}
            <span
              aria-hidden
              className={cn('inline-block w-2 h-2 rounded-full', running ? 'bg-success' : 'bg-muted')}
            />
            <span className="font-medium">
              {running ? t('settings.onebot.statusRunning') : t('settings.onebot.statusStopped')}
            </span>
          </div>
          {running && (
            <p className="text-muted text-xs">
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
