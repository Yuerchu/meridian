import './provider-page.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { Bin, Key, Plus, RefreshCw } from '@keyline-icons/react/two-tone'
import { DataTable, type DataTableColumn } from '@/components/yuerchu-ui/components/data-table/data-table'
import { Drawer } from '@/components/yuerchu-ui/components/drawer/drawer'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { PasswordField } from '@/components/yuerchu-ui/components/password-field/password-field'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { formatCurrencyAmount, formatDecimalAmount } from '@/lib/cost-format'
import { SavedHint, SettingsSectionLabel, SettingsSelect, SettingsSkeleton } from '../primitives'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { SettingsPage } from '../settings-page'
import { useSettingsDraft, useSettingsResume } from '../settings-stack'
import { CodexAccount } from './codex-account'
import { ProviderIconPicker } from './icon-picker'
import {
  authMethodLabel,
  balanceEntry,
  defaultUrlFor,
  entryByType,
  entryForRow,
  typeSelectOptions,
  formatsFor,
  parseProviderApiFormat,
  requireProviderType,
  URL_PLACEHOLDERS,
  useProviderCatalog,
  usesChatGptLogin,
  usesVertexServiceAccount,
} from './catalog'
import { isPriced } from './pricing'
import { LocalModelSettings } from './local-model-settings'
import { isRemote } from '@/lib/transport'
import type {
  DecimalString,
  LocalInferenceBackend,
  ModelConfigInfoResponse,
  ProviderInfoResponse,
  ProviderBalanceInfoResponse,
  ProviderApiFormat,
} from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

async function pickModelFile(): Promise<string | null> {
  const file = await dialogOpen({
    multiple: false,
    filters: [{ name: 'LiteRT-LM model', extensions: ['litertlm'] }],
  }).catch(() => null)
  return typeof file === 'string' ? file : null
}

/** Only the Responses adapter reads the column; a ChatGPT login is that shape already. */
function offersCodexRequestShapeFor(apiFormat: ProviderApiFormat, provider: ProviderInfoResponse): boolean {
  return apiFormat === 'responses' && !usesChatGptLogin(provider)
}

/** One line of the model table: what the provider announced, joined to what we configured. */
interface ModelRow {
  id: string
  name: string
  config?: ModelConfigInfoResponse
  /** `null` when nothing has been fetched yet: the page has not asked the
   *  provider, so it has nothing to say about what the provider lists. */
  listed: boolean | null
}

/**
 * A context window as a magnitude.
 *
 * `200K` rather than `200,000`: beside two rates the exact digits are noise,
 * and the column only has to let four rows be told apart at a glance. `Intl`
 * is safe here in a way it is not for money — this is a count, not an amount,
 * and nothing is billed against it.
 */
function formatTokenCount(tokens: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens)
}

/**
 * A rate, or a dash.
 *
 * `null` is an unknown price and an explicit `"0"` is free, so the two may not
 * collapse: a dash where a zero belongs reads as a model nobody has priced.
 */
function formatRate(price: DecimalString | null, locale: string, t: (key: string) => string): string {
  if (price === null) return t('settings.provider.modelNoValue')
  return formatDecimalAmount(price, locale, 2, 4)
}

/**
 * Whether a model is configured, priced, and announced by this provider.
 *
 * The rates shown are the ones in force rather than the row's own: a model
 * priced by its profile — which is almost all of them — carries null on the row
 * and would otherwise be reported as having no price at all.
 */
function ModelStatus({ config, listed }: { config?: ModelConfigInfoResponse; listed: boolean | null }) {
  const { t } = useTranslation()
  if (!config) {
    return (
      <span data-slot="model-status-unconfigured" className="m-provider-page__muted">
        {t('settings.provider.modelNotConfigured')}
      </span>
    )
  }
  return (
    // Wraps rather than widening its column: "not in list" beside "priced" is
    // two lines in a fixed-layout table at the settings width.
    <span data-slot="model-status" className="m-provider-page__status">
      {listed === false && (
        <span data-slot="model-status-unlisted" className="m-provider-page__muted">
          {t('settings.provider.modelNotListed')}
        </span>
      )}
      {isPriced(config.effective_pricing) ? (
        <span data-slot="model-status-priced" className="m-provider-page__status-item" data-tone="success">
          <span data-slot="model-status-dot" aria-hidden className="m-provider-page__status-dot" />
          {t('settings.provider.modelPriced')}
        </span>
      ) : (
        <span data-slot="model-status-unpriced" className="m-provider-page__status-item" data-tone="warning">
          <span data-slot="model-status-dot" aria-hidden className="m-provider-page__status-dot" />
          {t('settings.provider.modelPriceMissing')}
        </span>
      )}
    </span>
  )
}

