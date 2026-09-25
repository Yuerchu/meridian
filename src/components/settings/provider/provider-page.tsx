import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, Key, Plus, RefreshCw } from '@keyline-icons/react/two-tone'
import {
  Alert,
  Button,
  DataGrid,
  Description,
  Input,
  Label,
  Sheet,
  Spinner,
  Switch,
  TextField,
  type DataGridColumn,
} from '@/components/base'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { formatCurrencyAmount, formatDecimalAmount } from '@/lib/cost-format'
import {
  SavedHint,
  SETTINGS_ROW_SELECT_TRIGGER,
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
  SettingsSelect,
  SettingsSkeleton,
} from '../primitives'
import { SettingsPage } from '../settings-page'
import { useSettingsDraft, useSettingsResume } from '../settings-stack'
import { CodexAccount } from './codex-account'
import { ProviderIconPicker } from './icon-picker'
import {
  authFor,
  authMethodLabel,
  balanceEntry,
  defaultUrlFor,
  entryByType,
  entryForRow,
  formatsFor,
  parseProviderApiFormat,
  requireProviderType,
  URL_PLACEHOLDERS,
  useProviderCatalog,
  usesChatGptLogin,
} from './catalog'
import { isPriced } from './pricing'
import type {
  DecimalString,
  ModelConfigInfoResponse,
  ProviderInfoResponse,
  ProviderBalanceInfoResponse,
  ProviderApiFormat,
} from '@/types'

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
      <span data-slot="model-status-unconfigured" className="text-text-secondary">
        {t('settings.provider.modelNotConfigured')}
      </span>
    )
  }
  return (
    // Wraps rather than widening its column: "not in list" beside "priced" is
    // two lines in a fixed-layout table at the settings width.
    <span data-slot="model-status" className="inline-flex flex-wrap items-center justify-end gap-x-1.5">
      {listed === false && (
        <span data-slot="model-status-unlisted" className="text-text-secondary">
          {t('settings.provider.modelNotListed')}
        </span>
      )}
      {isPriced(config.effective_pricing) ? (
        <span
          data-slot="model-status-priced"
          className="inline-flex items-center gap-1.5 text-status-success-soft-foreground"
        >
          <span data-slot="model-status-dot" aria-hidden className="size-1.5 shrink-0 rounded-full bg-status-success" />
          {t('settings.provider.modelPriced')}
        </span>
      ) : (
        <span data-slot="model-status-unpriced" className="inline-flex items-center gap-1.5 text-status-warning">
          <span data-slot="model-status-dot" aria-hidden className="size-1.5 shrink-0 rounded-full bg-status-warning" />
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
    if (!(await confirm({ body: t('settings.confirmDelete.provider') }))) return
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
  }, [provider.id])

  // The vendor this row is, which is not the same question as which adapter
  // family it uses — three of them are `openai`.
  const rowEntry = entryForRow(catalog, provider.catalog_id, providerType)

  // The sign-in option the form is under right now: the row's stored kind
  // resolved against its vendor's entry. A type transition chooses a new login
  // explicitly in `handleProviderTypeChange`; persisted mismatches are rejected
  // here.
  const activeAuth = authFor(rowEntry, provider.credential_kind)

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
      await api.updateProvider({
        id: provider.id,
        name,
        providerType,
        baseUrl,
        apiFormat,
        credentialKind: activeAuth?.credential_kind,
        transportProfile: activeAuth?.transport_profile,
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
  const modelColumns = useMemo<DataGridColumn<ModelRow>[]>(
    () => [
      {
        id: 'model',
        isRowHeader: true,
        header: t('settings.provider.modelColumn'),
        cell: (row) => (
          <span data-slot="model-row-name" className="flex min-w-0 flex-col">
            <span data-slot="model-row-label" className="truncate text-body-regular text-text-primary">
              {row.name}
            </span>
            {row.name !== row.id && (
              <span data-slot="model-row-id" className="truncate text-caption-1-regular text-text-secondary">
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
        headerClassName: 'w-20',
        cellClassName: 'tabular-nums text-text-secondary',
        cell: (row) =>
          row.config
            ? formatTokenCount(row.config.profile.context_window, locale)
            : t('settings.provider.modelNoValue'),
      },
      {
        id: 'input',
        header: t('settings.provider.modelInputColumn'),
        align: 'end',
        headerClassName: 'w-20',
        cellClassName: 'tabular-nums text-text-secondary',
        cell: (row) => formatRate(row.config?.effective_pricing.input_price ?? null, locale, t),
      },
      {
        id: 'output',
        header: t('settings.provider.modelOutputColumn'),
        align: 'end',
        headerClassName: 'w-20',
        cellClassName: 'tabular-nums text-text-secondary',
        cell: (row) => formatRate(row.config?.effective_pricing.output_price ?? null, locale, t),
      },
      {
        id: 'status',
        header: t('settings.provider.modelStatusColumn'),
        align: 'end',
        headerClassName: 'w-24',
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
  const typeOptions =
    catalog.length > 0
      ? catalog.map((e) => ({ value: e.provider_type, label: e.name }))
      : [{ value: providerType, label: providerType }]
  const formatOptions: { value: ProviderApiFormat; label: string }[] = [
    { value: 'responses', label: t('settings.provider.apiFormatResponses') },
    { value: 'chat_completions', label: t('settings.provider.apiFormatChatCompletions') },
    { value: 'gemma_tool', label: t('settings.provider.apiFormatGemmaTool') },
  ]
  const googleFormatOptions: { value: ProviderApiFormat; label: string }[] = [
    { value: 'gemini_generate_content', label: t('settings.provider.apiFormatGeminiGenerateContent') },
    { value: 'chat_completions', label: t('settings.provider.apiFormatOpenAICompatible') },
  ]
  const formatDescription =
    providerType === 'google'
      ? apiFormat === 'gemini_generate_content'
        ? t('settings.provider.apiFormatGeminiGenerateContentHint')
        : t('settings.provider.apiFormatOpenAICompatibleHint')
      : undefined

  return (
    <div data-slot="provider-editor" className="flex flex-col gap-6">
      {/* What the row is and how it is reached, as rows in one card — the MCP
          server page's grammar. Each row's label is a `<p>`, so every control
          names itself through the ids the row hands it. */}
      <SettingsCard data-slot="provider-identity">
        <SettingsRow label={t('settings.provider.name')} stacked>
          {({ labelId }) => (
            <Input
              aria-labelledby={labelId}
              name={`providerName-${provider.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fieldClassName="w-full @sm/pane:w-64"
            />
          )}
        </SettingsRow>

        {/* Beside the name because it is the other half of "which row is
            this": a second Anthropic row for Vertex and a relay in front of
            OpenAI both draw the vendor's own mark, or a generic cloud, until
            somebody says otherwise. */}
        <SettingsRow label={t('settings.provider.icon')} data-slot="provider-icon-field">
          {({ labelId }) => (
            <ProviderIconPicker
              value={icon}
              catalogId={provider.catalog_id}
              providerType={providerType}
              onChange={setIcon}
              labelledBy={labelId}
            />
          )}
        </SettingsRow>

        <SettingsRow label={t('settings.provider.type')}>
          {({ labelId }) => (
            <SettingsSelect
              ariaLabelledBy={labelId}
              value={providerType}
              options={typeOptions}
              onChange={handleProviderTypeChange}
              triggerClassName={SETTINGS_ROW_SELECT_TRIGGER}
            />
          )}
        </SettingsRow>

        {/* Only where the vendor lists more than one way in — which is OpenAI
            today. This is the one control that writes `credential_kind`, and
            without it a ChatGPT-login row could only be made by editing the
            database by hand. */}
        {(rowEntry?.auth.length ?? 0) > 1 && (
          <SettingsRow
            label={t('settings.provider.authMethod')}
            description={usesChatGptLogin(provider) ? t('settings.provider.authMethodCodexHint') : undefined}
          >
            {({ labelId }) => (
              <SettingsSelect
                ariaLabelledBy={labelId}
                value={activeAuth?.id ?? ''}
                options={(rowEntry?.auth ?? []).map((a) => ({
                  value: a.id,
                  label: t(authMethodLabel(a.credential_kind)),
                }))}
                onChange={handleAuthOptionChange}
                triggerClassName={SETTINGS_ROW_SELECT_TRIGGER}
              />
            )}
          </SettingsRow>
        )}

        <SettingsRow
          label={t('settings.provider.baseUrl')}
          stacked
          className="@sm/pane:flex-col @sm/pane:items-stretch"
        >
          {({ labelId }) => (
            <Input
              aria-labelledby={labelId}
              name={`providerBaseUrl-${provider.id}`}
              type="url"
              inputMode="url"
              spellCheck={false}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                defaultUrlFor(activeAuth, apiFormat) ?? URL_PLACEHOLDERS[apiFormat] ?? URL_PLACEHOLDERS.chat_completions
              }
              fieldClassName="w-full"
            />
          )}
        </SettingsRow>

        {/* One dialect means there is nothing to choose — which is what the old
            `SINGLE_FORMAT_TYPES` denylist said about Anthropic, now read off the
            data. While the catalog is loading nothing is known, so the selector
            stays hidden rather than offering a set that may be wrong. */}
        {formatsFor(activeAuth).length > 1 && (
          <SettingsRow label={t('settings.provider.apiFormat')} description={formatDescription}>
            {({ labelId }) => (
              <SettingsSelect
                ariaLabelledBy={labelId}
                value={apiFormat}
                options={
                  providerType === 'google'
                    ? googleFormatOptions
                    : formatOptions.filter((option) => formatsFor(activeAuth).includes(option.value))
                }
                onChange={handleApiFormatChange}
                triggerClassName={SETTINGS_ROW_SELECT_TRIGGER}
              />
            )}
          </SettingsRow>
        )}

        {offersCodexRequestShape && (
          <SettingsRow
            label={t('settings.provider.codexRequestShape')}
            description={t('settings.provider.codexRequestShapeHint')}
            data-slot="provider-codex-request-shape"
          >
            {({ labelId, descriptionId }) => (
              <Switch
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                isSelected={codexRequestShape}
                onChange={setCodexRequestShape}
              />
            )}
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
            stacked
          >
            {({ labelId, descriptionId }) => (
              <Input
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                name="codexClientVersion"
                spellCheck={false}
                value={codexClientVersion}
                onChange={(e) => setCodexClientVersion(e.target.value)}
                placeholder={t('settings.provider.codexClientVersionPlaceholder')}
                fieldClassName="w-full @sm/pane:w-48"
              />
            )}
          </SettingsRow>
        )}
      </SettingsCard>

      {/* Save writes the card above and nothing below it: the key has its own
          button, the models are their own pages. */}
      <div data-slot="provider-editor-actions" className="flex items-center gap-2">
        <Button size="small" onPress={handleSave} isPending={saving}>
          {t('common.save')}
        </Button>
        {saved && <SavedHint />}
      </div>
      {saveError && (
        <Alert data-slot="provider-save-error" status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('settings.provider.saveError')}</Alert.Title>
            <Alert.Description className="break-all">{saveError}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/* A sign-in that has no key must not be shown a key field: there is
          nothing to type, and an empty one reads as a step left undone. What
          replaces it is the account the session belongs to. */}
      {usesChatGptLogin(provider) ? (
        <CodexAccount />
      ) : (
        <div data-slot="provider-credentials" className="flex flex-col gap-2">
          <SettingsCard>
            <SettingsRow
              label={t('settings.provider.apiKey')}
              stacked
              className="@sm/pane:flex-col @sm/pane:items-stretch"
            >
              {({ labelId }) => (
                <div data-slot="provider-api-key-row" className="flex w-full gap-2">
                  <Input
                    aria-labelledby={labelId}
                    type="password"
                    name={`providerApiKey-${provider.id}`}
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={keyStatus === 'loading' || savingKey}
                    placeholder={
                      keyStatus === 'loading'
                        ? t('settings.provider.apiKeyChecking')
                        : keyStatus === 'set'
                          ? t('settings.provider.apiKeyPlaceholderSet')
                          : t('settings.provider.apiKeyPlaceholder')
                    }
                    // The shell is what sits in this row (`className` reaches the
                    // inner <input>); without `flex-1 min-w-0` the row grew to the
                    // input's intrinsic width plus the button and ran off a phone.
                    fieldClassName="min-w-0 flex-1"
                  />
                  <Button
                    leadingIcon={Key}
                    variant="secondary"
                    className="shrink-0"
                    onPress={handleSaveKey}
                    isDisabled={!apiKey.trim() || keyStatus === 'loading'}
                    isPending={savingKey}
                  >
                    {keySaved ? t('common.saved') : t('settings.provider.saveKey')}
                  </Button>
                </div>
              )}
            </SettingsRow>
          </SettingsCard>
          {keyStatus === 'loading' && (
            <p
              data-slot="provider-key-checking"
              className="flex items-center gap-1.5 px-3 text-caption-1-regular text-text-secondary"
            >
              <Spinner size="sm" color="current" />
              {t('settings.provider.apiKeyChecking')}
            </p>
          )}
          {keyStatus === 'set' && (
            <p
              data-slot="provider-key-saved"
              className="px-3 text-caption-1-regular text-status-success-soft-foreground"
            >
              {t('settings.provider.keySaved')}
            </p>
          )}
          {keyStatus === 'error' && (
            <p
              data-slot="provider-key-check-failed"
              className="px-3 text-caption-1-regular text-status-warning-soft-foreground"
            >
              {t('settings.provider.apiKeyCheckFailed')}
            </p>
          )}
          {credentialError && (
            <p
              data-slot="provider-credential-error"
              role="alert"
              className="px-3 text-caption-1-regular text-status-danger break-all"
            >
              {credentialError}
            </p>
          )}
        </div>
      )}

      {/* `provider::balance::supports_balance` remains the authority: asking a
          vendor that publishes nothing returns null and this form says so, so a
          drift shows up rather than hiding. This only keeps the button off the
          panels where it could never do anything. */}
      {balanceEntry(catalog, provider.catalog_id, providerType)?.balance === true && (
        <div data-slot="provider-balance" className="flex flex-col gap-2">
          <SettingsCard>
            <SettingsRow label={t('settings.provider.balance')} data-slot="provider-balance-header">
              <Button
                size="small"
                leadingIcon={RefreshCw}
                variant="secondary"
                onPress={handleFetchBalance}
                isDisabled={keyStatus !== 'set'}
                isPending={fetchingBalance}
              >
                {t('settings.provider.checkBalance')}
              </Button>
            </SettingsRow>
            {balance && (
              <div data-slot="provider-balance-card" className="flex flex-col gap-1.5 py-2.5 pr-2.5">
                {!balance.is_available && (
                  <p data-slot="provider-balance-unavailable" className="text-caption-1-regular text-status-danger">
                    {t('settings.provider.balanceUnavailable')}
                  </p>
                )}
                {balance.accounts.map((account) => (
                  <div
                    key={account.currency}
                    data-slot="provider-balance-account"
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span data-slot="provider-balance-total" className="text-body-regular">
                      {formatBalance(account.total_balance, account.currency)}
                    </span>
                    {/* The split is the point: a total held up by expiring
                        promotional credit is closer to empty than it looks. */}
                    {account.topped_up_balance != null && account.granted_balance != null && (
                      <span data-slot="provider-balance-split" className="text-caption-1-regular text-text-secondary">
                        {t('settings.provider.balanceSplit', {
                          toppedUp: formatDecimalAmount(account.topped_up_balance, locale, 2, 2),
                          granted: formatDecimalAmount(account.granted_balance, locale, 2, 2),
                        })}
                      </span>
                    )}
                  </div>
                ))}
                {balance.accounts.length === 0 && (
                  <p data-slot="provider-balance-no-detail" className="text-caption-1-regular text-text-secondary">
                    {t('settings.provider.balanceNoDetail')}
                  </p>
                )}
              </div>
            )}
          </SettingsCard>
          {balanceError && (
            <p
              data-slot="provider-balance-error"
              role="alert"
              className="px-3 text-caption-1-regular text-status-danger break-all"
            >
              {balanceError}
            </p>
          )}
        </div>
      )}

      {/* A section of its own, but not a `SettingsSection`: that wraps its
          children in a card, and the table is its own card already — a box
          inside a box is what the page grammar exists to stop. */}
      <div data-slot="provider-models" className="flex w-full flex-col gap-2">
        <div data-slot="provider-models-header" className="flex items-center justify-between gap-2">
          <SettingsSectionLabel data-slot="provider-models-label" className="w-auto min-w-0 truncate">
            {t('settings.provider.models')}
          </SettingsSectionLabel>
          <div data-slot="provider-models-actions" className="flex shrink-0 items-center gap-1">
            <Button size="small" leadingIcon={Plus} variant="secondary" onPress={() => setAddingModel(true)}>
              {t('settings.provider.addModel')}
            </Button>
            {/* `keyStatus` is a proxy for "a request can be made", and it is only
                a valid one for rows whose credential lives in the secrets store.
                A ChatGPT login never has a stored key — the backend exempts it
                from needing one for exactly this call — so gating on the key
                here kept the button permanently grey on the rows the exemption
                was written for. */}
            <Button
              size="small"
              leadingIcon={RefreshCw}
              variant="secondary"
              onPress={handleFetchModels}
              isDisabled={!usesChatGptLogin(provider) && keyStatus !== 'set'}
              isPending={fetchingModels}
            >
              {t('settings.provider.fetchModels')}
            </Button>
          </div>
        </div>
        {modelsError && (
          <p
            data-slot="provider-models-error"
            role="alert"
            className="px-3 text-caption-1-regular text-status-danger break-all"
          >
            {modelsError}
          </p>
        )}
        {/* A filter rather than a scroller: a provider that answers with two
            hundred models is common, and a box inside a box is what the page
            grammar exists to stop. It is keyed to what there is to filter, not
            to what matched — gated on the matches, a query with none took the
            box away along with the text that could be corrected. */}
        {allModels.length > FILTER_THRESHOLD && (
          <Input
            aria-label={t('settings.provider.filterModels')}
            name={`modelFilter-${provider.id}`}
            value={modelFilter}
            onChange={(event) => setModelFilter(event.target.value)}
            placeholder={t('settings.provider.filterModels')}
          />
        )}
        {allModels.length > 0 && visibleModels.length === 0 && (
          <p
            data-slot="provider-models-no-match"
            role="status"
            className="px-3 text-caption-1-regular text-text-secondary"
          >
            {t('settings.provider.filterNoMatch')}
          </p>
        )}
        {visibleModels.length > 0 && (
          <div data-slot="provider-model-list">
            {/* A row is still a way into the model's page — `onRowAction`
                rather than selection, for the reason the provider list gives:
                a selected row would keep a highlight on a page nobody is
                looking at. Fixed layout, so the four figures keep the widths
                their headers give them and the model column takes the rest —
                about 200px at the settings width, where a long wire id
                truncates. Below 32rem (a phone) the table scrolls sideways
                inside its own card instead of each column collapsing to two
                characters. */}
            <DataGrid<ModelRow>
              aria-label={t('settings.provider.models')}
              items={visibleModels}
              columns={modelColumns}
              contentClassName="min-w-lg table-fixed"
              onRowAction={(key) => typeof key === 'string' && onOpenModel(key)}
            />
          </div>
        )}
        <Sheet
          isOpen={addingModel}
          onOpenChange={(open) => {
            setAddingModel(open)
            if (!open) setNewModelId('')
          }}
          placement="bottom"
          // Typed but unsubmitted is unsaved work: dragging the sheet away
          // would lose it silently, which is the one thing the drag must not do.
          isDirty={newModelId.trim().length > 0}
        >
          <Sheet.Backdrop>
            {/* The modal surface (`MODAL_SURFACE` is `background-full`), not the
              sheet's default `background-primary`: a field's tertiary well is the same
              neutral-800 as primary in dark, so on the default the field had no edge. */}
            <Sheet.Content className="mx-auto bg-background-full sm:max-w-lg sm:rounded-b-2xl">
              <Sheet.Dialog aria-label={t('settings.provider.addModel')} className="pb-[max(1rem,var(--safe-bottom))]">
                <Sheet.Handle />
                <Sheet.Header>
                  <Sheet.Heading>{t('settings.provider.addModel')}</Sheet.Heading>
                </Sheet.Header>
                <Sheet.Body className="space-y-2">
                  <TextField>
                    <Label>{t('settings.provider.modelId')}</Label>
                    <Input
                      name={`newModelId-${provider.id}`}
                      autoComplete="off"
                      value={newModelId}
                      onChange={(event) => setNewModelId(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return
                        if (event.key === 'Enter' && newModelId.trim()) handleAddModel()
                      }}
                      placeholder="gpt-6-preview"
                    />
                    <Description className="text-caption-1-regular">{t('settings.provider.addModelHint')}</Description>
                  </TextField>
                </Sheet.Body>
                <Sheet.Footer>
                  <Button slot="close" variant="secondary">
                    {t('common.cancel')}
                  </Button>
                  <Button isDisabled={!newModelId.trim()} onPress={handleAddModel}>
                    {t('common.confirm')}
                  </Button>
                </Sheet.Footer>
              </Sheet.Dialog>
            </Sheet.Content>
          </Sheet.Backdrop>
        </Sheet>
        {allModels.length === 0 && !fetchingModels && !modelsError && (
          <p data-slot="provider-models-hint" className="px-3 text-caption-1-regular text-text-secondary">
            {t('settings.provider.fetchModelsHint')}
          </p>
        )}
      </div>

      {/* The profile page's closing card, as the MCP server page has it: a row
          saying what the action does, its button on the right. */}
      <div data-slot="provider-danger-zone" className="flex flex-col gap-2">
        <SettingsCard>
          <SettingsRow
            label={t('settings.provider.deleteProvider')}
            description={t('settings.provider.deleteProviderHint')}
          >
            <Button size="small" leadingIcon={Bin} variant="danger" onPress={handleDelete} isPending={deleting}>
              {deleting ? t('settings.provider.deletingProvider') : t('common.delete')}
            </Button>
          </SettingsRow>
        </SettingsCard>
        {deleteError && (
          <p
            data-slot="provider-delete-error"
            role="alert"
            className="px-3 text-caption-1-regular text-status-danger break-all"
          >
            {deleteError}
          </p>
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
        <Alert status="warning" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('settings.provider.selectProvider')}</Alert.Title>
          </Alert.Content>
        </Alert>
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
