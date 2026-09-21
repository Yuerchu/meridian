import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowsRotateRight, Plus, TrashBin, Key } from '@gravity-ui/icons'
import { Alert, Button, Description, Input, Label, Sheet, Spinner, TextField } from '@/components/base'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { formatCurrencyAmount, formatDecimalAmount } from '@/lib/cost-format'
import { SavedHint, SettingsCard, SettingsNavRow, SettingsSelect, SettingsSkeleton } from '../primitives'
import { SettingsPage } from '../settings-page'
import { useSettingsDraft } from '../settings-stack'
import { CodexAccount } from './codex-account'
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

/**
 * Whether a model is configured, priced, and announced by this provider.
 *
 * The rates shown are the ones in force rather than the row's own: a model
 * priced by its profile — which is almost all of them — carries null on the row
 * and would otherwise be reported as having no price at all.
 */
function ModelStatus({ config, listed }: { config?: ModelConfigInfoResponse; listed: boolean }) {
  const { t } = useTranslation()
  if (!config) {
    return (
      <span data-slot="model-status-unconfigured" className="text-text-secondary">
        {t('settings.provider.modelNotConfigured')}
      </span>
    )
  }
  return (
    <span data-slot="model-status" className="inline-flex items-center gap-1.5">
      {!listed && (
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
  /// Unwinds the stack. The list refetches on the way back, so there is
  /// nothing to tell it.
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
  const [savedDraft, setSavedDraft] = useState(() => ({
    name: provider.name,
    providerType: provider.provider_type,
    baseUrl: provider.base_url,
    apiFormat: provider.api_format || 'chat_completions',
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
  const dirty =
    name !== savedDraft.name ||
    providerType !== savedDraft.providerType ||
    baseUrl !== savedDraft.baseUrl ||
    apiFormat !== savedDraft.apiFormat ||
    apiKey.trim().length > 0

  // Registered with the tab *and* with the page this is on: the shell refuses
  // to leave settings while it is dirty, and the stack refuses to pop this
  // page. One source id per provider, so two pages on the stack cannot answer
  // for each other.
  useSettingsDraft('provider', `provider:${provider.id}`, dirty)

  // Deletion clears secrets and cached models before the list reloads, so the
  // button has to stay disabled and say what it is doing — otherwise a slow
  // delete looks like a click that did not register, and a second click races
  // the first.
  const handleDelete = useCallback(async () => {
    if (!(await confirm({ body: t('settings.confirmDelete.provider') }))) return
    setDeleting(true)
    try {
      await api.deleteProvider(provider.id)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }, [confirm, t, onDeleted, provider.id])

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

  const handleSave = useCallback(async () => {
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
    })
    setSavedDraft({ name, providerType, baseUrl, apiFormat })
    markSaved()
    onUpdate()
  }, [provider.id, name, providerType, baseUrl, apiFormat, activeAuth, onUpdate, markSaved])

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
      await loadModelConfigs()
    } catch (err) {
      setModelsError(String(err))
    }
    setFetchingModels(false)
  }, [provider.id, loadModelConfigs])

  useEffect(() => {
    loadModelConfigs()
  }, [loadModelConfigs])

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
  const allModels = useMemo(() => {
    const extra = [...modelConfigs.values()]
      .filter((config) => !listedIds.has(config.model_id))
      .map((config) => ({ id: config.model_id, name: config.profile.name || config.model_id }))
    return [...models, ...extra].sort((a, b) => a.name.localeCompare(b.name))
  }, [models, modelConfigs, listedIds])

  const visibleModels = useMemo(() => {
    const query = modelFilter.trim().toLowerCase()
    if (!query) return allModels
    return allModels.filter(
      (model) => model.name.toLowerCase().includes(query) || model.id.toLowerCase().includes(query),
    )
  }, [allModels, modelFilter])

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
    <div data-slot="provider-editor" className="space-y-5">
      <TextField>
        <Label>{t('settings.provider.name')}</Label>
        <Input name={`providerName-${provider.id}`} value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>

      <SettingsSelect
        label={t('settings.provider.type')}
        value={providerType}
        options={typeOptions}
        onChange={handleProviderTypeChange}
      />

      {/* Only where the vendor lists more than one way in — which is OpenAI
          today. This is the one control that writes `credential_kind`, and
          without it a ChatGPT-login row could only be made by editing the
          database by hand. */}
      {(rowEntry?.auth.length ?? 0) > 1 && (
        <SettingsSelect
          label={t('settings.provider.authMethod')}
          value={activeAuth?.id ?? ''}
          options={(rowEntry?.auth ?? []).map((a) => ({
            value: a.id,
            label: t(authMethodLabel(a.credential_kind)),
          }))}
          onChange={handleAuthOptionChange}
          description={usesChatGptLogin(provider) ? t('settings.provider.authMethodCodexHint') : undefined}
        />
      )}

      <TextField type="url">
        <Label>{t('settings.provider.baseUrl')}</Label>
        <Input
          name={`providerBaseUrl-${provider.id}`}
          inputMode="url"
          spellCheck={false}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={
            defaultUrlFor(activeAuth, apiFormat) ?? URL_PLACEHOLDERS[apiFormat] ?? URL_PLACEHOLDERS.chat_completions
          }
        />
      </TextField>

      {/* One dialect means there is nothing to choose — which is what the old
          `SINGLE_FORMAT_TYPES` denylist said about Anthropic, now read off the
          data. While the catalog is loading nothing is known, so the selector
          stays hidden rather than offering a set that may be wrong. */}
      {formatsFor(activeAuth).length > 1 && (
        <SettingsSelect
          label={t('settings.provider.apiFormat')}
          value={apiFormat}
          options={
            providerType === 'google'
              ? googleFormatOptions
              : formatOptions.filter((option) => formatsFor(activeAuth).includes(option.value))
          }
          onChange={handleApiFormatChange}
          description={formatDescription}
        />
      )}

      <div data-slot="provider-editor-actions" className="flex items-center gap-2">
        <Button onPress={handleSave}>{t('common.save')}</Button>
        {saved && <SavedHint />}
      </div>

      {/* A sign-in that has no key must not be shown a key field: there is
          nothing to type, and an empty one reads as a step left undone. What
          replaces it is the account the session belongs to. */}
      {usesChatGptLogin(provider) ? (
        <CodexAccount />
      ) : (
        <div data-slot="provider-credentials" className="border-t border-border-button-default pt-4 space-y-3">
          <TextField type="password">
            <Label>{t('settings.provider.apiKey')}</Label>
            <div data-slot="provider-api-key-row" className="flex gap-2">
              <Input
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
                className="flex-1"
              />
              <Button
                variant="outline"
                onPress={handleSaveKey}
                isDisabled={!apiKey.trim() || keyStatus === 'loading'}
                isPending={savingKey}
              >
                <Key className="w-3.5 h-3.5" />
                {keySaved ? t('common.saved') : t('settings.provider.saveKey')}
              </Button>
            </div>
          </TextField>
          {keyStatus === 'loading' && (
            <p
              data-slot="provider-key-checking"
              className="flex items-center gap-1.5 text-caption-1-regular text-text-secondary"
            >
              <Spinner size="sm" color="current" />
              {t('settings.provider.apiKeyChecking')}
            </p>
          )}
          {keyStatus === 'set' && (
            <p data-slot="provider-key-saved" className="text-caption-1-regular text-status-success-soft-foreground">
              {t('settings.provider.keySaved')}
            </p>
          )}
          {keyStatus === 'error' && (
            <p
              data-slot="provider-key-check-failed"
              className="text-caption-1-regular text-status-warning-soft-foreground"
            >
              {t('settings.provider.apiKeyCheckFailed')}
            </p>
          )}
          {credentialError && (
            <p
              data-slot="provider-credential-error"
              role="alert"
              className="text-caption-1-regular text-status-danger break-all"
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
        <div data-slot="provider-balance" className="border-t border-border-button-default pt-4 space-y-3">
          <div data-slot="provider-balance-header" className="flex items-center justify-between">
            <p data-slot="provider-balance-label" className="text-caption-1-regular text-text-secondary">
              {t('settings.provider.balance')}
            </p>
            <Button
              variant="outline"
              onPress={handleFetchBalance}
              isDisabled={keyStatus !== 'set'}
              isPending={fetchingBalance}
            >
              <ArrowsRotateRight className="w-3.5 h-3.5" />
              {t('settings.provider.checkBalance')}
            </Button>
          </div>
          {balanceError && (
            <p
              data-slot="provider-balance-error"
              role="alert"
              className="text-caption-1-regular text-status-danger break-all"
            >
              {balanceError}
            </p>
          )}
          {balance && (
            <div
              data-slot="provider-balance-card"
              className="rounded-lg border border-border-button-default p-3 space-y-1.5"
            >
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
        </div>
      )}

      <div data-slot="provider-models" className="border-t border-border-button-default pt-4 space-y-3">
        <div data-slot="provider-models-header" className="flex items-center justify-between">
          <p data-slot="provider-models-label" className="text-caption-1-regular text-text-secondary">
            {t('settings.provider.models')}
          </p>
          {/* `keyStatus` is a proxy for "a request can be made", and it is only
              a valid one for rows whose credential lives in the secrets store.
              A ChatGPT login never has a stored key — the backend exempts it
              from needing one for exactly this call — so gating on the key
              here kept the button permanently grey on the rows the exemption
              was written for. */}
          <Button variant="ghost" onPress={() => setAddingModel(true)}>
            <Plus className="w-3.5 h-3.5" />
            {t('settings.provider.addModel')}
          </Button>
          <Button
            variant="outline"
            onPress={handleFetchModels}
            isDisabled={!usesChatGptLogin(provider) && keyStatus !== 'set'}
            isPending={fetchingModels}
          >
            <ArrowsRotateRight className="w-3.5 h-3.5" />
            {t('settings.provider.fetchModels')}
          </Button>
        </div>
        {modelsError && (
          <p
            data-slot="provider-models-error"
            role="alert"
            className="text-caption-1-regular text-status-danger break-all"
          >
            {modelsError}
          </p>
        )}
        {visibleModels.length > 0 && (
          <div data-slot="provider-model-list" className="space-y-2">
            {/* A filter rather than a scroller: a provider that answers with
                two hundred models is common, and a box inside a box is what
                the page grammar exists to stop. */}
            {models.length > FILTER_THRESHOLD && (
              <Input
                aria-label={t('settings.provider.filterModels')}
                name={`modelFilter-${provider.id}`}
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                placeholder={t('settings.provider.filterModels')}
              />
            )}
            <SettingsCard>
              {visibleModels.map((model) => {
                const config = modelConfigs.get(model.id)
                return (
                  <SettingsNavRow
                    key={model.id}
                    id={model.id}
                    data-key={model.id}
                    label={model.name}
                    className="rounded-none border-b border-separator-border last:border-b-0"
                    value={<ModelStatus config={config} listed={listedIds.has(model.id)} />}
                    onPress={() => onOpenModel(model.id)}
                  />
                )
              })}
            </SettingsCard>
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
            <Sheet.Content className="mx-auto sm:max-w-lg sm:rounded-b-2xl">
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
                  <Button slot="close" variant="tertiary">
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
          <p data-slot="provider-models-hint" className="text-caption-1-regular text-text-secondary">
            {t('settings.provider.fetchModelsHint')}
          </p>
        )}
      </div>

      <div data-slot="provider-danger-zone" className="border-t border-border-button-default pt-4">
        <Button variant="danger-soft" onPress={handleDelete} isPending={deleting}>
          <TrashBin className="w-3.5 h-3.5" />
          {deleting ? t('settings.provider.deletingProvider') : t('settings.provider.deleteProvider')}
        </Button>
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

  if (loading) return <SettingsSkeleton className="max-w-3xl" />

  // Deleted in another window, or from a second client. The page says so rather
  // than rendering an editor over nothing.
  if (!provider) {
    return (
      <SettingsPage title={t('settings.provider.title')} width="wide">
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
    <SettingsPage title={provider.name} width="wide">
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