function ProviderEditor({
  provider,
  onUpdate,
  onOpenModel,
  onDeleted,
}: {
  provider: ProviderInfoResponse
  onUpdate: () => void
  /// Opens a model's own page.
  onOpenModel: (modelId: string) => void
  /// Unwinds the stack. The list refetches when it becomes the top page
  /// again, so there is nothing to tell it.
  onDeleted: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const formatBalance = useCallback(
    (value: DecimalString, currency: string) => formatCurrencyAmount(value, currency, locale),
    [locale],
  )
  const catalog = useProviderCatalog()
  const [name, setName] = useState(provider.name)
  const [providerType, setProviderType] = useState(provider.provider_type)
  const [baseUrl, setBaseUrl] = useState(provider.base_url)
  const [apiFormat, setApiFormat] = useState(provider.api_format || 'chat_completions')
  const [icon, setIcon] = useState(provider.icon)
  const [codexRequestShape, setCodexRequestShape] = useState(provider.codex_request_shape)
  // 可编辑草稿随 ProviderEditor 的 provider.id key 重建，不能由 prop 覆盖未保存的选择。
  const [localBackend, setLocalBackend] = useState<LocalInferenceBackend | null>(provider.local_backend)
  /**
   * The Codex release this install claims to be.
   *
   * A preference rather than a column: one install has one identity, and a
   * second answer per provider row would be two. Loaded and saved beside the
   * switch because that is the only place it means anything — empty is the
   * ordinary state and takes whatever version this build shipped with.
   */
  const [codexClientVersion, setCodexClientVersion] = useState('')
  /** What the preference held when it was read or last written, so the field
   *  counts toward unsaved work like every other box on this form. */
  const [savedCodexClientVersion, setSavedCodexClientVersion] = useState('')
  const [savedDraft, setSavedDraft] = useState(() => ({
    name: provider.name,
    providerType: provider.provider_type,
    baseUrl: provider.base_url,
    apiFormat: provider.api_format || 'chat_completions',
    icon: provider.icon,
    codexRequestShape: provider.codex_request_shape,
    localBackend: provider.local_backend,
  }))
  const [apiKey, setApiKey] = useState('')
  const { confirm, confirmDialog } = useConfirm()
  // Not a boolean: while the lookup is in flight `false` renders exactly like
  // "no key configured", and so does a lookup that failed. Both would invite the
  // user to enter a key they already have — and saving one rewrites the store
  // under a fresh passphrase, which is how the *other* providers' keys get lost.
  const [keyStatus, setKeyStatus] = useState<'loading' | 'set' | 'unset' | 'error'>('loading')
  /** What went wrong saving a key or switching the sign-in method, said under
   *  the field rather than in the browser's own dialog. */
  const [credentialError, setCredentialError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState(false)
  const [keySaved, markKeySaved] = useTemporaryFlag()
  const [saved, markSaved] = useTemporaryFlag()
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  // Whether `models` says anything about the provider: a fetch that answered,
  // or a cache that holds one. An empty cache is nothing fetched yet, not an
  // announcement that the provider lists nothing.
  const [modelsKnown, setModelsKnown] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [balance, setBalance] = useState<ProviderBalanceInfoResponse | null>(null)
  const [fetchingBalance, setFetchingBalance] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [modelConfigs, setModelConfigs] = useState<Map<string, ModelConfigInfoResponse>>(new Map())
  const [modelFilter, setModelFilter] = useState('')
  const [addingModel, setAddingModel] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  /** Above this many, a filter box appears. */
  const FILTER_THRESHOLD = 8
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const dirty =
    name !== savedDraft.name ||
    providerType !== savedDraft.providerType ||
    baseUrl !== savedDraft.baseUrl ||
    apiFormat !== savedDraft.apiFormat ||
    icon !== savedDraft.icon ||
    codexRequestShape !== savedDraft.codexRequestShape ||
    localBackend !== savedDraft.localBackend ||
    (offersCodexRequestShapeFor(apiFormat, provider) &&
      codexRequestShape &&
      codexClientVersion.trim() !== savedCodexClientVersion.trim())

  // Registered with the tab *and* with the page this is on: the shell refuses
  // to leave settings while it is dirty, and the stack refuses to pop this
  // page. One source id per provider, so two pages on the stack cannot answer
  // for each other.
  useSettingsDraft('provider', `provider:${provider.id}`, dirty)
  // The key is its own draft with its own button: Save above never writes it,
  // so counting it there made that button look like it had failed to save
  // something it was never going to. Leaving with a typed key still asks.
  useSettingsDraft('provider', `provider-key:${provider.id}`, apiKey.trim().length > 0)

  // Deletion clears secrets and cached models before the list reloads, so the
  // button has to stay disabled and say what it is doing — otherwise a slow
  // delete looks like a click that did not register, and a second click races
  // the first.
  const handleDelete = useCallback(async () => {
    if (
      !(await confirm({
        description: t('settings.confirmDelete.provider'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      }))
    )
      return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteProvider(provider.id)
    } catch (err) {
      setDeleteError(String(err))
      setDeleting(false)
      return
    }
    setDeleting(false)
    onDeleted()
  }, [confirm, t, onDeleted, provider.id])

  // Loaded once per page, not per keystroke: the field is a preference and the
  // switch it sits under is what decides whether it is ever shown.
  useEffect(() => {
    let cancelled = false
    api
      .getPreference({ key: 'codex.client_version' })
      .then((preference) => {
        if (cancelled) return
        setCodexClientVersion(preference.value ?? '')
        setSavedCodexClientVersion(preference.value ?? '')
      })
      .catch((err) => {
        // Decorative: the default is a working version, so an unreadable
        // override costs the field its current value and nothing else.
        console.error('Failed to read the Codex client version override:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (provider.credential_kind === 'none') {
      setKeyStatus('set')
      return
    }
    let cancelled = false
    setKeyStatus('loading')
    api
      .getProviderKeyExists(provider.id)
      .then((exists) => {
        if (!cancelled) setKeyStatus(exists ? 'set' : 'unset')
      })
      .catch((err) => {
        console.error('Failed to check for a saved key:', err)
        if (!cancelled) setKeyStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [provider.id, provider.credential_kind])

  // The vendor this row is, which is not the same question as which adapter
  // family it uses — three of them are `openai`.
  const rowEntry = entryForRow(catalog, provider.catalog_id, providerType)

  // The sign-in option the form is under right now: the row's stored kind
  // resolved against its vendor's entry. A type transition chooses a new login
  // explicitly in `handleProviderTypeChange`; persisted mismatches are rejected
  // here.
  const activeAuth = (() => {
    if (!rowEntry) return undefined
    return rowEntry.auth.find((a) => a.credential_kind === provider.credential_kind) ?? rowEntry.auth[0]
  })()

  // Only the Responses adapter reads the column, so only a Responses row is
  // offered the switch. A `chatgpt_codex` row is the shape already — it goes to
  // `CodexProvider`, which does not consult the setting — and showing a
  // control there that changes nothing is worse than not showing one.
  const offersCodexRequestShape = offersCodexRequestShapeFor(apiFormat, provider)

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      // A changed type can leave the row under a sign-in its new vendor does not
      // offer — a Codex login on an Anthropic row answers to no adapter. The
      // save restates the resolved option's credentials so the row cannot hold
      // that combination; when nothing changed this writes back what is there.
      const resolvedAuth = activeAuth ?? null
      await api.updateProvider({
        id: provider.id,
        name,
        ...(isRemote
          ? {}
          : {
              providerType,
              baseUrl,
              apiFormat,
              localBackend,
              ...(resolvedAuth === null
                ? {}
                : { credentialKind: resolvedAuth.credential_kind, transportProfile: resolvedAuth.transport_profile }),
            }),
        // Sent on every save, `null` included: null is the picker's own default
        // entry — "derive the mark from the vendor" — and omitting it would mean
        // "leave the logo alone", so choosing that entry would do nothing.
        icon,
        // Restated even when the switch is not on screen. A row moved off
        // `responses` hides the control, and leaving the column as it was would
        // keep a setting the user can no longer see or turn off.
        codexRequestShape: offersCodexRequestShape ? codexRequestShape : false,
      })
      // The row is written, so it is no longer unsaved even if the preference
      // below fails — that failure is reported, and only that field stays dirty.
      setSavedDraft({
        name,
        providerType,
        baseUrl,
        apiFormat,
        icon,
        codexRequestShape: offersCodexRequestShape ? codexRequestShape : false,
        localBackend,
      })
      // After the row, and only where the field was on screen: a save from a page
      // that never showed it must not clear somebody else's override. `null` is
      // the blank field, which means "back to the shipped default".
      if (offersCodexRequestShape && codexRequestShape) {
        await api.setPreference({
          key: 'codex.client_version',
          value: codexClientVersion.trim() || null,
        })
        setSavedCodexClientVersion(codexClientVersion.trim())
      }
    } catch (err) {
      // Unsaid, a refused save leaves the form exactly as it was and reads as a
      // button that did nothing.
      setSaveError(String(err))
      return
    } finally {
      setSaving(false)
    }
    markSaved()
    onUpdate()
  }, [
    saving,
    provider.id,
    name,
    providerType,
    baseUrl,
    apiFormat,
    icon,
    codexRequestShape,
    localBackend,
    codexClientVersion,
    offersCodexRequestShape,
    activeAuth,
    onUpdate,
    markSaved,
  ])

  const handleProviderTypeChange = useCallback(
    (raw: string) => {
      const next = requireProviderType(raw)
      const nextEntry = entryByType(catalog, next)
      const nextAuth =
        nextEntry?.auth.find((candidate) => candidate.credential_kind === provider.credential_kind) ??
        nextEntry?.auth[0]
      // The dialect a vendor is best reached on. Catalog order is editorial, so
      // the first one listed is the recommendation.
      const nextFormat = formatsFor(nextAuth)[0] ?? 'chat_completions'
      setProviderType(next)
      setLocalBackend(next === 'litert_lm' ? 'auto' : null)
      setBaseUrl((current) => {
        // Only replace an address the user never touched. Anything they typed —
        // a relay, a self-hosted endpoint — survives a change of vendor, which
        // is the same rule the catalog follows for existing rows.
        const oldDefault = defaultUrlFor(activeAuth, apiFormat)
        const replacement = defaultUrlFor(nextAuth, nextFormat)
        return !current || current === oldDefault ? (replacement ?? current) : current
      })
      setApiFormat(nextFormat)
    },
    [catalog, provider.credential_kind, activeAuth, apiFormat],
  )

  const handleApiFormatChange = useCallback(
    (raw: string) => {
      const next = parseProviderApiFormat(raw)
      // Used to be a Google-only branch. It is general now because the address
      // living per-dialect is just what the data says — for every other vendor
      // both dialects map to one address, so this is a no-op there.
      setBaseUrl((current) => {
        const oldDefault = defaultUrlFor(activeAuth, apiFormat)
        const replacement = defaultUrlFor(activeAuth, next)
        return !current || current === oldDefault ? (replacement ?? current) : current
      })
      setApiFormat(next)
    },
    [activeAuth, apiFormat],
  )

  // Switching the sign-in is written immediately rather than staged for Save:
  // what replaces the key field — the ChatGPT account card — reads the *row*,
  // so a staged switch would show a key box for a login that has none until
  // the user remembered to press Save.
  const handleAuthOptionChange = useCallback(
    async (nextId: string) => {
      const next = rowEntry?.auth.find((a) => a.id === nextId)
      if (!next || next.credential_kind === activeAuth?.credential_kind) return
      const nextFormat = next.api_formats.includes(apiFormat) ? apiFormat : (next.api_formats[0] ?? 'chat_completions')
      // Same replace-only-untouched rule as a change of vendor: the endpoint
      // belongs to the login, so an untouched address follows it.
      const oldDefault = defaultUrlFor(activeAuth, apiFormat)
      const nextUrl = !baseUrl || baseUrl === oldDefault ? (defaultUrlFor(next, nextFormat) ?? baseUrl) : baseUrl
      setApiFormat(nextFormat)
      setBaseUrl(nextUrl)
      try {
        setCredentialError(null)
        await api.updateProvider({
          id: provider.id,
          credentialKind: next.credential_kind,
          transportProfile: next.transport_profile,
          apiFormat: nextFormat,
          baseUrl: nextUrl,
        })
        setSavedDraft((current) => ({ ...current, apiFormat: nextFormat, baseUrl: nextUrl }))
        markSaved()
        onUpdate()
      } catch (err) {
        console.error('Failed to switch the sign-in method:', err)
        setCredentialError(String(err))
      }
    },
    [rowEntry?.auth, activeAuth, apiFormat, baseUrl, provider.id, markSaved, onUpdate],
  )

  const handleSaveKey = useCallback(async () => {
    if (!apiKey.trim()) return
    setSavingKey(true)
    setCredentialError(null)
    try {
      await api.setProviderKey({ providerId: provider.id, apiKey: apiKey.trim() })
      setKeyStatus('set')
      setApiKey('')
      markKeySaved()
    } catch (err) {
      console.error('Failed to save key:', err)
      setCredentialError(String(err))
    } finally {
      setSavingKey(false)
    }
  }, [provider.id, apiKey, markKeySaved])

  /**
   * Asked for, never polled.
   *
   * A balance is only worth anything while it is current, so there is nothing to
   * cache and nothing to refresh in the background — the button is the whole
   * feature. The alerting half is OneBot's, which is where somebody can actually
   * be told without looking.
   */
  const handleFetchBalance = useCallback(async () => {
    setFetchingBalance(true)
    setBalanceError(null)
    try {
      const result = await api.getProviderBalance(provider.id)
      setBalance(result)
      // The backend is the authority on which upstreams publish one, so a null
      // here means the list below has drifted from `supports_balance`.
      if (!result) setBalanceError(t('settings.provider.balanceUnsupported'))
    } catch (err) {
      console.error('Failed to read the balance:', err)
      // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- a read-only balance; the error is shown in its place
      setBalance(null)
      setBalanceError(String(err))
    } finally {
      setFetchingBalance(false)
    }
  }, [provider.id, t])

  const loadModelConfigs = useCallback(async () => {
    try {
      const configs = await api.listModelConfigs(provider.id)
      const map = new Map<string, ModelConfigInfoResponse>()
      for (const c of configs) map.set(c.model_id, c)
      setModelConfigs(map)
    } catch (err) {
      // One row failing the strict read is the whole list failing. Swallowed,
      // a save that succeeded leaves the screen unchanged and looks like it did
      // not.
      setModelsError(String(err))
    }
  }, [provider.id])

  const handleFetchModels = useCallback(async () => {
    setFetchingModels(true)
    setModelsError(null)
    try {
      const list = await api.fetchProviderModels({ providerId: provider.id, forceRefresh: true })
      setModels(list)
      setModelsKnown(true)
      await loadModelConfigs()
    } catch (err) {
      setModelsError(String(err))
    }
    setFetchingModels(false)
  }, [provider.id, loadModelConfigs])

  useEffect(() => {
    loadModelConfigs()
  }, [loadModelConfigs])

  // What the provider announced last time, read from the cache and nowhere
  // else. Opening this page is not a request to the provider: that used to
  // happen whenever the cache was empty, so merely looking at settings made a
  // network call — and, offline, showed a model-list error nobody asked for.
  // The fetch is the button that says so. An empty cache marks nothing as "not
  // in list": that would be a claim about an upstream this page never asked.
  useEffect(() => {
    let cancelled = false
    api
      .listCachedProviderModels({ providerId: provider.id })
      .then((list) => {
        if (cancelled) return
        setModels(list)
        setModelsKnown(list.length > 0)
      })
      .catch((err) => {
        if (!cancelled) setModelsError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [provider.id])

  // Coming back from a model page: it may have been given a price, pointed at
  // another description or deleted, and every one of those changes a chip in
  // the table below. This page has been mounted the whole time it was covered,
  // so nothing else would notice.
  useSettingsResume(loadModelConfigs)

  /**
   * A model the provider never announced.
   *
   * Nothing is written here: the id goes straight to its own page, which is
   * where a window and a price are given and where the row is created by the
   * ordinary save. Creating an empty configuration first would leave a model
   * in the list that no turn could run.
   */
  const handleAddModel = () => {
    const id = newModelId.trim()
    if (!id) return
    setAddingModel(false)
    setNewModelId('')
    onOpenModel(id)
  }

  const closeAddModel = useCallback(() => {
    setAddingModel(false)
    setNewModelId('')
  }, [])

  const requestCloseAddModel = useCallback(async () => {
    if (!newModelId.trim()) {
      closeAddModel()
      return
    }
    setConfirmingDiscard(true)
    const discard = await confirm({
      heading: t('sheet.discard.title'),
      description: t('sheet.discard.body'),
      confirmLabel: t('sheet.discard.confirm'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    setConfirmingDiscard(false)
    if (discard) closeAddModel()
  }, [newModelId, closeAddModel, confirm, t])

  useHistoryLevel(addingModel && !confirmingDiscard, () => {
    void requestCloseAddModel()
  })

  /**
   * What this provider announced, plus anything already configured on it.
   *
   * The two have deliberately never been joined in the database — one is a
   * fetch result, the other is what the user configured — and reading only the
   * first is what made a preview model impossible to configure at all: it is
   * absent from `/v1/models`, so it never appeared in a list, so it could
   * never be given a window or a price.
   */
  const listedIds = useMemo(() => new Set(models.map((model) => model.id)), [models])
  const allModels = useMemo<ModelRow[]>(() => {
    const extra = [...modelConfigs.values()]
      .filter((config) => !listedIds.has(config.model_id))
      .map((config) => ({ id: config.model_id, name: config.profile.name || config.model_id }))
    return [...models, ...extra]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((model) => ({
        id: model.id,
        name: model.name,
        config: modelConfigs.get(model.id),
        listed: modelsKnown ? listedIds.has(model.id) : null,
      }))
  }, [models, modelConfigs, listedIds, modelsKnown])

  const visibleModels = useMemo(() => {
    const query = modelFilter.trim().toLowerCase()
    if (!query) return allModels
    return allModels.filter(
      (model) => model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query),
    )
  }, [allModels, modelFilter])

  /**
   * What a row says without being opened.
   *
   * The window and the two base rates are why a table replaced a list of
   * names: comparing four relays selling the same model is the thing this page
   * is for, and a row that says only "Priced" makes it a tour of five pages.
   * The rates are the effective ones — a model priced by its profile carries
   * null on its own row — and the column header carries the unit, because the
   * stored figure names no currency and inventing one here would be a claim
   * the database does not make.
   */
  const modelColumns = useMemo<DataTableColumn<ModelRow>[]>(
    () => [
      {
        id: 'model',
        isRowHeader: true,
        header: t('settings.provider.modelColumn'),
        sortValue: (row) => row.name,
        cell: (row) => (
          <span data-slot="model-row-name" className="m-provider-page__model-name">
            <span
              data-slot="model-row-label"
              onPointerEnter={titleIfTruncated}
              className="m-provider-page__model-label"
            >
              {row.name}
            </span>
            {row.name !== row.id && (
              <span data-slot="model-row-id" onPointerEnter={titleIfTruncated} className="m-provider-page__model-id">
                {row.id}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'context',
        header: t('settings.provider.modelContextColumn'),
        align: 'end',
        width: 80,
        sortValue: (row) => row.config?.profile.context_window ?? null,
        cell: (row) => (
          <span className="m-provider-page__figure-value">
            {row.config
              ? formatTokenCount(row.config.profile.context_window, locale)
              : t('settings.provider.modelNoValue')}
          </span>
        ),
      },
      {
        id: 'input',
        header: t('settings.provider.modelInputColumn'),
        align: 'end',
        width: 80,
        cell: (row) => (
          <span className="m-provider-page__figure-value">
            {formatRate(row.config?.effective_pricing.input_price ?? null, locale, t)}
          </span>
        ),
      },
      {
        id: 'output',
        header: t('settings.provider.modelOutputColumn'),
        align: 'end',
        width: 80,
        cell: (row) => (
          <span className="m-provider-page__figure-value">
            {formatRate(row.config?.effective_pricing.output_price ?? null, locale, t)}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('settings.provider.modelStatusColumn'),
        align: 'end',
        width: 96,
        cell: (row) => <ModelStatus config={row.config} listed={row.listed} />,
      },
    ],
    [t, locale],
  )

  // Straight from the catalog, and not translated: these are brand names. The
  // i18n keys they replaced held the same strings in every locale, and a vendor
  // added to the catalog would have had no key at all — which is precisely the
  // per-vendor busywork this list is meant to stop needing.
  //
  // Until the catalog is loaded this is empty, so the current value is carried
  // as a lone option; without it the select would show blank and a save would
  // write it back.
  const typeOptions = typeSelectOptions(catalog, providerType)
  const formatOptions: { value: ProviderApiFormat; label: string }[] = [
    { value: 'responses', label: t('settings.provider.apiFormatResponses') },
    { value: 'chat_completions', label: t('settings.provider.apiFormatChatCompletions') },
    { value: 'gemma_tool', label: t('settings.provider.apiFormatGemmaTool') },
  ]
  const googleFormatOptions: { value: ProviderApiFormat; label: string }[] = [
    { value: 'gemini_generate_content', label: t('settings.provider.apiFormatGeminiGenerateContent') },
    { value: 'gemini_interactions', label: t('settings.provider.apiFormatGeminiInteractions') },
    { value: 'chat_completions', label: t('settings.provider.apiFormatOpenAICompatible') },
  ]
  const formatDescription =
    providerType === 'google'
      ? apiFormat === 'gemini_generate_content'
        ? t('settings.provider.apiFormatGeminiGenerateContentHint')
        : apiFormat === 'gemini_interactions'
          ? usesVertexServiceAccount(provider)
            ? t('settings.provider.apiFormatGeminiInteractionsServiceAccountHint')
            : t('settings.provider.apiFormatGeminiInteractionsHint')
          : t('settings.provider.apiFormatOpenAICompatibleHint')
      : undefined

  return (
    <div data-slot="provider-editor" className="m-provider-page">
      {/* What the row is and how it is reached, as rows in one card — the MCP
          server page's grammar. Each row's label is a `<p>`, so every control
          names itself through the ids the row hands it. */}
      <div data-slot="provider-identity">
        <SettingsGroup>
          <SettingsRow label={t('settings.provider.name')}>
            <TextField name={`providerName-${provider.id}`} value={name} onChange={(e) => setName(e)} />
          </SettingsRow>

          {/* Beside the name because it is the other half of "which row is
            this": a second Anthropic row for Vertex and a relay in front of
            OpenAI both draw the vendor's own mark, or a generic cloud, until
            somebody says otherwise. */}
          <SettingsRow label={t('settings.provider.icon')}>
            <ProviderIconPicker
              ariaLabel={t('settings.provider.icon')}
              value={icon}
              catalogId={provider.catalog_id}
              providerType={providerType}
              onChange={setIcon}
            />
          </SettingsRow>

          <SettingsRow label={t('settings.provider.type')}>
            <SettingsSelect
              ariaLabel={t('settings.provider.type')}
              value={providerType}
              options={typeOptions}
              onChange={handleProviderTypeChange}
              disabled={isRemote}
            />
          </SettingsRow>

          {/* Only where the vendor lists more than one way in. This is the one
            control that writes `credential_kind`, and without it a login could
            only be changed by editing the database by hand. */}
          {(rowEntry?.auth.length ?? 0) > 1 && (
            <SettingsRow
              label={t('settings.provider.authMethod')}
              description={usesChatGptLogin(provider) ? t('settings.provider.authMethodCodexHint') : undefined}
            >
              <SettingsSelect
                ariaLabel={t('settings.provider.authMethod')}
                value={activeAuth?.id ?? ''}
                options={(rowEntry?.auth ?? []).map((a) => ({
                  value: a.id,
                  label: t(authMethodLabel(a.credential_kind)),
                }))}
                onChange={handleAuthOptionChange}
                disabled={isRemote}
              />
            </SettingsRow>
          )}

          {activeAuth?.credential_kind === 'none' ? (
            <SettingsRow label={t('settings.provider.modelPath')} description={t('settings.provider.modelPathHint')}>
              <div data-slot="model-path-row" className="m-provider-page__field-row">
                <div className="m-provider-page__grow">
                  <TextField
                    name={`providerModelPath-${provider.id}`}
                    isDisabled={isRemote}
                    spellCheck="false"
                    value={baseUrl === 'local://' ? '' : baseUrl}
                    onChange={(e) => setBaseUrl(e)}
                    placeholder={t('settings.provider.modelPathPlaceholder')}
                  />
                </div>
                {!isRemote && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={async () => {
                      const file = await pickModelFile()
                      if (file) setBaseUrl(file)
                    }}
                  >
                    {t('settings.provider.browseModel')}
                  </Button>
                )}
              </div>
            </SettingsRow>
          ) : (
            <SettingsRow label={t('settings.provider.baseUrl')}>
              <div className="m-provider-page__grow">
                <TextField
                  name={`providerBaseUrl-${provider.id}`}
                  isDisabled={isRemote}
                  type="url"
                  inputMode="url"
                  spellCheck="false"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e)}
                  placeholder={
                    defaultUrlFor(activeAuth, apiFormat) ??
                    URL_PLACEHOLDERS[apiFormat] ??
                    URL_PLACEHOLDERS.chat_completions
                  }
                />
              </div>
            </SettingsRow>
          )}

          {/* One dialect means there is nothing to choose — which is what the old
            `SINGLE_FORMAT_TYPES` denylist said about Anthropic, now read off the
            data. While the catalog is loading nothing is known, so the selector
            stays hidden rather than offering a set that may be wrong. */}
          {formatsFor(activeAuth).length > 1 && (
            <SettingsRow label={t('settings.provider.apiFormat')} description={formatDescription}>
              <SettingsSelect
                ariaLabel={t('settings.provider.apiFormat')}
                value={apiFormat}
                options={
                  providerType === 'google'
                    ? googleFormatOptions.filter((option) => formatsFor(activeAuth).includes(option.value))
                    : formatOptions.filter((option) => formatsFor(activeAuth).includes(option.value))
                }
                onChange={handleApiFormatChange}
                disabled={isRemote}
              />
            </SettingsRow>
          )}

          {offersCodexRequestShape && (
            <SettingsRow
              label={t('settings.provider.codexRequestShape')}
              description={t('settings.provider.codexRequestShapeHint')}
            >
              <Switch isSelected={codexRequestShape} onChange={setCodexRequestShape} />
            </SettingsRow>
          )}
          {/* Only once the shape is on: an override for a version nothing is
            claiming reads as a setting that does nothing. The field itself is
            global — one install claims one Codex version — which the
            description says rather than the layout implying. */}
          {offersCodexRequestShape && codexRequestShape && (
            <SettingsRow
              label={t('settings.provider.codexClientVersion')}
              description={t('settings.provider.codexClientVersionHint')}
            >
              <TextField
                name="codexClientVersion"
                spellCheck="false"
                value={codexClientVersion}
                onChange={(e) => setCodexClientVersion(e)}
                placeholder={t('settings.provider.codexClientVersionPlaceholder')}
              />
            </SettingsRow>
          )}
          {providerType === 'litert_lm' && (
            <LocalModelSettings
              key={`${provider.id}:${baseUrl}:${localBackend}`}
              providerId={provider.id}
              modelPath={baseUrl}
              backend={localBackend}
              onBackendChange={setLocalBackend}
            />
          )}
        </SettingsGroup>
      </div>

      {/* Save writes the card above and nothing below it: the key has its own
          button, the models are their own pages. */}
      <div data-slot="provider-editor-actions" className="m-provider-page__actions">
        <Button size="sm" onPress={handleSave} isPending={saving}>
          {t('common.save')}
        </Button>
        {saved && <SavedHint />}
      </div>
      {saveError && (
        <Alert data-slot="provider-save-error" tone="danger" shouldAnnounce heading={t('settings.provider.saveError')}>
          {saveError}
        </Alert>
      )}

      {/* A sign-in that has no key must not be shown a key field: there is
          nothing to type, and an empty one reads as a step left undone. What
          replaces it is the account the session belongs to. */}
      {activeAuth?.credential_kind === 'none' ? null : usesChatGptLogin(provider) ? (
        <CodexAccount />
      ) : (
        <div data-slot="provider-credentials" className="m-provider-page__section">
          <SettingsGroup>
            <SettingsRow
              label={
                usesVertexServiceAccount(provider)
                  ? t('settings.provider.vertexServiceAccountJson')
                  : t('settings.provider.apiKey')
              }
            >
              <div data-slot="provider-api-key-row" className="m-provider-page__field-row">
                <div className="m-provider-page__grow">
                  {usesVertexServiceAccount(provider) ? (
                    <TextArea
                      name={`providerApiKey-${provider.id}`}
                      autoComplete="off"
                      rows={6}
                      value={apiKey}
                      onChange={setApiKey}
                      isDisabled={keyStatus === 'loading' || savingKey}
                      placeholder={
                        keyStatus === 'loading'
                          ? t('settings.provider.apiKeyChecking')
                          : keyStatus === 'set'
                            ? t('settings.provider.apiKeyPlaceholderSet')
                            : t('settings.provider.vertexServiceAccountPlaceholder')
                      }
                    />
                  ) : (
                    <PasswordField
                      name={`providerApiKey-${provider.id}`}
                      // A secret, not an account password; the library has no purpose for it yet (Yuerchu/ui#570).
                      autoComplete="current-password"
                      value={apiKey}
                      onChange={setApiKey}
                      isDisabled={keyStatus === 'loading' || savingKey}
                      placeholder={
                        keyStatus === 'loading'
                          ? t('settings.provider.apiKeyChecking')
                          : keyStatus === 'set'
                            ? t('settings.provider.apiKeyPlaceholderSet')
                            : t('settings.provider.apiKeyPlaceholder')
                      }
                    />
                  )}
                </div>
                <div className="m-provider-page__key-action">
                  <Button
                    icon={<Key />}
                    variant="secondary"
                    onPress={handleSaveKey}
                    isDisabled={!apiKey.trim() || keyStatus === 'loading'}
                    isPending={savingKey}
                  >
                    {keySaved ? t('common.saved') : t('settings.provider.saveKey')}
                  </Button>
                </div>
              </div>
            </SettingsRow>
          </SettingsGroup>
          {keyStatus === 'loading' && (
            <div data-slot="provider-key-checking" className="m-provider-page__note">
              <Spinner size="sm" />
              {t('settings.provider.apiKeyChecking')}
            </div>
          )}
          {keyStatus === 'set' && (
            <p data-slot="provider-key-saved" className="m-provider-page__note" data-tone="success">
              {t('settings.provider.keySaved')}
            </p>
          )}
          {keyStatus === 'error' && (
            <p data-slot="provider-key-check-failed" className="m-provider-page__note" data-tone="warning">
              {t('settings.provider.apiKeyCheckFailed')}
            </p>
          )}
          {credentialError && (
            <Alert data-slot="provider-credential-error" tone="danger" shouldAnnounce>
              {credentialError}
            </Alert>
          )}
        </div>
      )}

      {/* `provider::balance::supports_balance` remains the authority: asking a
          vendor that publishes nothing returns null and this form says so, so a
          drift shows up rather than hiding. This only keeps the button off the
          panels where it could never do anything. */}
      {balanceEntry(catalog, provider.catalog_id, providerType)?.balance === true && (
        <div data-slot="provider-balance" className="m-provider-page__section">
          <SettingsGroup>
            <SettingsRow label={t('settings.provider.balance')}>
              <Button
                size="sm"
                icon={<RefreshCw />}
                variant="secondary"
                onPress={handleFetchBalance}
                isDisabled={keyStatus !== 'set'}
                isPending={fetchingBalance}
              >
                {t('settings.provider.checkBalance')}
              </Button>
            </SettingsRow>
            {balance && (
              <div data-slot="provider-balance-card" className="m-provider-page__balance">
                {!balance.is_available && (
                  <p data-slot="provider-balance-unavailable" className="m-provider-page__note" data-tone="danger">
                    {t('settings.provider.balanceUnavailable')}
                  </p>
                )}
                {balance.accounts.map((account) => (
                  <div
                    key={account.currency}
                    data-slot="provider-balance-account"
                    className="m-provider-page__balance-account"
                  >
                    <span data-slot="provider-balance-total" className="m-provider-page__balance-total">
                      {formatBalance(account.total_balance, account.currency)}
                    </span>
                    {/* The split is the point: a total held up by expiring
                        promotional credit is closer to empty than it looks. */}
                    {account.topped_up_balance != null && account.granted_balance != null && (
                      <span data-slot="provider-balance-split" className="m-provider-page__muted">
                        {t('settings.provider.balanceSplit', {
                          toppedUp: formatDecimalAmount(account.topped_up_balance, locale, 2, 2),
                          granted: formatDecimalAmount(account.granted_balance, locale, 2, 2),
                        })}
                      </span>
                    )}
                  </div>
                ))}
                {balance.accounts.length === 0 && (
                  <p data-slot="provider-balance-no-detail" className="m-provider-page__muted">
                    {t('settings.provider.balanceNoDetail')}
                  </p>
                )}
              </div>
            )}
          </SettingsGroup>
          {balanceError && (
            <Alert data-slot="provider-balance-error" tone="danger" shouldAnnounce>
              {balanceError}
            </Alert>
          )}
        </div>
      )}

      {/* A section of its own, but not a `SettingsSection`: that wraps its
          children in a card, and the table is its own card already — a box
          inside a box is what the page grammar exists to stop. */}
      <div data-slot="provider-models" className="m-provider-page__section">
        {providerType === 'litert_lm' && (
          <p className="m-provider-page__note">{t('settings.localModel.aliasesHint')}</p>
        )}
        <div data-slot="provider-models-header" className="m-provider-page__models-header">
          <SettingsSectionLabel data-slot="provider-models-label" className="m-provider-page__models-label">
            {t('settings.provider.models')}
          </SettingsSectionLabel>
          <div data-slot="provider-models-actions" className="m-provider-page__models-actions">
            <Button size="sm" icon={<Plus />} variant="secondary" onPress={() => setAddingModel(true)}>
              {t('settings.provider.addModel')}
            </Button>
            {/* `keyStatus` is a proxy for "a request can be made", and it is only
                a valid one for rows whose credential lives in the secrets store.
                A ChatGPT login never has a stored key — the backend exempts it
                from needing one for exactly this call — so gating on the key
                here kept the button permanently grey on the rows the exemption
                was written for. */}
            <Button
              size="sm"
              icon={<RefreshCw />}
              variant="secondary"
              onPress={handleFetchModels}
              isDisabled={activeAuth?.credential_kind !== 'none' && !usesChatGptLogin(provider) && keyStatus !== 'set'}
              isPending={fetchingModels}
            >
              {t('settings.provider.fetchModels')}
            </Button>
          </div>
        </div>
        {modelsError && (
          <Alert data-slot="provider-models-error" tone="danger" shouldAnnounce>
            {modelsError}
          </Alert>
        )}
        {/* A filter rather than a scroller: a provider that answers with two
            hundred models is common, and a box inside a box is what the page
            grammar exists to stop. It is keyed to what there is to filter, not
            to what matched — gated on the matches, a query with none took the
            box away along with the text that could be corrected. */}
        {allModels.length > FILTER_THRESHOLD && (
          <TextField
            aria-label={t('settings.provider.filterModels')}
            name={`modelFilter-${provider.id}`}
            value={modelFilter}
            onChange={(event) => setModelFilter(event)}
            placeholder={t('settings.provider.filterModels')}
          />
        )}
        {allModels.length > 0 && visibleModels.length === 0 && (
          <p data-slot="provider-models-no-match" role="status" className="m-provider-page__note">
            {t('settings.provider.filterNoMatch')}
          </p>
        )}
        {visibleModels.length > 0 && (
          <div data-slot="provider-model-list" className="m-provider-page__model-list">
            {/* A row is still a way into the model's page — `onRowAction`
                rather than selection, for the reason the provider list gives:
                a selected row would keep a highlight on a page nobody is
                looking at. */}
            <DataTable<ModelRow>
              aria-label={t('settings.provider.models')}
              rows={visibleModels}
              columns={modelColumns}
              getRowId={(row) => row.id}
              onRowAction={(key) => typeof key === 'string' && onOpenModel(key)}
            />
          </div>
        )}
        <Drawer
          isOpen={addingModel}
          onOpenChange={(open) => {
            if (open) setAddingModel(true)
            else void requestCloseAddModel()
          }}
          side="bottom"
          size="sm"
          heading={t('settings.provider.addModel')}
          footer={
            <>
              <Button variant="secondary" onPress={() => void requestCloseAddModel()}>
                {t('common.cancel')}
              </Button>
              <Button isDisabled={!newModelId.trim()} onPress={handleAddModel}>
                {t('common.confirm')}
              </Button>
            </>
          }
        >
          <TextField
            label={t('settings.provider.modelId')}
            name={`newModelId-${provider.id}`}
            autoComplete="off"
            value={newModelId}
            onChange={setNewModelId}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && newModelId.trim()) handleAddModel()
            }}
            placeholder="gpt-6-preview"
            description={t('settings.provider.addModelHint')}
          />
        </Drawer>
        {allModels.length === 0 && !fetchingModels && !modelsError && (
          <p data-slot="provider-models-hint" className="m-provider-page__note">
            {t('settings.provider.fetchModelsHint')}
          </p>
        )}
      </div>

      {/* The profile page's closing card, as the MCP server page has it: a row
          saying what the action does, its button on the right. */}
      <div data-slot="provider-danger-zone" className="m-provider-page__section">
        <SettingsGroup>
          <SettingsRow
            label={t('settings.provider.deleteProvider')}
            description={t('settings.provider.deleteProviderHint')}
          >
            <Button size="sm" icon={<Bin />} variant="destructive" onPress={handleDelete} isPending={deleting}>
              {deleting ? t('settings.provider.deletingProvider') : t('common.delete')}
            </Button>
          </SettingsRow>
        </SettingsGroup>
        {deleteError && (
          <Alert data-slot="provider-delete-error" tone="danger" shouldAnnounce>
            {deleteError}
          </Alert>
        )}
      </div>
      {confirmDialog}
    </div>
  )
}

/**
 * One provider, fetched by id.
 *
 * By id rather than handed down, so coming back from a model page — or
 * reopening settings entirely — lands on the row as it is now rather than as
 * the list last saw it. There is no single-provider command, so this is the
 * list narrowed; adding one to save a round trip would be a new IPC surface for
 * a request that is already cheap.
 */
export function ProviderPage({
  providerId,
  onOpenModel,
  onDeleted,
}: {
  providerId: string
  onOpenModel: (modelId: string, apiFormat: string) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<ProviderInfoResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const list = await api.listProviders()
    setProvider(list.find((candidate) => candidate.id === providerId) ?? null)
  }, [providerId])

  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  if (loading) return <SettingsSkeleton />

  // Deleted in another window, or from a second client. The page says so rather
  // than rendering an editor over nothing.
  if (!provider) {
    return (
      <SettingsPage title={t('settings.provider.title')}>
        <Alert tone="warning" shouldAnnounce heading={t('settings.provider.selectProvider')} />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage title={provider.name}>
      <ProviderEditor
        key={provider.id}
        provider={provider}
        onUpdate={() => void refresh()}
        // The dialect goes with it: which provider-side tools a model has
        // depends on it, and the model page's capability lookup needs to be
        // redone when it changes.
        onOpenModel={(modelId) => onOpenModel(modelId, provider.api_format || 'chat_completions')}
        onDeleted={onDeleted}
      />
    </SettingsPage>
  )
}
