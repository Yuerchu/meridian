import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Description, Input, Label, ListBox, Select } from '@heroui/react'
import { Check } from '@gravity-ui/icons'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { LANGUAGES, setLocale } from '@/i18n'
import { useAppTheme, type ThemePreference } from '@/lib/theme'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { AndroidFileAccess } from './android-file-access'
import { SettingsHeader, SettingsPane } from './primitives'

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

      <Select fullWidth value={i18n.language} onChange={(v) => v && setLocale(String(v))}>
        <Label>{t('settings.general.language')}</Label>
        <Select.Trigger className="max-w-xs">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {LANGUAGE_OPTIONS.map((lang) => (
              <ListBox.Item key={lang.value} id={lang.value} textValue={lang.label}>
                {lang.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Select fullWidth value={theme} onChange={(v) => v && setTheme(String(v) as ThemePreference)}>
        <Label>{t('settings.general.theme')}</Label>
        <Select.Trigger className="max-w-xs">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {themeOptions.map((o) => (
              <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                {o.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      {platform !== null && platform !== 'android' && (
        <Select fullWidth value={shell} onChange={(v) => v && handleShellChange(String(v))}>
          <Label>{t('settings.general.shell')}</Label>
          <Select.Trigger className="max-w-xs">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {SHELLS.map((s) => (
                <ListBox.Item key={s.value} id={s.value} textValue={s.label}>
                  {s.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
          <Description>{t('settings.general.shellHint')}</Description>
        </Select>
      )}

      {platform === 'windows' && (
        <Select fullWidth value={sandboxEnabled ? 'on' : 'off'} onChange={(v) => v && handleSandboxChange(String(v))}>
          <Label>{t('settings.general.sandbox')}</Label>
          <Select.Trigger className="max-w-xs">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {sandboxOptions.map((o) => (
                <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                  {o.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
          <Description>{t('settings.general.sandboxHint')}</Description>
        </Select>
      )}

      <div className="space-y-3">
        <p className="block text-xs font-medium text-muted">
          {t('settings.general.webSearch')}
        </p>
        {/* The heading above names the whole section, not this control, so both
            the picker and the key field carry their own name. Without them a
            screen reader announces the trigger by its current value alone. */}
        <Select fullWidth value={searchProvider} onChange={(v) => v && handleSearchProviderChange(String(v))}>
          <Select.Trigger className="max-w-xs" aria-label={t('settings.general.webSearch')}>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {SEARCH_PROVIDERS.map((p) => (
                <ListBox.Item key={p.value} id={p.value} textValue={p.label}>
                  {p.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
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
