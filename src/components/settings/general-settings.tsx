import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input } from '@heroui/react'
import { Check } from '@gravity-ui/icons'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { LANGUAGES, setLocale } from '@/i18n'
import { useAppTheme, type ThemePreference } from '@/lib/theme'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { AndroidFileAccess } from './android-file-access'
import { RemoteClientSettings } from './remote-client-settings'
import { SettingsHeader, SettingsPane, SettingsSelect } from './primitives'
import { useSettingsDirtyRegistration } from './dirty-guard'
import { useConfirm } from '@/hooks/use-confirm'

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
  const [sandboxMode, setSandboxMode] = useState('auto')
  const [searchProvider, setSearchProvider] = useState('tavily')
  const [searchApiKey, setSearchApiKey] = useState('')
  const [searchKeyExists, setSearchKeyExists] = useState(false)
  const [searchKeySaved, markSearchKeySaved, clearSearchKeySaved] = useTemporaryFlag()
  const [searchKeyError, setSearchKeyError] = useState<string | null>(null)
  const searchProviderTouched = useRef(false)
  const { confirm, confirmDialog } = useConfirm()
  useSettingsDirtyRegistration('general', 'search-api-key', searchApiKey.trim().length > 0)

  useEffect(() => {
    api.getPreference('shell').then((v) => {
      if (v) setShell(v)
    })
    // One key, more values. `auto` is what an unset or unreadable preference has
    // always meant: whatever this platform confines commands with, and nothing
    // where it has none.
    api.getPreference('sandbox.enabled').then((v) => {
      const raw = (v ?? '').trim()
      if (raw === 'false' || raw === 'off') setSandboxMode('off')
      else if (raw === 'container' || raw === 'docker') setSandboxMode('container')
      else setSandboxMode('auto')
    })
    api.getPreference('search_provider').then((v) => {
      if (v && !searchProviderTouched.current) setSearchProvider(v)
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
    { value: 'auto', label: t('settings.general.sandboxOn') },
    { value: 'container', label: t('settings.general.sandboxContainer') },
    { value: 'off', label: t('settings.general.sandboxOff') },
  ]

  // Written verbatim rather than mapped back to a boolean: the backend parses
  // the same three words, and a mapping here would be a second place for them
  // to be decided.
  const handleSandboxChange = (value: string) => {
    setSandboxMode(value)
    api.setPreference('sandbox.enabled', value)
  }

  const handleSearchProviderChange = async (value: string) => {
    if (value === searchProvider) return
    if (searchApiKey.trim() && !(await confirm({ body: t('settings.unsavedChanges'), status: 'warning' }))) {
      return
    }
    searchProviderTouched.current = true
    setSearchProvider(value)
    await api.setPreference('search_provider', value)
  }

  const handleSaveSearchKey = async () => {
    if (!searchApiKey.trim()) return
    const provider = SEARCH_PROVIDERS.find((p) => p.value === searchProvider)
    if (!provider) return
    setSearchKeyError(null)
    try {
      await api.setServiceKey(provider.keyService, searchApiKey.trim())
      setSearchKeyExists(true)
      setSearchApiKey('')
      markSearchKeySaved()
    } catch (reason) {
      setSearchKeyError(String(reason))
    }
  }

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.general.title')} />

      {/* First, and above the language: in remote mode every other control on
          this page is editing the *other* machine's preferences, and this is
          the only one that is still about the device in your hand — including
          when that other machine has stopped answering. */}
      <RemoteClientSettings />

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

      {/* No longer Windows-only: the restricted token is, a container is not. */}
      {platform !== null && platform !== 'android' && (
        <SettingsSelect
          label={t('settings.general.sandbox')}
          value={sandboxMode}
          options={sandboxOptions}
          onChange={handleSandboxChange}
          description={
            sandboxMode === 'container' ? t('settings.general.sandboxContainerHint') : t('settings.general.sandboxHint')
          }
          fullWidth
          triggerClassName="max-w-xs"
        />
      )}

      <div className="space-y-3">
        <p className="block text-xs font-medium text-muted">{t('settings.general.webSearch')}</p>
        {/* The heading above names the whole section, not this control, so both
            the picker and the key field carry their own name. Without them a
            screen reader announces the trigger by its current value alone. */}
        <SettingsSelect
          ariaLabel={t('settings.general.webSearch')}
          value={searchProvider}
          options={SEARCH_PROVIDERS}
          onChange={(value) => void handleSearchProviderChange(value)}
          fullWidth
          triggerClassName="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <Input
            fullWidth
            type="password"
            aria-label={t('settings.provider.apiKey')}
            name="searchApiKey"
            autoComplete="off"
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
            aria-label={t('settings.general.save')}
            variant={searchKeySaved ? 'primary' : 'outline'}
            onPress={handleSaveSearchKey}
            isDisabled={!searchApiKey.trim()}
          >
            {searchKeySaved && <Check aria-hidden="true" className="w-4 h-4" />}
            {t('settings.general.save')}
          </Button>
        </div>
        <p className="text-xs text-muted">{t('settings.general.searchHint')}</p>
        {searchKeyError && (
          <p role="alert" className="text-xs text-danger break-all">
            {searchKeyError}
          </p>
        )}
      </div>

      {platform === 'android' && <AndroidFileAccess />}
      {confirmDialog}
    </SettingsPane>
  )
}
