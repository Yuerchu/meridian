import { Fragment, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Alert,
  Button,
  CellSwitch,
  Description,
  ItemCard,
  ItemCardGroup,
  Label,
  Separator,
  Spinner,
  TextArea,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import { Bin } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { useConfirm } from '@/hooks/use-confirm'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { cx } from '@/utils/cx'
import type {
  ImeConfigInfoResponse,
  ImeDictionaryImportReportResponse,
  ImeDictionaryInfoResponse,
  ImePunctuation,
  ImeScheme,
  ImeStatusInfoResponse,
} from '@/types'
import { SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from './primitives'
import { useSettingsDirtyRegistration } from './dirty-guard'

/** Mirrors `HostConfig::default()`; only used until the first load lands. */
const DEFAULTS: ImeConfigInfoResponse = {
  scheme: 'pinyin',
  page_size: 5,
  punctuation: 'full_width',
  learning: true,
  private_apps: [],
  debug_log: false,
}

const PAGE_SIZES = ['3', '4', '5', '6', '7', '8', '9'] as const

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

/**
 * The input method: a Windows text service and the host process behind it.
 *
 * Three things on this page are decisions the rest of the app never makes.
 * Registration is machine-wide and needs one elevation prompt, so it is a
 * button and not a switch. Whether the profile is on for *this user* is a
 * per-user setting TSF lets an ordinary process flip, so that one is a switch.
 * And the host is a process that belongs to the login session, not to this
 * window: starting it here is a convenience, stopping it is a debugging aid,
 * and closing Meridian does neither.
 */
export function ImeSettings() {
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const [status, setStatus] = useState<ImeStatusInfoResponse | null>(null)
  const [config, setConfig] = useState<ImeConfigInfoResponse>(DEFAULTS)
  const [dictionaries, setDictionaries] = useState<ImeDictionaryInfoResponse[]>([])
  const [privateAppsInput, setPrivateAppsInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, markSaved] = useTemporaryFlag()
  const [busy, setBusy] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<ImeDictionaryImportReportResponse | null>(null)
  const [savedDraft, setSavedDraft] = useState<string | null>(null)
  const draft = JSON.stringify({ ...config, private_apps: privateAppsInput })
  const dirty = loaded && draft !== savedDraft
  useSettingsDirtyRegistration('ime', 'ime-config', dirty)

  const adoptConfig = (cfg: ImeConfigInfoResponse) => {
    const apps = cfg.private_apps.join('\n')
    setConfig(cfg)
    setPrivateAppsInput(apps)
    setSavedDraft(JSON.stringify({ ...cfg, private_apps: apps }))
  }

  const loadData = useCallback(async () => {
    setLoadError(null)
    try {
      const [sts, cfg, dicts] = await Promise.all([api.getImeStatus(), api.getImeConfig(), api.listImeDictionaries()])
      setStatus(sts)
      adoptConfig(cfg)
      setDictionaries(dicts)
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
        setStatus(await api.getImeStatus())
      } catch {
        // Polling failures are not worth a banner: the next tick will say.
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      const next = await api.saveImeConfig({
        ...config,
        private_apps: privateAppsInput
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      })
      adoptConfig(next)
      markSaved()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const run = async (what: string, action: () => Promise<ImeStatusInfoResponse>) => {
    setError(null)
    setBusy(what)
    try {
      setStatus(await action())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleImport = async () => {
    setError(null)
    const file = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Rime', extensions: ['yaml'] }],
    })
    if (!file) return
    setImporting(true)
    setReport(null)
    try {
      const result = await api.importImeDictionary({ path: file, license: null, name: null })
      setReport(result)
      setDictionaries(await api.listImeDictionaries())
    } catch (err) {
      setError(String(err))
    } finally {
      setImporting(false)
    }
  }

  const handleToggleDictionary = async (file: string, enabled: boolean) => {
    setError(null)
    try {
      setDictionaries(await api.setImeDictionaryEnabled({ file, enabled }))
    } catch (err) {
      setError(String(err))
    }
  }

  const handleRemoveDictionary = async (dict: ImeDictionaryInfoResponse) => {
    if (!(await confirm({ body: t('settings.ime.removeConfirm', { name: dict.name }), status: 'danger' }))) return
    setError(null)
    try {
      setDictionaries(await api.removeImeDictionary({ file: dict.file }))
    } catch (err) {
      setError(String(err))
    }
  }

  if (loading) return <SettingsSkeleton />
  if (!loaded) {
    return (
      <SettingsPane>
        <SettingsHeader title={t('settings.ime.title')} subtitle={t('settings.ime.subtitle')} />
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('settings.ime.loadError')}</Alert.Title>
            {loadError && <Alert.Description className="break-all">{loadError}</Alert.Description>}
            <Button
              size="small"
              variant="secondary"
              className="mt-2"
              onPress={() => {
                setLoading(true)
                void loadData()
              }}
            >
              {t('settings.ime.retry')}
            </Button>
          </Alert.Content>
        </Alert>
      </SettingsPane>
    )
  }

  const registered = status?.registered_x64 ?? false
  const hostRunning = status?.host_running ?? false

  return (
    <SettingsPane>
      <SettingsHeader title={t('settings.ime.title')} subtitle={t('settings.ime.subtitle')} />

      {status && (
        <ItemCard variant="outline">
          <ItemCard.Content className="min-w-0 space-y-1">
            <ItemCard.Title className="flex w-full items-center gap-2">
              {/* Decoration: the state is spelled out beside it. */}
              <span
                data-slot="ime-status-dot"
                aria-hidden
                className={cx(
                  'inline-block size-2 shrink-0 rounded-full',
                  registered && hostRunning ? 'bg-status-success' : 'bg-background-secondary-default',
                )}
              />
              {!status.installed
                ? t('settings.ime.notInstalled')
                : !registered
                  ? t('settings.ime.notRegistered')
                  : hostRunning
                    ? t('settings.ime.hostRunning')
                    : t('settings.ime.hostStopped')}
            </ItemCard.Title>
            <ItemCard.Description className="w-full whitespace-normal">
              {registered && (
                <span data-slot="ime-status-arch">
                  {status.registered_x86 ? t('settings.ime.registeredBoth') : t('settings.ime.registeredX64Only')}
                </span>
              )}
              {hostRunning && (
                <span data-slot="ime-status-host">
                  {' · '}
                  {t('settings.ime.hostDetail', {
                    version: status.host_version ?? '?',
                    count: status.sessions,
                  })}
                  {!status.protocol_compatible && ` · ${t('settings.ime.protocolMismatch')}`}
                </span>
              )}
            </ItemCard.Description>
            <ItemCard.Description className="w-full whitespace-normal break-all font-mono text-caption-2-regular">
              {status.data_dir}
            </ItemCard.Description>
          </ItemCard.Content>
        </ItemCard>
      )}

      <div data-slot="ime-actions" className="flex flex-wrap items-center gap-3">
        <Button
          variant={registered ? 'secondary' : 'primary'}
          isDisabled={!status?.installed || busy !== null}
          isPending={busy === 'register'}
          onPress={() => run('register', api.registerIme)}
        >
          {registered ? t('settings.ime.reregister') : t('settings.ime.register')}
        </Button>
        {hostRunning ? (
          <Button
            variant="danger"
            isDisabled={busy !== null}
            isPending={busy === 'stop'}
            onPress={() => run('stop', api.stopImeHost)}
          >
            {t('settings.ime.stopHost')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            isDisabled={!status?.installed || busy !== null}
            isPending={busy === 'start'}
            onPress={() => run('start', api.startImeHost)}
          >
            {t('settings.ime.startHost')}
          </Button>
        )}
      </div>
      <p data-slot="ime-register-hint" className="text-caption-1-regular text-text-secondary">
        {t('settings.ime.registerHint')}
      </p>

      <div data-slot="ime-enable" className="space-y-1.5">
        <CellSwitch
          aria-label={t('settings.ime.enableForUser')}
          aria-describedby="ime-enable-hint"
          isSelected={status?.enabled_for_user ?? false}
          isDisabled={!registered || busy !== null}
          onChange={(selected) => run('profile', () => api.setImeProfileEnabled({ enabled: selected }))}
        >
          <CellSwitch.Trigger className="pointer-coarse:h-11">
            <CellSwitch.Label>{t('settings.ime.enableForUser')}</CellSwitch.Label>
            <CellSwitch.Control />
          </CellSwitch.Trigger>
        </CellSwitch>
        <p id="ime-enable-hint" data-slot="ime-enable-hint" className="text-caption-1-regular text-text-secondary">
          {t('settings.ime.enableForUserHint')}
        </p>
      </div>

      <div data-slot="ime-config" className="grid grid-cols-1 @sm/pane:grid-cols-3 gap-3">
        <SettingsSelect<ImeScheme>
          label={t('settings.ime.scheme')}
          value={config.scheme}
          onChange={(scheme) => setConfig({ ...config, scheme })}
          options={[
            { value: 'pinyin', label: t('settings.ime.scheme.pinyin') },
            { value: 'zhuyin', label: t('settings.ime.scheme.zhuyin') },
          ]}
        />
        <SettingsSelect<(typeof PAGE_SIZES)[number]>
          label={t('settings.ime.pageSize')}
          value={String(config.page_size) as (typeof PAGE_SIZES)[number]}
          onChange={(v) => setConfig({ ...config, page_size: Number(v) })}
          options={PAGE_SIZES.map((v) => ({ value: v, label: v }))}
        />
        <SettingsSelect<ImePunctuation>
          label={t('settings.ime.punctuation')}
          value={config.punctuation}
          onChange={(punctuation) => setConfig({ ...config, punctuation })}
          options={[
            { value: 'full_width', label: t('settings.ime.punctuation.fullWidth') },
            { value: 'half_width', label: t('settings.ime.punctuation.halfWidth') },
          ]}
        />
      </div>
      <p data-slot="ime-scheme-hint" className="text-caption-1-regular text-text-secondary">
        {t('settings.ime.schemeHint')}
      </p>

      <div data-slot="ime-learning" className="space-y-1.5">
        <CellSwitch
          aria-label={t('settings.ime.learning')}
          aria-describedby="ime-learning-hint"
          isSelected={config.learning}
          onChange={(selected) => setConfig({ ...config, learning: selected })}
        >
          <CellSwitch.Trigger className="pointer-coarse:h-11">
            <CellSwitch.Label>{t('settings.ime.learning')}</CellSwitch.Label>
            <CellSwitch.Control />
          </CellSwitch.Trigger>
        </CellSwitch>
        <p id="ime-learning-hint" data-slot="ime-learning-hint" className="text-caption-1-regular text-text-secondary">
          {t('settings.ime.learningHint')}
        </p>
      </div>

      <TextField>
        <Label>{t('settings.ime.privateApps')}</Label>
        <TextArea
          name="imePrivateApps"
          rows={3}
          value={privateAppsInput}
          onChange={(e) => setPrivateAppsInput(e.target.value)}
          placeholder={'KeePass.exe\n1Password.exe'}
        />
        <Description>{t('settings.ime.privateAppsHint')}</Description>
      </TextField>

      <CellSwitch
        aria-label={t('settings.ime.debugLog')}
        isSelected={config.debug_log}
        onChange={(selected) => setConfig({ ...config, debug_log: selected })}
      >
        <CellSwitch.Trigger className="pointer-coarse:h-11">
          <CellSwitch.Label>{t('settings.ime.debugLog')}</CellSwitch.Label>
          <CellSwitch.Control />
        </CellSwitch.Trigger>
      </CellSwitch>

      {error && (
        <p data-slot="ime-error" role="alert" className="text-caption-1-regular text-status-danger break-all">
          {error}
        </p>
      )}

      <div data-slot="ime-save" className="flex items-center gap-3 pt-2">
        <Button variant="secondary" onPress={handleSave} isDisabled={saving || !dirty}>
          {saved ? t('common.saved') : t('common.save')}
        </Button>
        {saved && (
          <span data-slot="ime-saved" role="status" className="sr-only">
            {t('common.saved')}
          </span>
        )}
      </div>

      <div data-slot="ime-dictionaries" className="space-y-1.5">
        <div data-slot="ime-dictionaries-head" className="flex items-center justify-between gap-3">
          <p data-slot="ime-dictionaries-label" className="text-caption-1-medium text-text-secondary">
            {t('settings.ime.dictionaries')}
          </p>
          {can.importFromDisk && (
            <Button
              size="small"
              variant="secondary"
              onPress={handleImport}
              isDisabled={importing}
              isPending={importing}
            >
              {t('settings.ime.importDictionary')}
            </Button>
          )}
        </div>
        {importing && (
          <p
            data-slot="ime-importing"
            role="status"
            className="flex items-center gap-2 text-caption-1-regular text-text-secondary"
          >
            <Spinner size="sm" />
            {t('settings.ime.importing')}
          </p>
        )}
        {report && (
          <Alert status={report.accepted > 0 ? 'success' : 'warning'}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                {report.cache_hit
                  ? t('settings.ime.importCached', { name: report.name })
                  : t('settings.ime.importDone', { name: report.name, count: report.accepted })}
              </Alert.Title>
              {report.notes.length > 0 && (
                <Alert.Description className="whitespace-pre-line">{report.notes.join('\n')}</Alert.Description>
              )}
            </Alert.Content>
          </Alert>
        )}
        {dictionaries.length === 0 ? (
          <p data-slot="ime-dictionaries-empty" className="text-caption-1-regular text-text-secondary">
            {t('settings.ime.dictionariesEmpty')}
          </p>
        ) : (
          <ItemCardGroup variant="outline">
            {dictionaries.map((dict, index) => (
              <Fragment key={dict.file}>
                {index > 0 && <Separator />}
                <ItemCard>
                  <ItemCard.Content className="min-w-0">
                    <ItemCard.Title className="w-full truncate">{dict.name}</ItemCard.Title>
                    <ItemCard.Description className="w-full whitespace-normal">
                      {t('settings.ime.dictionaryDetail', {
                        count: dict.entries,
                        size:
                          dict.size_bytes === null
                            ? t('settings.ime.dictionarySizeUnknown')
                            : formatBytes(dict.size_bytes),
                        license: dict.license,
                      })}
                    </ItemCard.Description>
                  </ItemCard.Content>
                  <ItemCard.Action className="flex items-center gap-2">
                    <CellSwitch
                      aria-label={t('settings.ime.dictionaryEnabled', { name: dict.name })}
                      isSelected={dict.enabled}
                      onChange={(selected) => handleToggleDictionary(dict.file, selected)}
                    >
                      <CellSwitch.Trigger>
                        <CellSwitch.Control />
                      </CellSwitch.Trigger>
                    </CellSwitch>
                    <TooltipTrigger delay={0}>
                      <Button
                        iconOnly
                        leadingIcon={Bin}
                        size="small"
                        variant="neutral"
                        aria-label={t('settings.ime.removeDictionary', { name: dict.name })}
                        onPress={() => handleRemoveDictionary(dict)}
                      />
                      <Tooltip>{t('settings.ime.removeDictionary', { name: dict.name })}</Tooltip>
                    </TooltipTrigger>
                  </ItemCard.Action>
                </ItemCard>
              </Fragment>
            ))}
          </ItemCardGroup>
        )}
        <p data-slot="ime-dictionaries-hint" className="text-caption-1-regular text-text-secondary">
          {t('settings.ime.dictionariesHint')}
        </p>
      </div>

      <p data-slot="ime-limitations" className="text-caption-1-regular text-text-secondary">
        {t('settings.ime.limitations')}
      </p>

      {confirmDialog}
    </SettingsPane>
  )
}
