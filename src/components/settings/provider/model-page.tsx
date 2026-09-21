import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Description, Disclosure, Input, Label, Switch, TextField } from '@/components/base'
import { api } from '@/api'
import { assertDecimal38_18 } from '@/lib/decimal'
import { EFFORT_LADDER } from '@/lib/thinking'
import { SettingsRow, SettingsSection, SettingsSelect, SettingsSkeleton } from '../primitives'
import { SettingsPage } from '../settings-page'
import { useSettingsDraft } from '../settings-stack'
import { PriceTierEditor } from './price-tier-editor'
import { safeThreshold, triFrom, triTo, type Tri } from './capabilities'
import { optionalPrice, tiersFrom, tiersTo, type PriceField, type TierDraft } from './pricing'
import type {
  DecimalString,
  ModelConfigInfoResponse,
  ModelConfigUpsertRequest,
  ModelProfileInfoResponse,
  PriceTier,
  ProviderCapabilitiesInfoResponse,
  ProviderCapabilityOverrides,
  ServerToolKind,
  ThinkingEffort,
} from '@/types'

/** The option that creates a description rather than pointing at one. */
const NEW_PROFILE = '__new__'

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
  profiles,
  onSave,
  onDelete,
}: {
  providerId: string
  modelId: string
  /** Not read directly — it is here so the capability lookup re-runs when the
   *  dialect changes, which is what decides whether this model has any
   *  provider-side tools at all. */
  apiFormat: string
  existing?: ModelConfigInfoResponse
  /** Every model description on this machine, for pointing at one. */
  profiles: ModelProfileInfoResponse[]
  onSave: (input: ModelConfigUpsertRequest) => Promise<void>
  onDelete?: () => void
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
  // Which description this model is pointed at, and what it is called. A null
  // id is a new one; picking an existing one is the whole point of the split,
  // and it replaces every field below with that profile's.
  const [profileId, setProfileId] = useState<string | null>(profile?.id ?? null)
  const [profileName, setProfileName] = useState(profile?.name ?? modelId)
  // Whether this provider charges its own rates. Off is the ordinary case and
  // the four fields below stay blank rather than holding a copy of the
  // profile's — a number kept in two places is a number that comes to disagree,
  // and the backend refuses a row that carries rates it has switched off.
  const [overridesPricing, setOverridesPricing] = useState(existing?.overrides_pricing ?? false)
  const [overrideInput, setOverrideInput] = useState(
    existing?.input_price == null ? '' : assertDecimal38_18(existing.input_price),
  )
  const [overrideOutput, setOverrideOutput] = useState(
    existing?.output_price == null ? '' : assertDecimal38_18(existing.output_price),
  )
  const [overrideCache, setOverrideCache] = useState(
    existing?.cache_read_price == null ? '' : assertDecimal38_18(existing.cache_read_price),
  )
  const [overrideCacheWrite, setOverrideCacheWrite] = useState(
    existing?.cache_write_price == null ? '' : assertDecimal38_18(existing.cache_write_price),
  )
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
    overrideInput: useRef<HTMLInputElement>(null),
    overrideOutput: useRef<HTMLInputElement>(null),
    overrideCache: useRef<HTMLInputElement>(null),
    overrideCacheWrite: useRef<HTMLInputElement>(null),
  } satisfies Record<PriceField, React.RefObject<HTMLInputElement | null>>

  // The page's own draft. Keyed by provider and model, so the same model on
  // two providers is two drafts.
  useSettingsDraft('provider', `model:${providerId}/${modelId}`, dirty)

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
  }, [caps, profile])

  const profileOptions = useMemo(
    () => [
      { value: NEW_PROFILE, label: t('settings.model.newProfile') },
      ...profiles.map((candidate) => ({ value: candidate.id, label: candidate.name })),
    ],
    [profiles, t],
  )

  /**
   * Says how far an edit reaches before it is made.
   *
   * A window shared by three providers is one window, and changing it from here
   * changes it for all of them. That is the feature, and it is also the thing
   * somebody would not expect from a page titled with one provider's model.
   */
  const sharedNote = useMemo(() => {
    const count = profiles.find((candidate) => candidate.id === profileId)?.model_count ?? 0
    return count > 1 ? t('settings.model.sharedBy', { count }) : undefined
  }, [profileId, profiles, t])

  /**
   * Pointing at a different description replaces the form with that one's
   * values rather than keeping what was typed. Keeping it would save the old
   * numbers onto the new profile and silently rewrite a description three other
   * providers are reading.
   */
  const handleProfileChange = (next: string) => {
    setDirty(true)
    if (next === NEW_PROFILE) {
      setProfileId(null)
      setProfileName(modelId)
      return
    }
    const chosen = profiles.find((candidate) => candidate.id === next)
    if (!chosen) return
    setProfileId(chosen.id)
    setProfileName(chosen.name)
    setContextWindow(chosen.context_window.toString())
    setCompactThreshold(chosen.compact_threshold.toString())
    setMaxOutput(chosen.max_output_tokens?.toString() ?? '')
    setInputPrice(chosen.input_price ?? '')
    setOutputPrice(chosen.output_price ?? '')
    setCachePrice(chosen.cache_read_price ?? '')
    setCacheWritePrice(chosen.cache_write_price ?? '')
    setTiers(tiersFrom(chosen.pricing_tiers))
    setShowTiers(chosen.pricing_tiers.length > 0)
  }

  const buildOverrides = (): ProviderCapabilityOverrides | null => {
    const chosen = profileId ? profiles.find((candidate) => candidate.id === profileId) : null
    const next: ProviderCapabilityOverrides = { ...((chosen ?? profile)?.capability_overrides ?? {}) }
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
      overrideInput: t('settings.model.inputPrice'),
      overrideOutput: t('settings.model.outputPrice'),
      overrideCache: t('settings.model.cachePrice'),
      overrideCacheWrite: t('settings.model.cacheWritePrice'),
    }
    const parsed: Partial<Record<PriceField, DecimalString | null>> = {}
    for (const [field, raw] of [
      ['input', inputPrice],
      ['output', outputPrice],
      ['cache', cachePrice],
      ['cacheWrite', cacheWritePrice],
      ['serverTool', serverToolPrice],
      ['overrideInput', overrideInput],
      ['overrideOutput', overrideOutput],
      ['overrideCache', overrideCache],
      ['overrideCacheWrite', overrideCacheWrite],
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
    // The same pairing rule as the profile's, on this provider's own rates:
    // half a rate set prices nothing.
    const overrideIn = overridesPricing ? (parsed.overrideInput ?? null) : null
    const overrideOut = overridesPricing ? (parsed.overrideOutput ?? null) : null
    if ((overrideIn == null) !== (overrideOut == null)) {
      refuse(t('settings.model.pricePairError'), [overrideIn == null ? 'overrideInput' : 'overrideOutput'])
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
          // The profile this model is pointed at, which the picker above may
          // have changed. A null id creates one; naming an existing one is how
          // a second provider stops repeating the first.
          id: profileId,
          name: profileName.trim() || modelId,
          context_window: parseInt(contextWindow) || 128000,
          compact_threshold: parseInt(compactThreshold) || 100000,
          max_output_tokens: maxOutput ? parseInt(maxOutput) : null,
          ...prices,
          capability_overrides: buildOverrides(),
        },
        overrides_pricing: overridesPricing,
        // Blank whenever the switch is off, which the backend enforces too: the
        // columns are read at all only when it is on, so leaving a copy of the
        // profile's rates in them would be a second answer to what this costs.
        input_price: overrideIn,
        output_price: overrideOut,
        cache_read_price: overridesPricing ? (parsed.overrideCache ?? null) : null,
        cache_write_price: overridesPricing ? (parsed.overrideCacheWrite ?? null) : null,
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

  // Every control in here overrides the default height down to 28px, which is
  // a deliberate density for a form of this many fields and a pointer. The
  // coarse-pointer variants put the extra height back where a finger is doing
  // the aiming and leave the desktop exactly as it was.
  const form = (
    <div data-slot="model-config-editor" className="space-y-2">
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
    </div>
  )

  /**
   * What is different about reaching this model *here*.
   *
   * Almost nothing usually, which is why it is one switch and four fields
   * rather than a copy of the form above. A relay that resells at its own
   * margin is the case it exists for; everything else is the model's, and
   * saying so twice is how the two come to disagree.
   */
  const providerSection = (
    <SettingsSection label={t('settings.model.sectionThisProvider')}>
      <SettingsRow label={t('settings.model.overridePricing')} description={t('settings.model.overridePricingHint')}>
        {({ labelId, descriptionId }) => (
          <Switch
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            isSelected={overridesPricing}
            onChange={(next) => {
              setOverridesPricing(next)
              setDirty(true)
            }}
          />
        )}
      </SettingsRow>
      {overridesPricing &&
        (
          [
            ['overrideInput', t('settings.model.inputPrice'), overrideInput, setOverrideInput],
            ['overrideOutput', t('settings.model.outputPrice'), overrideOutput, setOverrideOutput],
            ['overrideCache', t('settings.model.cachePrice'), overrideCache, setOverrideCache],
            ['overrideCacheWrite', t('settings.model.cacheWritePrice'), overrideCacheWrite, setOverrideCacheWrite],
          ] as const
        ).map(([field, label, value, setValue]) => (
          <SettingsRow key={field} label={label}>
            {({ labelId }) => (
              <TextField isInvalid={invalidPrices.has(field)}>
                <Input
                  ref={priceRefs[field]}
                  aria-labelledby={labelId}
                  name={`modelOverride-${field}-${modelId}`}
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value)
                    setDirty(true)
                  }}
                  className="w-[202px]"
                />
              </TextField>
            )}
          </SettingsRow>
        ))}
    </SettingsSection>
  )

  return (
    <SettingsPage
      title={profileName || modelId}
      subtitle={profileName && profileName !== modelId ? modelId : undefined}
      width="wide"
      footer={
        <>
          <Button onPress={() => void handleSave()}>{t('common.save')}</Button>
          {onDelete && (
            <Button variant="danger-soft" onPress={onDelete}>
              {t('common.delete')}
            </Button>
          )}
          <div data-slot="model-config-footer-spacer" className="flex-1" />
          {priceError && (
            <p data-slot="model-config-error" role="alert" className="text-caption-1-regular text-status-danger">
              {priceError}
            </p>
          )}
        </>
      }
    >
      <SettingsSection label={t('settings.model.sectionProfile')}>
        <SettingsRow label={t('settings.model.useProfile')} description={sharedNote}>
          {({ labelId }) => (
            <SettingsSelect
              ariaLabelledBy={labelId}
              value={profileId ?? NEW_PROFILE}
              options={profileOptions}
              onChange={handleProfileChange}
              triggerClassName="w-[202px]"
            />
          )}
        </SettingsRow>
        <SettingsRow label={t('settings.model.profileName')} stacked>
          {({ labelId }) => (
            <Input
              aria-labelledby={labelId}
              name={`modelProfileName-${modelId}`}
              value={profileName}
              onChange={(event) => {
                setProfileName(event.target.value)
                setDirty(true)
              }}
            />
          )}
        </SettingsRow>
      </SettingsSection>
      {form}
      {providerSection}
    </SettingsPage>
  )
}

