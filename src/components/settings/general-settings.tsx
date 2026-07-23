import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import { LANGUAGES, setLocale } from '@/i18n'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { AndroidFileAccess } from './android-file-access'

const LANGUAGE_OPTIONS = LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))

const SHELLS = [
  { value: 'bash', label: 'Bash (Git Bash)' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'CMD' },
]

const SEARCH_PROVIDERS = [
  { value: 'tavily', label: 'Tavily', keyService: 'TAVILY' },
  { value: 'zhipu', label: '智谱 (Zhipu)', keyService: 'ZHIPU_SEARCH' },
]

export function GeneralSettings() {
  const { t, i18n } = useTranslation()
  const platform = usePlatform()
  const [shell, setShell] = useState('bash')
  const [sandboxEnabled, setSandboxEnabled] = useState(true)
  const [searchProvider, setSearchProvider] = useState('tavily')
  const [searchApiKey, setSearchApiKey] = useState('')
  const [searchKeyExists, setSearchKeyExists] = useState(false)
  const [searchKeySaved, setSearchKeySaved] = useState(false)

  useEffect(() => {
    api.getPreference('shell').then((v) => {
      if (v) setShell(v)
    })
    // Missing preference means enabled (sandbox-by-default on Windows)
    api.getPreference('sandbox.enabled').then((v) => {
      setSandboxEnabled(v !== 'false')
    })
    api.getPreference('search_provider').then((v) => {
      if (v) setSearchProvider(v)
    })
  }, [])

  useEffect(() => {
    const provider = SEARCH_PROVIDERS.find((p) => p.value === searchProvider)
    if (provider) {
      api.getServiceKeyExists(provider.keyService).then(setSearchKeyExists)
    }
    setSearchApiKey('')
    setSearchKeySaved(false)
  }, [searchProvider])

  const handleShellChange = (value: string) => {
    setShell(value)
    api.setPreference('shell', value)
  }

  const sandboxOptions = [
    { value: 'on', label: t('settings.general.sandboxOn') },
    { value: 'off', label: t('settings.general.sandboxOff') },
  ]

  const handleSandboxChange = (value: string) => {
    setSandboxEnabled(value === 'on')
    api.setPreference('sandbox.enabled', value === 'on' ? 'true' : 'false')
  }

  const handleSearchProviderChange = (value: string) => {
    setSearchProvider(value)
    api.setPreference('search_provider', value)
  }

  const handleSaveSearchKey = async () => {
    if (!searchApiKey.trim()) return
    const provider = SEARCH_PROVIDERS.find((p) => p.value === searchProvider)
    if (!provider) return
    await api.setServiceKey(provider.keyService, searchApiKey.trim())
    setSearchKeyExists(true)
    setSearchApiKey('')
    setSearchKeySaved(true)
    setTimeout(() => setSearchKeySaved(false), 2000)
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('settings.general.title')}</h2>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('settings.general.language')}
        </label>
        <Select value={i18n.language} onValueChange={(v) => v && setLocale(v)} items={LANGUAGE_OPTIONS}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_OPTIONS.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {platform !== null && platform !== 'android' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            {t('settings.general.shell')}
          </label>
          <Select value={shell} onValueChange={(v) => v && handleShellChange(v)} items={SHELLS}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHELLS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {t('settings.general.shellHint')}
          </p>
        </div>
      )}

      {platform === 'windows' && (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            {t('settings.general.sandbox')}
          </label>
          <Select value={sandboxEnabled ? 'on' : 'off'} onValueChange={(v) => v && handleSandboxChange(v)} items={sandboxOptions}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sandboxOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {t('settings.general.sandboxHint')}
          </p>
        </div>
      )}

      <div className="space-y-3">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('settings.general.webSearch')}
        </label>
        <Select value={searchProvider} onValueChange={(v) => v && handleSearchProviderChange(v)} items={SEARCH_PROVIDERS}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEARCH_PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={searchApiKey}
            onChange={(e) => setSearchApiKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSearchKey() }}
            placeholder={searchKeyExists ? t('settings.general.searchKeySet') : 'API Key'}
            className="max-w-xs"
          />
          <Button
            variant={searchKeySaved ? 'default' : 'outline'}
            onClick={handleSaveSearchKey}
            disabled={!searchApiKey.trim()}
          >
            {searchKeySaved ? <Check className="w-4 h-4" /> : t('settings.general.save')}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t('settings.general.searchHint')}
        </p>
      </div>

      {platform === 'android' && <AndroidFileAccess />}
    </div>
  )
}
