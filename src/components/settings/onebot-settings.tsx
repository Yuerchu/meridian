import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { Button, Checkbox, Input, ListBox, Select } from '@heroui/react'
import type { Assistant } from '@/types'

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
    enabled: false, host: '127.0.0.1', port: 6700,
    access_token: null, assistant_id: null, admin_users: [],
    ack_emoji_id: '76',
  })
  const [status, setStatus] = useState<OneBotStatus | null>(null)
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [adminInput, setAdminInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

  const loadData = useCallback(async () => {
    try {
      const [cfg, sts, assts] = await Promise.all([
        api.getOneBotConfig(),
        api.getOneBotStatus(),
        api.listAssistants(),
      ])
      setConfig(cfg)
      setStatus(sts)
      setAssistants(assts)
      setAdminInput(cfg.admin_users.join(', '))
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

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
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n > 0)

      const newConfig = { ...config, admin_users: adminUsers }
      await api.saveOneBotConfig(newConfig)
      setConfig(newConfig)
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
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
    { value: '_default', label: 'Default' },
    ...assistants.map((a) => ({ value: a.id, label: a.name })),
  ]

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.onebot.title')}</h2>
      </div>

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
          <p className="text-xs text-muted">
            {t('settings.onebot.enableHint')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted">
            {t('settings.onebot.host')}
          </label>
          <Input fullWidth
            value={config.host}
            onChange={(e) => setConfig({ ...config, host: e.target.value })}
            placeholder="127.0.0.1"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted">
            {t('settings.onebot.port')}
          </label>
          <Input fullWidth
            type="number"
            min={1}
            max={65535}
            value={config.port}
            onChange={(e) => setConfig({ ...config, port: Math.min(65535, Math.max(1, parseInt(e.target.value, 10) || 6700)) })}
            placeholder="6700"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted">
          {t('settings.onebot.accessToken')}
        </label>
        <Input fullWidth
          type="password"
          value={config.access_token ?? ''}
          onChange={(e) => setConfig({ ...config, access_token: e.target.value || null })}
          placeholder={t('settings.onebot.accessTokenPlaceholder')}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted">
          {t('settings.onebot.assistant')}
        </label>
        <Select
          fullWidth
          value={config.assistant_id ?? '_default'}
          onChange={(v) => setConfig({ ...config, assistant_id: v === '_default' ? null : String(v) })}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {assistantOptions.map((o) => (
                <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                  {o.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <p className="text-xs text-muted">
          {t('settings.onebot.assistantHint')}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted">
          {t('settings.onebot.adminUsers')}
        </label>
        <Input fullWidth
          value={adminInput}
          onChange={(e) => setAdminInput(e.target.value)}
          placeholder="12345, 67890"
        />
        <p className="text-xs text-muted">
          {t('settings.onebot.adminUsersHint')}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted">
          {t('settings.onebot.ackEmoji')}
        </label>
        <Input fullWidth
          value={config.ack_emoji_id}
          onChange={(e) => setConfig({ ...config, ack_emoji_id: e.target.value })}
          placeholder="76"
        />
        <p className="text-xs text-muted">
          {t('settings.onebot.ackEmojiHint')}
        </p>
      </div>

      {error && (
        <p className="text-xs text-danger break-all">{error}</p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button variant="outline" onClick={handleSave} isDisabled={saving}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {running ? (
          <Button variant="danger-soft" onClick={handleStop}>
            {t('settings.onebot.stop')}
          </Button>
        ) : (
          <Button onClick={handleStart}>
            {t('settings.onebot.start')}
          </Button>
        )}
      </div>

      {status && (
        <div className="rounded-lg border p-3 space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${running ? 'bg-success' : 'bg-muted'}`} />
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
    </div>
  )
}
