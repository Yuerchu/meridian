import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input } from '@heroui/react'
import { Check } from '@gravity-ui/icons'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { LANGUAGES, setLocale } from '@/i18n'
import { useAppTheme, type ThemePreference } from '@/lib/theme'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { AndroidFileAccess } from './android-file-access'
import { SettingsHeader, SettingsPane, SettingsSelect } from './primitives'

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
  const { theme, setTheme } = useAppTheme()
  const [shell, setShell] = useState('bash')
  const [sandboxEnabled, setSandboxEnabled] = useState(true)
  const [searchProvider, setSearchProvider] = useState('tavily')
  const [searchApiKey, setSearchApiKey] = useState('')
  const [searchKeyExists, setSearchKeyExists] = useState(false)
  const [searchKeySaved, markSearchKeySaved, clearSearchKeySaved] = useTemporaryFlag()

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
    clearSearchKeySaved()
  }, [searchProvider, clearSearchKeySaved])

  const handleShellChange = (value: string) => {
    setShell(value)
    api.setPreference('shell', value)
  }

  // Unlike the settings below, the theme is not a Tauri preference: it has to be
  // readable before the first paint, so it lives in localStorage — see
  // `src/lib/theme.tsx`.
  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: t('settings.general.themeSystem') },
    { value: 'light', label: t('settings.general.themeLight') },
    { value: 'dark', label: t('settings.general.themeDark') },
  ]

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
    markSearchKeySaved()
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.general.title')} />

      <SettingsSelect
        label={t('settings.general.language')}
        value={i18n.language}
        options={LANGUAGE_OPTIONS}
        onChange={setLocale}
        fullWidth
        triggerClassName="max-w-xs"
      />

      <SettingsSelect
        label={t('settings.general.theme')}
        value={theme}
        options={themeOptions}
        onChange={setTheme}
        fullWidth
        triggerClassName="max-w-xs"
      />

      {platform !== null && platform !== 'android' && (
        <SettingsSelect
          label={t('settings.general.shell')}
          value={shell}
          options={SHELLS}
          onChange={handleShellChange}
          description={t('settings.general.shellHint')}
          fullWidth
          triggerClassName="max-w-xs"
        />
      )}

      {platform === 'windows' && (
        <SettingsSelect
          label={t('settings.general.sandbox')}
          value={sandboxEnabled ? 'on' : 'off'}
          options={sandboxOptions}
          onChange={handleSandboxChange}
          description={t('settings.general.sandboxHint')}
          fullWidth
          triggerClassName="max-w-xs"
        />
      )}

      <div className="space-y-3">
        <p className="block text-xs font-medium text-muted">
          {t('settings.general.webSearch')}
        </p>
        {/* The heading above names the whole section, not this control, so both
            the picker and the key field carry their own name. Without them a
            screen reader announces the trigger by its current value alone. */}
        <SettingsSelect
          ariaLabel={t('settings.general.webSearch')}
          value={searchProvider}
          options={SEARCH_PROVIDERS}
          onChange={handleSearchProviderChange}
          fullWidth
          triggerClassName="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <Input fullWidth
            type="password"
            aria-label={t('settings.provider.apiKey')}
            value={searchApiKey}
            onChange={(e) => setSearchApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') handleSaveSearchKey()
            }}
            placeholder={searchKeyExists ? t('settings.general.searchKeySet') : 'API Key'}
            className="max-w-xs"
          />
          <Button
            variant={searchKeySaved ? 'primary' : 'outline'}
            onClick={handleSaveSearchKey}
            isDisabled={!searchApiKey.trim()}
          >
            {searchKeySaved ? <Check className="w-4 h-4" /> : t('settings.general.save')}
          </Button>
        </div>
        <p className="text-xs text-muted">
          {t('settings.general.searchHint')}
        </p>
      </div>

      {platform === 'android' && <AndroidFileAccess />}
    </SettingsPane>
  )
}