/**
 * One model, as one provider serves it.
 *
 * Fetched by id rather than handed down, so this page is the same whether it
 * was opened from the provider page or landed on after a reload. The profile
 * list comes with it, because pointing this model at an existing description —
 * the thing that stops a second provider repeating the first — is a choice
 * between all of them.
 */
export function ModelPage({
  providerId,
  modelId,
  apiFormat,
  onSaved,
  onDeleted,
}: {
  providerId: string
  modelId: string
  apiFormat: string
  onSaved: () => void
  onDeleted: () => void
}) {
  const [existing, setExisting] = useState<ModelConfigInfoResponse | null>(null)
  const [profiles, setProfiles] = useState<ModelProfileInfoResponse[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void Promise.all([api.getModelConfig({ providerId, modelId }), api.listModelProfiles()])
      .then(([config, list]) => {
        if (cancelled) return
        setExisting(config)
        setProfiles(list)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [providerId, modelId])

  if (loading) return <SettingsSkeleton className="max-w-3xl" />

  return (
    <ModelConfigEditor
      key={`${providerId}/${modelId}`}
      providerId={providerId}
      modelId={modelId}
      apiFormat={apiFormat}
      existing={existing ?? undefined}
      profiles={profiles}
      onSave={async (input) => {
        const saved = await api.saveModelConfig(input)
        setExisting(saved)
        setProfiles(await api.listModelProfiles())
        onSaved()
      }}
      onDelete={
        existing
          ? async () => {
              await api.deleteModelConfig(existing.id)
              onDeleted()
            }
          : undefined
      }
    />
  )
}
