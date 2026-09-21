import { useEffect, useState, useCallback, useId, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ArrowsRotateRight, TrashBin, Cloud, Key, Sliders, Xmark } from '@gravity-ui/icons'
import {
  Alert,
  Button,
  Description,
  Disclosure,
  Input,
  Label,
  Spinner,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import { EmptyState } from '@/components/base'
import { DataGrid, type DataGridColumn } from '@/components/base'
import { ListView } from '@/components/base'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { ModelIcon } from '@/components/ui/model-icon'
import { formatCurrencyAmount, formatDecimalAmount } from '@/lib/cost-format'
import { assertDecimal38_18 } from '@/lib/decimal'
import { cx } from '@/utils/cx'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { MasterDetail } from '../master-detail'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from '../primitives'
import { useMasterDetail } from '../use-master-detail'
import { useSettingsDirtyRegistration } from '../dirty-guard'
import { EFFORT_LADDER } from '@/lib/thinking'
import {
  authFor,
  loadProviderCatalog,
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
import { safeThreshold, triFrom, triTo, type Tri } from './capabilities'
import { isPriced, optionalPrice, tiersFrom, tiersTo, type PriceField, type TierDraft } from './pricing'

import type {
  DecimalString,
  ModelConfigInfoResponse,
  ModelConfigUpsertRequest,
  PriceTier,
  ProviderInfoResponse,
  ProviderBalanceInfoResponse,
  ProviderCapabilityOverrides,
  ProviderCapabilitiesInfoResponse,
  ProviderModelInfoResponse,
  ProviderApiFormat,
  ServerToolKind,
  ThinkingEffort,
} from '@/types'

import { CodexAccount } from './codex-account'
import { PriceTierEditor } from './price-tier-editor'

function CapabilityTriRow({ label, value, onChange }: { label: string; value: Tri; onChange: (next: Tri) => void }) {
  const { t } = useTranslation()
  const options: Array<{ value: Tri; label: string }> = [
    { value: 'auto', label: t('settings.model.capAuto') },
    { value: 'on', label: t('settings.model.capOn') },
    { value: 'off', label: t('settings.model.capOff') },
  ]
  return (
    <div data-slot="capability-tri-row" className="flex items-center justify-between gap-2">
      <p data-slot="capability-tri-label" className="text-caption-1-regular text-text-secondary">
        {label}
      </p>
      <SettingsSelect
        ariaLabel={label}
        value={value}
        options={options}
        onChange={onChange}
        triggerClassName="h-7 w-32 text-caption-1-regular"
        itemClassName="text-caption-1-regular"
      />
    </div>
  )
}

function ModelConfigEditor({
  providerId,
  modelId,
  apiFormat,
  existing,
  onSave,
  onDelete,
  onDirtyChange,
}: {
  providerId: string
  modelId: string
  /** Not read directly — it is here so the capability lookup re-runs when the
   *  dialect changes, which is what decides whether this model has any
   *  provider-side tools at all. */
  apiFormat: string
  existing?: ModelConfigInfoResponse
  onSave: (input: ModelConfigUpsertRequest) => Promise<void>
  onDelete?: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const { t } = useTranslation()
  const [caps, setCaps] = useState<ProviderCapabilitiesInfoResponse | null>(null)

  useEffect(() => {
    api
      .getProviderCapabilities({ providerId, modelId })
      .then(setCaps)
      .catch(() => {})
  }, [providerId, modelId, apiFormat])

  // The window, the prices and the capability patch describe the *model*, so
  // they live on its profile and are shared by every provider reaching it.
  const profile = existing?.profile ?? null
  const defaultCtx = profile?.context_window ?? caps?.max_context_tokens ?? 128000
  const defaultMaxOut = profile?.max_output_tokens ?? caps?.max_output_tokens ?? null
  const defaultThreshold = profile?.compact_threshold ?? safeThreshold(defaultCtx, defaultMaxOut)

  const [contextWindow, setContextWindow] = useState(defaultCtx.toString())
  const [compactThreshold, setCompactThreshold] = useState(defaultThreshold.toString())
  const [maxOutput, setMaxOutput] = useState(defaultMaxOut?.toString() ?? '')
  const [inputPrice, setInputPrice] = useState(
    profile?.input_price == null ? '' : assertDecimal38_18(profile.input_price),
  )
  const [outputPrice, setOutputPrice] = useState(
    profile?.output_price == null ? '' : assertDecimal38_18(profile.output_price),
  )
  const [cachePrice, setCachePrice] = useState(
    profile?.cache_read_price == null ? '' : assertDecimal38_18(profile.cache_read_price),
  )
  const [cacheWritePrice, setCacheWritePrice] = useState(
    profile?.cache_write_price == null ? '' : assertDecimal38_18(profile.cache_write_price),
  )
  const [initialTiers] = useState(() => {
    try {
      return { values: tiersFrom(profile?.pricing_tiers ?? []), error: null as string | null }
    } catch (error) {
      return { values: [] as TierDraft[], error: error instanceof Error ? error.message : String(error) }
    }
  })
  const [tiers, setTiers] = useState<TierDraft[]>(initialTiers.values)
  const [serverTools, setServerTools] = useState<ServerToolKind[]>(() => existing?.server_tools ?? [])
  const [serverToolPrice, setServerToolPrice] = useState(
    existing?.server_tool_price == null ? '' : assertDecimal38_18(existing.server_tool_price),
  )
  // Open when there is something in it, so a tiered model does not look
  // single-priced until someone thinks to expand a collapsed section.
  const [showTiers, setShowTiers] = useState(tiers.length > 0)

  const [showCaps, setShowCaps] = useState(false)
  const [efforts, setEfforts] = useState<ThinkingEffort[]>([])
  // Tracks whether the whitelist was touched. Untouched means the key is left
  // out of the patch entirely, so the model keeps following catalog updates.
  // A ref, not state: it is only ever read back when the patch is built on
  // save, so flipping it has nothing to redraw.
  const effortsDirty = useRef(false)
  const [capThinking, setCapThinking] = useState<Tri>('auto')
  const [capFast, setCapFast] = useState<Tri>('auto')
  const [dirty, setDirty] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(initialTiers.error)
  // Which price boxes the last save attempt refused. The pair rule fails on a
  // field the reader may have scrolled past, so the box is marked and brought
  // into view rather than named only in a sentence under the button.
  const [invalidPrices, setInvalidPrices] = useState<ReadonlySet<PriceField>>(() => new Set())
  const priceRefs = {
    input: useRef<HTMLInputElement>(null),
    output: useRef<HTMLInputElement>(null),
    cache: useRef<HTMLInputElement>(null),
    cacheWrite: useRef<HTMLInputElement>(null),
    serverTool: useRef<HTMLInputElement>(null),
  } satisfies Record<PriceField, React.RefObject<HTMLInputElement | null>>

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  useEffect(() => {
    if (!existing && caps) {
      setContextWindow((caps.max_context_tokens ?? 128000).toString())
      setCompactThreshold(safeThreshold(caps.max_context_tokens ?? 128000, caps.max_output_tokens ?? null).toString())
      if (caps.max_output_tokens) setMaxOutput(caps.max_output_tokens.toString())
    }
  }, [caps, existing])

  // Seed the override editor from the *resolved* capabilities so the user edits
  // a diff of reality rather than a blank slate.
  useEffect(() => {
    if (!caps) return
    const saved = profile?.capability_overrides ?? {}
    setEfforts(EFFORT_LADDER.filter((e) => caps.supported_efforts.includes(e)))
    effortsDirty.current = saved.supported_efforts !== undefined
    setCapThinking(triFrom(saved.supports_thinking))
    setCapFast(triFrom(saved.supports_fast))
  }, [caps, existing])

  const buildOverrides = (): ProviderCapabilityOverrides | null => {
    const next: ProviderCapabilityOverrides = { ...(profile?.capability_overrides ?? {}) }
    if (effortsDirty.current) next.supported_efforts = efforts
    else delete next.supported_efforts
    const thinking = triTo(capThinking)
    if (thinking === undefined) delete next.supports_thinking
    else next.supports_thinking = thinking
    const fast = triTo(capFast)
    if (fast === undefined) delete next.supports_fast
    else next.supports_fast = fast
    return Object.keys(next).length > 0 ? next : null
  }

  const resetOverrides = () => {
    effortsDirty.current = false
    setCapThinking('auto')
    setCapFast('auto')
    if (caps) setEfforts(EFFORT_LADDER.filter((e) => caps.supported_efforts.includes(e)))
    setDirty(true)
  }

  const handleSave = async () => {
    const refuse = (message: string, fields: PriceField[]) => {
      setPriceError(message)
      setInvalidPrices(new Set(fields))
      const first = fields.map((field) => priceRefs[field].current).find((el) => el !== null)
      first?.scrollIntoView({ block: 'center' })
      first?.focus()
    }
    const labels: Record<PriceField, string> = {
      input: t('settings.model.inputPrice'),
      output: t('settings.model.outputPrice'),
      cache: t('settings.model.cachePrice'),
      cacheWrite: t('settings.model.cacheWritePrice'),
      serverTool: t('settings.model.serverToolPrice'),
    }
    const parsed: Partial<Record<PriceField, DecimalString | null>> = {}
    for (const [field, raw] of [
      ['input', inputPrice],
      ['output', outputPrice],
      ['cache', cachePrice],
      ['cacheWrite', cacheWritePrice],
      ['serverTool', serverToolPrice],
    ] as const) {
      try {
        parsed[field] = optionalPrice(raw)
      } catch {
        refuse(t('settings.model.priceInvalidError', { field: labels[field] }), [field])
        return
      }
    }
    const input = parsed.input ?? null
    const output = parsed.output ?? null
    if ((input == null) !== (output == null)) {
      refuse(t('settings.model.pricePairError'), [input == null ? 'input' : 'output'])
      return
    }
    let priceTiers: PriceTier[]
    try {
      priceTiers = tiersTo(tiers)
    } catch (error) {
      refuse(error instanceof Error ? error.message : String(error), [])
      return
    }
    if (priceTiers.length > 0 && input == null) {
      refuse(t('settings.model.tierNeedsBaseError'), ['input', 'output'])
      return
    }
    const prices = {
      input_price: input,
      output_price: output,
      cache_read_price: parsed.cache ?? null,
      cache_write_price: parsed.cacheWrite ?? null,
      pricing_tiers: priceTiers,
    }
    setPriceError(null)
    setInvalidPrices(new Set())
    try {
      await onSave({
        provider_id: providerId,
        model_id: modelId,
        profile: {
          // Editing in place. Pointing this model at a *different* profile —
          // which is how a second provider stops repeating the first — is the
          // model page's job, two commits from here.
          id: profile?.id ?? null,
          name: profile?.name ?? modelId,
          context_window: parseInt(contextWindow) || 128000,
          compact_threshold: parseInt(compactThreshold) || 100000,
          max_output_tokens: maxOutput ? parseInt(maxOutput) : null,
          ...prices,
          capability_overrides: buildOverrides(),
        },
        // No per-provider override yet: this form edits one door to a model and
        // has nowhere to say "this relay charges its own rates".
        overrides_pricing: false,
        input_price: null,
        output_price: null,
        cache_read_price: null,
        cache_write_price: null,
        pricing_tiers: [],
        server_tool_price: parsed.serverTool ?? null,
        // What the user asked for, not what is currently supported. Filtering here
        // against `caps` looked like defence and was a way to lose the setting:
        // capabilities load asynchronously, so a save while that request was still
        // in flight — or after it failed — silently wrote an empty list over a
        // switch the user had just turned on. The narrowing that matters happens
        // per turn in `resolve_turn_params`, where the model's support is known
        // for certain and a stale name costs nothing.
        server_tools: serverTools.length > 0 ? serverTools : null,
      })
    } catch (error) {
      // The backend refuses for reasons the form cannot see — a plan review
      // holding the model, a conversation set that moved mid-save. Unsaid, the
      // editor stays open with nothing changed and reads as a dead button.
      setPriceError(error instanceof Error ? error.message : String(error))
      return
    }
    setDirty(false)
  }

  return (
    // Every control in here overrides the default height down to 28px, which
    // is a deliberate density for a form of this many fields and a pointer.
    // The coarse-pointer variants put the extra height back where a finger is
    // doing the aiming and leave the desktop exactly as it was.
    <div data-slot="model-config-editor" className="px-3 pb-3 space-y-2 bg-background-secondary-default/30">
      <div data-slot="model-config-limits" className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-2">
        <TextField>
          <Label>{t('settings.model.contextWindow')}</Label>
          <Input
            name={`modelContextWindow-${modelId}`}
            inputMode="numeric"
            value={contextWindow}
            onChange={(e) => {
              setContextWindow(e.target.value)
              setDirty(true)
            }}
            className="h-7 pointer-coarse:h-10 text-caption-1-regular"
          />
        </TextField>
        <TextField>
          <Label>{t('settings.model.compactThreshold')}</Label>
          <Input
            name={`modelCompactThreshold-${modelId}`}
            inputMode="numeric"
            value={compactThreshold}
            onChange={(e) => {
              setCompactThreshold(e.target.value)
              setDirty(true)
            }}
            className="h-7 pointer-coarse:h-10 text-caption-1-regular"
          />
        </TextField>
      </div>
      <TextField>
        <Label>{t('settings.model.maxOutput')}</Label>
        <Input
          name={`modelMaxOutput-${modelId}`}
          inputMode="numeric"
          value={maxOutput}
          onChange={(e) => {
            setMaxOutput(e.target.value)
            setDirty(true)
          }}
          placeholder={t('settings.model.optional')}
          className="h-7 pointer-coarse:h-10 text-caption-1-regular"
        />
      </TextField>
      {/* Four rates, all per million tokens. The two cache boxes are blank by
          default and blank means "priced like input" — which is what every
          provider but Anthropic does, and what the usage report bills them at. */}
      <div data-slot="model-config-prices" className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-2">
        <TextField isInvalid={invalidPrices.has('input')}>
          <Label>{t('settings.model.inputPrice')}</Label>
          <Input
            ref={priceRefs.input}
            name={`modelInputPrice-${modelId}`}
            inputMode="decimal"
            value={inputPrice}
            onChange={(e) => {
              setInputPrice(e.target.value)
              setDirty(true)
            }}
            className="h-7 pointer-coarse:h-10 text-caption-1-regular"
          />
        </TextField>
        <TextField isInvalid={invalidPrices.has('output')}>
          <Label>{t('settings.model.outputPrice')}</Label>
          <Input
            ref={priceRefs.output}
            name={`modelOutputPrice-${modelId}`}
            inputMode="decimal"
            value={outputPrice}
            onChange={(e) => {
              setOutputPrice(e.target.value)
              setDirty(true)
            }}
            className="h-7 pointer-coarse:h-10 text-caption-1-regular"
          />
        </TextField>
        <TextField isInvalid={invalidPrices.has('cache')}>
          <Label>{t('settings.model.cachePrice')}</Label>
          <Input
            ref={priceRefs.cache}
            name={`modelCachePrice-${modelId}`}
            inputMode="decimal"
            value={cachePrice}
            onChange={(e) => {
              setCachePrice(e.target.value)
              setDirty(true)
            }}
            placeholder="—"
            className="h-7 pointer-coarse:h-10 text-caption-1-regular"
          />
          <Description className="text-caption-1-regular">{t('settings.model.cachePriceHint')}</Description>
        </TextField>
        <TextField isInvalid={invalidPrices.has('cacheWrite')}>
          <Label>{t('settings.model.cacheWritePrice')}</Label>
          <Input
            ref={priceRefs.cacheWrite}
            name={`modelCacheWritePrice-${modelId}`}
            inputMode="decimal"
            value={cacheWritePrice}
            onChange={(e) => {
              setCacheWritePrice(e.target.value)
              setDirty(true)
            }}
            placeholder="—"
            className="h-7 pointer-coarse:h-10 text-caption-1-regular"
          />
          <Description className="text-caption-1-regular">{t('settings.model.cacheWritePriceHint')}</Description>
        </TextField>
      </div>
      {/* Only where the model has any. Elsewhere this is not a switch that is
          off, it is a thing that does not exist — and an empty section reads as
          a feature that failed to load. */}
      {(caps?.server_tools?.length ?? 0) > 0 && (
        <div data-slot="server-tools" className="space-y-1.5 pt-1">
          <p data-slot="server-tools-label" className="text-caption-1-regular text-text-secondary">
            {t('settings.model.serverTools')}
          </p>
          <div data-slot="server-tool-chips" className="flex flex-wrap gap-1">
            {caps?.server_tools?.map((name) => {
              const on = serverTools.includes(name)
              return (
                <Button
                  key={name}
                  data-slot="server-tool-chip"
                  variant={on ? 'primary' : 'outline'}
                  size="small"
                  aria-pressed={on}
                  className="h-6 pointer-coarse:h-9 rounded-md px-2 text-caption-1-regular"
                  onPress={() => {
                    setServerTools(on ? serverTools.filter((x) => x !== name) : [...serverTools, name])
                    setDirty(true)
                  }}
                >
                  {t(`settings.model.serverTool.${name}`, name)}
                </Button>
              )
            })}
          </div>
          <TextField isInvalid={invalidPrices.has('serverTool')}>
            <Label>{t('settings.model.serverToolPrice')}</Label>
            <Input
              ref={priceRefs.serverTool}
              name={`modelServerToolPrice-${modelId}`}
              inputMode="decimal"
              value={serverToolPrice}
              onChange={(e) => {
                setServerToolPrice(e.target.value)
                setDirty(true)
              }}
              placeholder="5"
              className="h-7 pointer-coarse:h-10 text-caption-1-regular"
            />
            <Description className="text-caption-1-regular">{t('settings.model.serverToolPriceHint')}</Description>
          </TextField>
          <p data-slot="server-tools-hint" className="text-caption-1-regular text-text-secondary">
            {t('settings.model.serverToolsHint')}
          </p>
        </div>
      )}
      <Disclosure
        data-slot="price-tier-section"
        className="pt-1"
        isExpanded={showTiers}
        onExpandedChange={setShowTiers}
      >
        <Disclosure.Heading>
          <Disclosure.Trigger className="inline-flex items-center gap-1 rounded-md text-caption-1-regular text-text-secondary transition-colors outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring/50">
            {tiers.length > 0
              ? t('settings.model.priceTiersCount', { count: tiers.length })
              : t('settings.model.priceTiers')}
            <Disclosure.Indicator className="size-3.5" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content className="min-h-0 w-full">
          <Disclosure.Body className="pt-1">
            <PriceTierEditor
              tiers={tiers}
              onChange={(next) => {
                setTiers(next)
                setDirty(true)
              }}
            />
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
      <Disclosure
        data-slot="capability-overrides"
        className="pt-1"
        isExpanded={showCaps}
        onExpandedChange={setShowCaps}
      >
        <Disclosure.Heading>
          {/* `inline-flex`, not `flex`: a block-level flex row would stretch the
              trigger across the form and the indicator's own `ms-auto` would
              fling the chevron to the far edge. */}
          <Disclosure.Trigger className="inline-flex items-center gap-1 rounded-md text-caption-1-regular text-text-secondary transition-colors outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring/50">
            {t('settings.model.capabilities')}
            <Disclosure.Indicator className="size-3.5" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content className="min-h-0 w-full">
          {/* Body, not a plain wrapper: it is what keeps the panel measurable,
              so without it the overrides never collapse. */}
          <Disclosure.Body className="space-y-2">
            <div data-slot="effort-whitelist" className="space-y-1.5">
              <p data-slot="effort-whitelist-label" className="text-caption-1-regular text-text-secondary">
                {t('settings.model.supportedEfforts')}
              </p>
              <div data-slot="effort-chips" className="flex flex-wrap gap-1">
                {EFFORT_LADDER.map((tier) => {
                  const on = efforts.includes(tier)
                  return (
                    <Button
                      key={tier}
                      data-slot="effort-chip"
                      variant={on ? 'primary' : 'outline'}
                      size="small"
                      aria-pressed={on}
                      className="h-6 pointer-coarse:h-9 px-2 text-caption-1-regular"
                      onPress={() => {
                        // Rebuild from the ladder so the stored array stays in
                        // ascending order -- the median coercion ranks on position.
                        setEfforts(EFFORT_LADDER.filter((x) => (x === tier ? !on : efforts.includes(x))))
                        effortsDirty.current = true
                        setDirty(true)
                      }}
                    >
                      {t(`toolbar.thinking.${tier}`)}
                    </Button>
                  )
                })}
              </div>
            </div>
            <CapabilityTriRow
              label={t('settings.model.capThinking')}
              value={capThinking}
              onChange={(value) => {
                setCapThinking(value)
                setDirty(true)
              }}
            />
            <CapabilityTriRow
              label={t('settings.model.capFast')}
              value={capFast}
              onChange={(value) => {
                setCapFast(value)
                setDirty(true)
              }}
            />
            <p data-slot="capabilities-hint" className="text-caption-1-regular text-text-secondary">
              {t('settings.model.capabilitiesHint')}
            </p>
            <Button
              variant="ghost"
              size="small"
              className="h-6 pointer-coarse:h-9 px-0 text-caption-1-regular text-text-secondary hover:text-text-primary"
              onPress={resetOverrides}
            >
              {t('settings.model.capReset')}
            </Button>
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
      {priceError && (
        <p data-slot="model-config-error" role="alert" className="text-caption-1-regular text-status-danger">
          {priceError}
        </p>
      )}
      <div data-slot="model-config-actions" className="flex items-center gap-2 pt-1">
        <Button
          size="small"
          className="h-7 pointer-coarse:h-10 text-caption-1-regular"
          onPress={() => void handleSave()}
        >
          {t('common.save')}
        </Button>
        {onDelete && (
          <Button
            size="small"
            variant="danger-soft"
            className="h-7 pointer-coarse:h-10 text-caption-1-regular"
            onPress={onDelete}
          >
            {t('common.delete')}
          </Button>
        )}
      </div>
    </div>
  )
}

function ProviderEditor({
  provider,
  onUpdate,
  onDelete,
  onDirtyChange,
}: {
  provider: ProviderInfoResponse
  onUpdate: () => void
  /// Awaited so the button can show progress until the list has reloaded.
  onDelete: (id: string) => Promise<void>
  onDirtyChange?: (id: string, dirty: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const modelEditorId = useId()
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
  const [models, setModels] = useState<ProviderModelInfoResponse[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [balance, setBalance] = useState<ProviderBalanceInfoResponse | null>(null)
  const [fetchingBalance, setFetchingBalance] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [modelConfigs, setModelConfigs] = useState<Map<string, ModelConfigInfoResponse>>(new Map())
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [modelConfigDirty, setModelConfigDirty] = useState(false)
  const dirty =
    name !== savedDraft.name ||
    providerType !== savedDraft.providerType ||
    baseUrl !== savedDraft.baseUrl ||
    apiFormat !== savedDraft.apiFormat ||
    apiKey.trim().length > 0 ||
    modelConfigDirty

  useEffect(() => onDirtyChange?.(provider.id, dirty), [dirty, onDirtyChange, provider.id])
  useEffect(() => () => onDirtyChange?.(provider.id, false), [onDirtyChange, provider.id])

  // Deletion clears secrets and cached models before the list reloads, so the
  // button has to stay disabled and say what it is doing — otherwise a slow
  // delete looks like a click that did not register, and a second click races
  // the first.
  const handleDelete = useCallback(async () => {
    if (!(await confirm({ body: t('settings.confirmDelete.provider') }))) return
    setDeleting(true)
    try {
      await onDelete(provider.id)
    } finally {
      setDeleting(false)
    }
  }, [confirm, t, onDelete, provider.id])

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

  const handleSaveModelConfig = useCallback(
    async (input: ModelConfigUpsertRequest) => {
      await api.saveModelConfig(input)
      await loadModelConfigs()
      setEditingModelId(null)
    },
    [loadModelConfigs],
  )

  const handleDeleteModelConfig = useCallback(
    async (id: string) => {
      if (!(await confirm({ body: t('settings.confirmDelete.modelConfig') }))) return
      try {
        await api.deleteModelConfig(id)
      } catch (err) {
        setModelsError(String(err))
        return
      }
      await loadModelConfigs()
      setEditingModelId(null)
    },
    [confirm, t, loadModelConfigs],
  )

  const changeEditingModel = useCallback(
    async (nextId: string | null) => {
      if (modelConfigDirty && !(await confirm({ body: t('settings.unsavedChanges'), status: 'warning' }))) return
      setModelConfigDirty(false)
      setEditingModelId(nextId)
    },
    [confirm, modelConfigDirty, t],
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

  const modelColumns = useMemo<DataGridColumn<ProviderModelInfoResponse>[]>(
    () => [
      {
        id: 'model',
        header: t('settings.provider.modelColumn'),
        isRowHeader: true,
        minWidth: 176,
        cellClassName: 'text-caption-1-regular',
        cell: (model) => (
          <span
            data-slot="model-name"
            className={cx('block truncate', modelConfigs.has(model.id) ? 'text-text-primary' : 'text-text-secondary')}
          >
            {model.name}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('settings.provider.modelStatusColumn'),
        width: 112,
        minWidth: 112,
        headerClassName: 'whitespace-nowrap',
        cellClassName: 'text-caption-1-regular',
        cell: (model) => {
          const config = modelConfigs.get(model.id)
          if (!config)
            return (
              <span data-slot="model-status-unconfigured" className="text-text-secondary">
                {t('settings.provider.modelNotConfigured')}
              </span>
            )
          // The rates in force, not the row's own: a model priced by its
          // profile — which is almost all of them — carries null here and
          // would otherwise be reported as having no price at all.
          const priced = config.effective_pricing
          return isPriced(priced) ? (
            <span
              data-slot="model-status-priced"
              className="inline-flex items-center gap-1.5 text-status-success-soft-foreground"
            >
              <span
                data-slot="model-status-dot"
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-status-success"
              />
              {t('settings.provider.modelPriced')}
            </span>
          ) : (
            <span data-slot="model-status-unpriced" className="inline-flex items-center gap-1.5 text-status-warning">
              <span
                data-slot="model-status-dot"
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-status-warning"
              />
              {t('settings.provider.modelPriceMissing')}
            </span>
          )
        },
      },
      {
        id: 'actions',
        header: t('settings.provider.modelActionsColumn'),
        align: 'end',
        width: 72,
        minWidth: 72,
        pinned: 'end',
        headerClassName: 'whitespace-nowrap',
        cell: (model) => {
          const isEditing = editingModelId === model.id
          const label = isEditing
            ? t('settings.provider.closeModelConfig', { model: model.name })
            : t('settings.provider.editModelConfig', { model: model.name })
          return (
            <TooltipTrigger delay={0}>
              <Button
                iconOnly
                variant="ghost"
                aria-label={label}
                aria-controls={isEditing ? modelEditorId : undefined}
                aria-expanded={isEditing}
                className="touch-hitbox h-6 w-6"
                onPress={() => void changeEditingModel(isEditing ? null : model.id)}
              >
                {isEditing ? <Xmark className="size-3.5" /> : <Sliders className="size-3.5" />}
              </Button>
              <Tooltip placement="top">{label}</Tooltip>
            </TooltipTrigger>
          )
        },
      },
    ],
    [changeEditingModel, editingModelId, modelConfigs, modelEditorId, t],
  )

  const editingModel = editingModelId == null ? undefined : models.find((model) => model.id === editingModelId)
  const editingModelConfig = editingModel == null ? undefined : modelConfigs.get(editingModel.id)

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
        {models.length > 0 && (
          <div data-slot="provider-model-list" className="space-y-2">
            <DataGrid<ProviderModelInfoResponse>
              aria-label={t('settings.provider.models')}
              variant="secondary"
              columns={modelColumns}
              data={models}
              getRowId={(model) => model.id}
              contentClassName="min-w-96"
              scrollContainerClassName="max-h-60 overflow-y-auto overscroll-contain"
            />
            {editingModel && (
              <div
                data-slot="model-config-panel"
                id={modelEditorId}
                className="max-h-96 overflow-y-auto overscroll-contain rounded-lg border border-border-button-default pt-3"
              >
                <h4 data-slot="model-config-panel-title" className="px-3 pb-3 text-caption-1-medium">
                  {t('settings.provider.editModelConfig', { model: editingModel.name })}
                </h4>
                <ModelConfigEditor
                  key={editingModel.id}
                  providerId={provider.id}
                  modelId={editingModel.id}
                  // Which provider-side tools exist depends on the dialect,
                  // so the capability lookup has to be redone when it
                  // changes — otherwise switching to Responses leaves the
                  // panel insisting this model has none.
                  apiFormat={apiFormat}
                  existing={editingModelConfig}
                  onSave={handleSaveModelConfig}
                  onDelete={editingModelConfig ? () => handleDeleteModelConfig(editingModelConfig.id) : undefined}
                  onDirtyChange={setModelConfigDirty}
                />
              </div>
            )}
          </div>
        )}
        {models.length === 0 && !fetchingModels && !modelsError && (
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

export function ProviderSettings() {
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const [dirtyProviderId, setDirtyProviderId] = useState<string | null>(null)
  const requestLeave = useCallback(async () => {
    if (!dirtyProviderId) return true
    return confirm({ body: t('settings.unsavedChanges'), status: 'warning' })
  }, [confirm, dirtyProviderId, t])
  useSettingsDirtyRegistration('provider', 'provider-editor', dirtyProviderId !== null)
  const nav = useMasterDetail({ beforeLeave: requestLeave })
  const { isNarrow, selectedId } = nav
  const [providers, setProviders] = useState<ProviderInfoResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const initialized = useRef(false)

  const refresh = useCallback(async () => {
    const list = await api.listProviders()
    setProviders(list)
    return list
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void refresh()
      .catch((reason) => setLoadError(String(reason)))
      .finally(() => setLoading(false))
  }, [refresh])

  // Derived rather than decided inside the fetch above: the width is measured,
  // so at the moment the request was sent it may still have been answering from
  // the viewport. Written there, it also never ran again — a list loaded on a
  // phone and then widened left the second column empty for good.
  //
  // Not while narrow: the list is the whole screen there, and opening the first
  // provider over it hides the others behind a back button nobody asked for.
  useEffect(() => {
    if (loading || isNarrow || selectedId !== null || providers.length === 0) return
    nav.select(providers[0].id)
  }, [loading, isNarrow, selectedId, providers, nav])

  // A new row starts as the first vendor in the catalog, prefilled from it and
  // stamped with which vendor it is. The hardcoded OpenAI defaults that used to
  // be here are now just what the catalog's first entry says.
  //
  // `catalogId` is passed even though the backend could infer it from the URL:
  // the user picking a vendor is a statement, and it must survive them editing
  // the address afterwards — which inference cannot do.
  const handleCreate = useCallback(async () => {
    if (!(await requestLeave())) return
    const entry = (await loadProviderCatalog())[0]
    const auth = entry?.auth[0]
    const format = auth?.api_formats[0] ?? 'chat_completions'
    const p = await api.createProvider({
      name: entry?.name ?? 'New Provider',
      providerType: entry?.provider_type ?? 'openai',
      baseUrl: defaultUrlFor(auth, format) ?? '',
      apiFormat: format,
      catalogId: entry?.id ?? null,
      authOption: auth?.id ?? null,
    })
    await refresh()
    nav.select(p.id)
  }, [refresh, nav, requestLeave])

  const handleDirtyChange = useCallback((id: string, dirty: boolean) => {
    setDirtyProviderId((current) => (dirty ? id : current === id ? null : current))
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      await api.deleteProvider(id)
      const list = await refresh()
      if (selectedId === id) {
        nav.select(list.length > 0 ? list[0].id : null)
      }
    },
    [selectedId, refresh, nav],
  )

  if (loading) {
    // Wider than the default: this panel is a `MasterDetail`, which is
    // `max-w-3xl`, and a skeleton narrower than what replaces it reflows the
    // page at the moment it is meant to be steadying it.
    return <SettingsSkeleton className="max-w-3xl" />
  }

  if (loadError && providers.length === 0) {
    return (
      <SettingsPane>
        <SettingsHeader title={t('settings.provider.title')} />
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('settings.provider.loadError')}</Alert.Title>
            <Alert.Description className="break-all">{loadError}</Alert.Description>
            <Button
              size="small"
              variant="outline"
              onPress={() => {
                setLoadError(null)
                setLoading(true)
                void refresh()
                  .catch((reason) => setLoadError(String(reason)))
                  .finally(() => setLoading(false))
              }}
            >
              {t('settings.provider.retry')}
            </Button>
          </Alert.Content>
        </Alert>
      </SettingsPane>
    )
  }

  const selected = providers.find((p) => p.id === selectedId)

  const providerList = (
    <ListView
      aria-label={t('settings.provider.title')}
      className="flex flex-col gap-1"
      selectedKeys={selectedId ? new Set([selectedId]) : new Set<string>()}
      selectionBehavior="replace"
      selectionMode="single"
      shouldSelectOnPressUp
      variant="secondary"
      renderEmptyState={() => (
        // The text used to point at the "+" in the header, which is what an
        // empty state has an action slot for.
        <EmptyState size="sm">
          <EmptyState.Media variant="icon">
            <Cloud />
          </EmptyState.Media>
          <EmptyState.Header>
            <EmptyState.Title>{t('settings.provider.noProviders')}</EmptyState.Title>
          </EmptyState.Header>
          <EmptyState.Content>
            <Button variant="outline" onPress={handleCreate}>
              <Plus className="w-4 h-4" />
              {t('settings.provider.addProvider')}
            </Button>
          </EmptyState.Content>
        </EmptyState>
      )}
      onSelectionChange={(keys) => {
        if (keys === 'all') return
        const id = keys.values().next().value
        if (typeof id === 'string' && id !== selectedId) nav.openItem(id)
      }}
    >
      {providers.map((p) => {
        const iconModel = p.catalog_id ?? p.provider_type
        return (
          <ListView.Item
            key={p.id}
            id={p.id}
            textValue={p.name}
            className="min-h-11 rounded-lg border-b-0 px-3 py-2 data-[selected=true]:bg-background-tertiary-default data-[selected=true]:text-text-primary"
          >
            <ListView.ItemContent>
              <span
                data-slot="provider-row-icon"
                className="flex size-4 shrink-0 items-center justify-center text-text-secondary"
              >
                {iconModel ? <ModelIcon model={iconModel} size={16} /> : <Cloud className="size-4" />}
              </span>
              <ListView.Title className="text-body-regular">{p.name}</ListView.Title>
            </ListView.ItemContent>
          </ListView.Item>
        )
      })}
    </ListView>
  )

  return (
    <>
      <MasterDetail
        nav={nav}
        title={t('settings.provider.title')}
        actions={
          <TooltipTrigger delay={0}>
            <Button iconOnly aria-label={t('settings.provider.addProvider')} variant="ghost" onPress={handleCreate}>
              <Plus className="w-4 h-4" />
            </Button>
            <Tooltip placement="top">{t('settings.provider.addProvider')}</Tooltip>
          </TooltipTrigger>
        }
        list={providerList}
        detailTitle={selected?.name}
        detail={
          selected ? (
            <ProviderEditor
              key={selected.id}
              provider={selected}
              onUpdate={refresh}
              onDelete={handleDelete}
              onDirtyChange={handleDirtyChange}
            />
          ) : undefined
        }
        emptyDetail={t('settings.provider.selectProvider')}
      />
      {confirmDialog}
    </>
  )
}
