import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input } from '@/components/base'
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
import type { SandboxMode, SearchProvider, ShellType } from '@/types'

const LANGUAGE_OPTIONS = LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))

const SHELLS = [
  { value: 'bash', label: 'Bash (Git Bash)' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'CMD' },
] as const

const SEARCH_PROVIDERS = [
  { value: 'tavily', label: 'Tavily', keyService: 'TAVILY' },
  { value: 'zhipu', label: '智谱 (Zhipu)', keyService: 'ZHIPU_SEARCH' },
] as const

export function GeneralSettings() {
  const { t, i18n } = useTranslation()
  const platform = usePlatform()
  const { theme, setTheme } = useAppTheme()
  const [shell, setShell] = useState<ShellType>('bash')
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>('auto')
  const [searchProvider, setSearchProvider] = useState<SearchProvider>('tavily')
  const [searchApiKey, setSearchApiKey] = useState('')
  const [searchKeyExists, setSearchKeyExists] = useState(false)
  const [searchKeySaved, markSearchKeySaved, clearSearchKeySaved] = useTemporaryFlag()
  const [searchKeyError, setSearchKeyError] = useState<string | null>(null)
  const [prefError, setPrefError] = useState<string | null>(null)
  const searchProviderTouched = useRef(false)
  const { confirm, confirmDialog } = useConfirm()
  useSettingsDirtyRegistration('general', 'search-api-key', searchApiKey.trim().length > 0)

  useEffect(() => {
    api.getPreference({ key: 'shell' }).then(({ value }) => {
      if (value) setShell(value)
    })
    // `auto` is the canonical missing-value default: whatever this platform
    // confines commands with, and nothing where it has none.
    api.getPreference({ key: 'sandbox.enabled' }).then(({ value }) => {
      setSandboxMode(value ?? 'auto')
    })
    api.getPreference({ key: 'search_provider' }).then(({ value }) => {
      if (value && !searchProviderTouched.current) setSearchProvider(value)
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

  const handleShellChange = (value: ShellType) => {
    setShell(value)
    setPrefError(null)
    api.setPreference({ key: 'shell', value }).catch((reason) => setPrefError(String(reason)))
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
  ] as const

  // Written verbatim rather than mapped back to a boolean: the backend parses
  // the same three words, and a mapping here would be a second place for them
  // to be decided.
  const handleSandboxChange = (value: SandboxMode) => {
    setSandboxMode(value)
    setPrefError(null)
    api.setPreference({ key: 'sandbox.enabled', value }).catch((reason) => setPrefError(String(reason)))
  }

  const handleSearchProviderChange = async (value: SearchProvider) => {
    if (value === searchProvider) return
    if (searchApiKey.trim() && !(await confirm({ body: t('settings.unsavedChanges'), status: 'warning' }))) {
      return
    }
    searchProviderTouched.current = true
    setSearchProvider(value)
    setPrefError(null)
    await api.setPreference({ key: 'search_provider', value }).catch((reason) => setPrefError(String(reason)))
  }

  const handleSaveSearchKey = async () => {
    if (!searchApiKey.trim()) return
    const provider = SEARCH_PROVIDERS.find((p) => p.value === searchProvider)
    if (!provider) return
    setSearchKeyError(null)
    try {
      await api.setServiceKey({ service: provider.keyService, key: searchApiKey.trim() })
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

      <div data-slot="general-web-search" className="space-y-3">
        <p data-slot="general-section-label" className="block text-xs font-medium text-muted">
          {t('settings.general.webSearch')}
        </p>
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
        <div data-slot="general-search-key-row" className="flex items-center gap-2">
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
        <p data-slot="general-search-hint" className="text-xs text-muted">
          {t('settings.general.searchHint')}
        </p>
        {searchKeyError && (
          <p data-slot="general-search-key-error" role="alert" className="text-xs text-danger break-all">
            {searchKeyError}
          </p>
        )}
      </div>

      {prefError && (
        <p data-slot="general-pref-error" role="alert" className="text-xs text-danger break-all">
          {prefError}
        </p>
      )}

      {platform === 'android' && <AndroidFileAccess />}
      {confirmDialog}
    </SettingsPane>
  )
}
