import './general-settings.css'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { PasswordField } from '@/components/yuerchu-ui/components/password-field/password-field'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { Select } from '@/components/yuerchu-ui/components/select/select'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { Check } from '@keyline-icons/react/two-tone'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { LANGUAGES, setLocale } from '@/i18n'
import { useAppFonts } from '@/lib/fonts'
import { useAppTheme, type ThemePreference } from '@/lib/theme'
import { api } from '@/api'
import { FontPicker } from './font-picker'
import { usePlatform } from '@/hooks/use-platform'
import { AndroidFileAccess } from './android-file-access'
import { RemoteClientSettings } from './remote-client-settings'
import { SettingsHeader, SettingsPane } from './primitives'
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

function InlineSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="m-general__select">
      <Select selectedKey={value} onSelectionChange={(key) => typeof key === 'string' && onChange(key as T)}>
        {options.map((opt) => (
          <ListBoxItem key={opt.value} id={opt.value} textValue={opt.label}>
            {opt.label}
          </ListBoxItem>
        ))}
      </Select>
    </div>
  )
}

export function GeneralSettings() {
  const { t, i18n } = useTranslation()
  const platform = usePlatform()
  const { theme, setTheme } = useAppTheme()
  const { sans, mono, setSans, setMono } = useAppFonts()
  const [fontFamilies, setFontFamilies] = useState<string[]>([])
  const [fontListFailed, setFontListFailed] = useState(false)
  const [shell, setShell] = useState<ShellType>('bash')
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>('auto')
  const [searchProvider, setSearchProvider] = useState<SearchProvider>('tavily')
  const [searchApiKey, setSearchApiKey] = useState('')
  const [searchKeyExists, setSearchKeyExists] = useState(false)
  const [searchKeySaved, markSearchKeySaved, clearSearchKeySaved] = useTemporaryFlag()
  const [searchKeyError, setSearchKeyError] = useState<string | null>(null)
  const [prefError, setPrefError] = useState<string | null>(null)
  const searchProviderTouched = useRef(false)
  const [prefsState, setPrefsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [prefsLoadError, setPrefsLoadError] = useState<string | null>(null)
  const [prefsAttempt, setPrefsAttempt] = useState(0)
  const { confirm, confirmDialog } = useConfirm()
  useSettingsDirtyRegistration('general', 'search-api-key', searchApiKey.trim().length > 0)

  useEffect(() => {
    let cancelled = false
    setPrefsState('loading')
    setPrefsLoadError(null)
    Promise.all([
      api.getPreference({ key: 'shell' }),
      api.getPreference({ key: 'sandbox.enabled' }),
      api.getPreference({ key: 'search_provider' }),
    ])
      .then(([shellPref, sandboxPref, searchPref]) => {
        if (cancelled) return
        if (shellPref.value) setShell(shellPref.value)
        setSandboxMode(sandboxPref.value ?? 'auto')
        if (searchPref.value && !searchProviderTouched.current) setSearchProvider(searchPref.value)
        setPrefsState('ready')
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setPrefsLoadError(String(reason))
        setPrefsState('error')
      })
    return () => {
      cancelled = true
    }
  }, [prefsAttempt])

  useEffect(() => {
    let cancelled = false
    api
      .listSystemFonts()
      .then((res) => {
        if (cancelled) return
        setFontFamilies(res.families)
      })
      .catch(() => {
        if (cancelled) return
        setFontListFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const provider = SEARCH_PROVIDERS.find((p) => p.value === searchProvider)
    if (provider) {
      api
        .getServiceKeyExists(provider.keyService)
        .then(setSearchKeyExists)
        .catch((reason: unknown) => setSearchKeyError(String(reason)))
    }
    setSearchApiKey('')
    clearSearchKeySaved()
  }, [searchProvider, clearSearchKeySaved])

  const handleShellChange = (value: ShellType) => {
    setShell(value)
    setPrefError(null)
    api.setPreference({ key: 'shell', value }).catch((err: unknown) => setPrefError(String(err)))
  }

  const handleSandboxChange = (value: SandboxMode) => {
    setSandboxMode(value)
    setPrefError(null)
    api.setPreference({ key: 'sandbox.enabled', value }).catch((err: unknown) => setPrefError(String(err)))
  }

  const handleSearchProviderChange = async (value: SearchProvider) => {
    if (value === searchProvider) return
    if (
      searchApiKey.trim().length > 0 &&
      !(await confirm({ description: t('settings.dirty.description'), confirmLabel: t('common.discardChanges') }))
    ) {
      return
    }
    searchProviderTouched.current = true
    setSearchProvider(value)
    setPrefError(null)
    api.setPreference({ key: 'search_provider', value }).catch((err: unknown) => setPrefError(String(err)))
  }

  const handleSaveSearchKey = async () => {
    const provider = SEARCH_PROVIDERS.find((p) => p.value === searchProvider)
    if (!provider || !searchApiKey.trim()) return
    setSearchKeyError(null)
    try {
      await api.setServiceKey({ service: provider.keyService, key: searchApiKey.trim() })
      setSearchKeyExists(true)
      setSearchApiKey('')
      markSearchKeySaved()
    } catch (e) {
      setSearchKeyError(String(e))
    }
  }

  const sandboxOptions: { value: SandboxMode; label: string }[] = [
    { value: 'auto', label: t('settings.general.sandboxOn') },
    { value: 'container', label: t('settings.general.sandboxContainer') },
    { value: 'off', label: t('settings.general.sandboxOff') },
  ]

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.general.title')} />

      {/* Compact collapsible summary card at the top: reachable when remote
          host fails, without pushing everyday settings off mobile screens. */}
      <RemoteClientSettings />

      <SettingsGroup heading={t('settings.general.appearanceGroup')} headingLevel={3}>
        <div className="m-general__inline-row">
          <span className="m-general__inline-label">{t('settings.general.theme')}</span>
          <SegmentedControl
            aria-label={t('settings.general.theme')}
            size="sm"
            selectedKey={theme}
            onSelectionChange={(next) => {
              if (next === 'system' || next === 'light' || next === 'dark') setTheme(next as ThemePreference)
            }}
          >
            <Segment id="light">{t('settings.general.themeLight')}</Segment>
            <Segment id="dark">{t('settings.general.themeDark')}</Segment>
            <Segment id="system">{t('settings.general.themeSystem')}</Segment>
          </SegmentedControl>
        </div>
        <div className="m-general__inline-row">
          <span className="m-general__inline-label">{t('settings.general.language')}</span>
          <div className="m-general__select">
            <Select
              aria-label={t('settings.general.language')}
              selectedKey={i18n.language}
              onSelectionChange={(key) => typeof key === 'string' && setLocale(key)}
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <ListBoxItem key={opt.value} id={opt.value} textValue={opt.label}>
                  {opt.label}
                </ListBoxItem>
              ))}
            </Select>
          </div>
        </div>
      </SettingsGroup>

      <div data-slot="general-fonts" className="m-general__stack">
        <SettingsGroup
          heading={t('settings.general.fontsGroup')}
          description={t('settings.general.fontHint')}
          headingLevel={3}
        >
          <div className="m-general__inline-row">
            <span className="m-general__inline-label">{t('settings.general.fontUi')}</span>
            <div className="m-general__font">
              <FontPicker
                hideLabel
                label={t('settings.general.fontUi')}
                value={sans}
                onChange={setSans}
                families={fontFamilies}
              />
            </div>
          </div>
          <div className="m-general__inline-row">
            <span className="m-general__inline-label">{t('settings.general.fontCode')}</span>
            <div className="m-general__font">
              <FontPicker
                hideLabel
                label={t('settings.general.fontCode')}
                value={mono}
                onChange={setMono}
                families={fontFamilies}
              />
            </div>
          </div>
        </SettingsGroup>
        {fontListFailed && (
          <p data-slot="general-font-list-error" role="status" className="m-general__hint">
            {t('settings.general.fontListError')}
          </p>
        )}
      </div>

      {prefsState === 'loading' && (
        <div data-slot="general-prefs-loading" role="status" aria-busy="true" aria-label={t('common.loading')}>
          <SettingsGroup>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="m-general__skeleton-row">
                <Skeleton shape="rect" width="6rem" height="1rem" />
                <Skeleton shape="rect" width="9rem" height="2rem" />
              </div>
            ))}
          </SettingsGroup>
        </div>
      )}

      {prefsState === 'error' && (
        <Alert
          data-slot="general-prefs-error"
          tone="danger"
          shouldAnnounce
          heading={t('settings.general.loadError')}
          actions={
            <Button size="sm" variant="secondary" onPress={() => setPrefsAttempt((n) => n + 1)}>
              {t('common.retry')}
            </Button>
          }
        >
          {prefsLoadError}
        </Alert>
      )}

      {prefsState === 'ready' && platform !== null && platform !== 'android' && (
        <SettingsGroup heading={t('settings.general.terminalGroup')} headingLevel={3}>
          <SettingsRow label={t('settings.general.shell')} description={t('settings.general.shellHint')}>
            <InlineSelect value={shell} options={SHELLS} onChange={handleShellChange} />
          </SettingsRow>
          <SettingsRow
            label={t('settings.general.sandbox')}
            description={
              sandboxMode === 'container'
                ? t('settings.general.sandboxContainerHint')
                : t('settings.general.sandboxHint')
            }
          >
            <InlineSelect value={sandboxMode} options={sandboxOptions} onChange={handleSandboxChange} />
          </SettingsRow>
        </SettingsGroup>
      )}

      {prefsState === 'ready' && (
        <div data-slot="general-web-search" className="m-general__stack">
          <SettingsGroup
            heading={t('settings.general.webSearch')}
            description={t('settings.general.searchHint')}
            headingLevel={3}
          >
            <div className="m-general__inline-row">
              <span className="m-general__inline-label">{t('settings.general.webSearch')}</span>
              <SegmentedControl
                aria-label={t('settings.general.webSearch')}
                size="sm"
                selectedKey={searchProvider}
                onSelectionChange={(next) => {
                  if (next === 'tavily' || next === 'zhipu') void handleSearchProviderChange(next)
                }}
              >
                {SEARCH_PROVIDERS.map((provider) => (
                  <Segment key={provider.value} id={provider.value}>
                    {provider.label}
                  </Segment>
                ))}
              </SegmentedControl>
            </div>
            <div data-slot="general-search-key-row" className="m-general__key-row">
              <PasswordField
                aria-label={t('settings.provider.apiKey')}
                name="searchApiKey"
                // A secret, not an account password; the library has no purpose for it yet (Yuerchu/ui#570).
                autoComplete="current-password"
                value={searchApiKey}
                onChange={setSearchApiKey}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') handleSaveSearchKey()
                }}
                placeholder={searchKeyExists ? t('settings.general.searchKeySet') : 'API Key'}
                className="m-general__key"
              />
              <Button
                aria-label={t('settings.general.save')}
                variant="secondary"
                onPress={handleSaveSearchKey}
                isDisabled={!searchApiKey.trim()}
              >
                {searchKeySaved && <Check size={16} aria-hidden />}
                {t('settings.general.save')}
              </Button>
            </div>
          </SettingsGroup>
          {searchKeyError && (
            <Alert data-slot="general-search-key-error" tone="danger" shouldAnnounce>
              {searchKeyError}
            </Alert>
          )}
        </div>
      )}

      {prefError && (
        <Alert data-slot="general-pref-error" tone="danger" shouldAnnounce>
          {prefError}
        </Alert>
      )}

      {platform === 'android' && <AndroidFileAccess />}
      {confirmDialog}
    </SettingsPane>
  )
}
