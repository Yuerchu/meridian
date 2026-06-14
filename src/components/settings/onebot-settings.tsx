import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Assistant } from '@/types'

interface OneBotConfig {
  enabled: boolean
  host: string
  port: number
  access_token: string | null
  assistant_id: string | null
  admin_users: number[]
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
    enabled: false, host: '0.0.0.0', port: 6700,
    access_token: null, assistant_id: null, admin_users: [],
  })
  const [status, setStatus] = useState<OneBotStatus | null>(null)
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [adminInput, setAdminInput] = useState('')
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    const [cfg, sts, assts] = await Promise.all([
      api.getOneBotConfig(),
      api.getOneBotStatus(),
      api.listAssistants(),
    ])
    setConfig(cfg)
    setStatus(sts)
    setAssistants(assts)
    setAdminInput(cfg.admin_users.join(', '))
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const interval = setInterval(async () => {
      const sts = await api.getOneBotStatus()
      setStatus(sts)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    const adminUsers = adminInput
      .split(/[,，\s]+/)
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n > 0)

    const newConfig = { ...config, admin_users: adminUsers }
    await api.saveOneBotConfig(newConfig)
    setConfig(newConfig)
    setSaving(false)
  }

  const handleStart = async () => {
    await handleSave()
    await api.startOneBot()
    const sts = await api.getOneBotStatus()
    setStatus(sts)
  }

  const handleStop = async () => {
    await api.stopOneBot()
    const sts = await api.getOneBotStatus()
    setStatus(sts)
  }

  const running = status?.running ?? false

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.onebot.title')}</h2>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="onebot-enabled"
          checked={config.enabled}
          onCheckedChange={(checked) => setConfig({ ...config, enabled: !!checked })}
        />
        <div className="space-y-0.5">
          <label htmlFor="onebot-enabled" className="text-sm font-medium cursor-pointer">
            {t('settings.onebot.enable')}
          </label>
          <p className="text-[11px] text-muted-foreground">
            {t('settings.onebot.enableHint')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            {t('settings.onebot.host')}
          </label>
          <Input
            value={config.host}
            onChange={(e) => setConfig({ ...config, host: e.target.value })}
            placeholder="0.0.0.0"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            {t('settings.onebot.port')}
          </label>
          <Input
            type="number"
            value={config.port}
            onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value, 10) || 6700 })}
            placeholder="6700"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('settings.onebot.accessToken')}
        </label>
        <Input
          type="password"
          value={config.access_token ?? ''}
          onChange={(e) => setConfig({ ...config, access_token: e.target.value || null })}
          placeholder={t('settings.onebot.accessTokenPlaceholder')}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('settings.onebot.assistant')}
        </label>
        <Select
          value={config.assistant_id ?? '_default'}
          onValueChange={(v) => setConfig({ ...config, assistant_id: v === '_default' ? null : v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_default">Default</SelectItem>
            {assistants.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {t('settings.onebot.assistantHint')}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('settings.onebot.adminUsers')}
        </label>
        <Input
          value={adminInput}
          onChange={(e) => setAdminInput(e.target.value)}
          placeholder="12345, 67890"
        />
        <p className="text-[11px] text-muted-foreground">
          {t('settings.onebot.adminUsersHint')}
        </p>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button variant="outline" onClick={handleSave} disabled={saving}>
          {saving ? t('common.saved') : t('common.save')}
        </Button>
        {running ? (
          <Button variant="destructive" onClick={handleStop}>
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
            <span className={`inline-block w-2 h-2 rounded-full ${running ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="font-medium">
              {running ? t('settings.onebot.statusRunning') : t('settings.onebot.statusStopped')}
            </span>
          </div>
          {running && (
            <p className="text-muted-foreground text-xs">
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
