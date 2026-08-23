import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ArrowsRotateRight, TrashBin, Cloud, Key, Sliders, Xmark } from '@gravity-ui/icons'
import { Button, Description, Disclosure, Input, Label, Spinner, TextField, Tooltip } from '@heroui/react'
import { EmptyState } from '@heroui-pro/react/empty-state'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { MasterDetail } from './master-detail'
import { SavedHint, SettingsRow, SettingsSelect, SettingsSkeleton } from './primitives'
import { useMasterDetail } from './use-master-detail'
import { EFFORT_LADDER } from '@/lib/thinking'
import type {
  ModelConfig,
  ModelConfigInput,
  PriceTier,
  Provider,
  ProviderBalance,
  ModelInfo,
  ProviderCapabilities,
  ThinkingEffort,
} from '@/types'

/**
 * Capability overrides are tri-state on purpose. A plain checkbox cannot express
 * "inherit", so the first save would pin every capability to its current value
 * and the model would stop receiving catalog updates forever.
 */
type Tri = 'auto' | 'on' | 'off'

const PROVIDER_DEFAULT_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  xai: 'https://api.x.ai/v1',
  google: 'https://generativelanguage.googleapis.com',
}

/**
 * Provider types whose adapter is decided by the type alone, so the wire format
 * is not a choice.
 *
 * Deliberately a denylist — a type nobody has thought about yet keeps the
 * control rather than silently losing it.
 */
const SINGLE_FORMAT_TYPES = ['anthropic']

/**
 * Types that speak both dialects but not the `gemma_tool` simulation.
 *
 * The choice is not cosmetic for these two: the server-side tools — Grok's own
 * web search, DeepSeek's — exist only on the Responses API. xAI's
 * chat-completions endpoint rejects `{"type":"web_search"}` outright with
 * "expected `function` or `live_search`". Chat-completions is still the better
 * default for xAI on everything else, since that is where `x-grok-conv-id`
 * routes the prompt cache.
 */
const DUAL_FORMAT_TYPES = ['xai', 'deepseek']

/**
 * Provider types that publish an account balance.
 *
 * Mirrors `provider::balance::supports_balance`, which is the authority — asking
 * one that does not returns null and this form says so, so a drift here is
 * visible rather than silent. It exists only to keep a "check balance" button
 * off the panels where it could never do anything: Anthropic and xAI publish
 * nothing, and OpenAI withdrew the endpoint that used to.
 */
const BALANCE_TYPES = ['deepseek']

const GOOGLE_FORMAT_DEFAULT_URLS: Record<string, string> = {
  gemini_generate_content: 'https://generativelanguage.googleapis.com',
  chat_completions: 'https://generativelanguage.googleapis.com/v1beta/openai',
}

const GOOGLE_FORMAT_PLACEHOLDERS: Record<string, string> = {
  gemini_generate_content: 'https://api.example.com',
  chat_completions: 'https://api.example.com/v1',
}

function triFrom(value: unknown): Tri {
  // Anything that isn't a real boolean (missing key, or a hand-edited override
  // holding junk) reads as "inherit".
  return typeof value === 'boolean' ? (value ? 'on' : 'off') : 'auto'
}

function triTo(tri: Tri): boolean | undefined {
  return tri === 'auto' ? undefined : tri === 'on'
}

/** Malformed overrides degrade to catalog behaviour on both ends, never throw. */
function parseOverrides(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * The latest a conversation can start compacting and still have room to answer.
 *
 * Mirrors `safe_threshold` in `src-tauri/src/agent/tokenizer.rs`, which is the
 * authority — it clamps whatever is stored here, so the two disagreeing costs a
 * misleading number in this form rather than a broken turn. The old default was
 * a flat 90% of the window, which ignored output entirely: on a model that
 * advertises 128k of output against a 256k window it reserved nothing, and the
 * request the threshold permitted was one the provider had to refuse.
 */
function safeThreshold(contextWindow: number, maxOutput: number | null): number {
  const reserve = Math.min(maxOutput ?? 0, 32000)
  const headroom = Math.min(Math.floor(contextWindow / 20), 8000)
  return Math.max(contextWindow - reserve - headroom, Math.floor(contextWindow / 2))
}

/** A stored JSON array of names, or nothing at all if it will not parse. */
function nameList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []
  } catch {
    return []
  }
}

/**
 * One tier as the form holds it.
 *
 * Strings, like every other price box here, because a half-typed number is not
 * a number — parsing on each keystroke makes "4." unrepresentable and the field
 * impossible to type a decimal into.
 */
type TierDraft = { threshold: string; input: string; output: string; cacheRead: string; cacheWrite: string }

const BLANK_TIER: TierDraft = { threshold: '', input: '', output: '', cacheRead: '', cacheWrite: '' }

function tiersFrom(raw: string | null | undefined): TierDraft[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as PriceTier[])
      .filter((tier) => !!tier && typeof tier === 'object')
      .map((tier) => ({
        threshold: tier.min_prompt_tokens?.toString() ?? '',
        input: tier.input?.toString() ?? '',
        output: tier.output?.toString() ?? '',
        cacheRead: tier.cache_read == null ? '' : tier.cache_read.toString(),
        cacheWrite: tier.cache_write == null ? '' : tier.cache_write.toString(),
      }))
  } catch {
    return []
  }
}

/**
 * Drop the rows that say nothing and sort what is left.
 *
 * A tier needs a threshold above zero and both rates: one at zero would read as
 * "free above 200k" rather than as the half-filled row it is, and the backend
 * discards a zero threshold anyway. Sorted here as well as in `parse_tiers`
 * because the stored order is what a human reads back.
 */
function tiersTo(drafts: TierDraft[]): string | null {
  const tiers = drafts
    .map((draft) => ({
      min_prompt_tokens: parseInt(draft.threshold),
      input: parseFloat(draft.input),
      output: parseFloat(draft.output),
      cache_read: draft.cacheRead ? parseFloat(draft.cacheRead) : null,
      cache_write: draft.cacheWrite ? parseFloat(draft.cacheWrite) : null,
    }))
    .filter(
      (tier) =>
        Number.isFinite(tier.min_prompt_tokens) &&
        tier.min_prompt_tokens > 0 &&
        Number.isFinite(tier.input) &&
        Number.isFinite(tier.output),
    )
    .sort((a, b) => a.min_prompt_tokens - b.min_prompt_tokens)
  return tiers.length > 0 ? JSON.stringify(tiers) : null
}

/**
 * The rates that take over above a prompt size.
 *
 * Laid out one tier per card rather than one per row: five numbers across the
 * detail pane would each be too narrow to read a price in, and this list is
 * nearly always empty or one entry long.
 */
function PriceTierEditor({ tiers, onChange }: { tiers: TierDraft[]; onChange: (next: TierDraft[]) => void }) {
  const { t } = useTranslation()
  const patch = (index: number, field: keyof TierDraft, value: string) =>
    onChange(tiers.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)))

  return (
    <div data-slot="price-tiers" className="space-y-2">
      <p className="text-xs text-muted">{t('settings.model.priceTiersHint')}</p>
      {tiers.map((tier, index) => (
        <div key={index} data-slot="price-tier" className="rounded-lg border border-border p-2 space-y-2">
          <div className="flex items-end gap-2">
            <TextField fullWidth>
              <Label>{t('settings.model.tierThreshold')}</Label>
              <Input
                value={tier.threshold}
                onChange={(e) => patch(index, 'threshold', e.target.value)}
                placeholder="200000"
                className="h-7 pointer-coarse:h-10 text-xs"
              />
            </TextField>
            <Tooltip>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('settings.model.removeTier')}
                className="h-7 pointer-coarse:h-10 rounded-md px-2 text-danger"
                onClick={() => onChange(tiers.filter((_, i) => i !== index))}
              >
                <TrashBin className="size-3.5" />
              </Button>
              <Tooltip.Content>{t('settings.model.removeTier')}</Tooltip.Content>
            </Tooltip>
          </div>
          <div className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-2">
            <TextField fullWidth>
              <Label>{t('settings.model.inputPrice')}</Label>
              <Input
                value={tier.input}
                onChange={(e) => patch(index, 'input', e.target.value)}
                className="h-7 pointer-coarse:h-10 text-xs"
              />
            </TextField>
            <TextField fullWidth>
              <Label>{t('settings.model.outputPrice')}</Label>
              <Input
                value={tier.output}
                onChange={(e) => patch(index, 'output', e.target.value)}
                className="h-7 pointer-coarse:h-10 text-xs"
              />
            </TextField>
            <TextField fullWidth>
              <Label>{t('settings.model.cachePrice')}</Label>
              <Input
                value={tier.cacheRead}
                onChange={(e) => patch(index, 'cacheRead', e.target.value)}
                placeholder="—"
                className="h-7 pointer-coarse:h-10 text-xs"
              />
            </TextField>
            <TextField fullWidth>
              <Label>{t('settings.model.cacheWritePrice')}</Label>
              <Input
                value={tier.cacheWrite}
                onChange={(e) => patch(index, 'cacheWrite', e.target.value)}
                placeholder="—"
                className="h-7 pointer-coarse:h-10 text-xs"
              />
            </TextField>
          </div>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="h-7 pointer-coarse:h-10 rounded-md text-xs"
        onClick={() => onChange([...tiers, { ...BLANK_TIER }])}
      >
        <Plus className="size-3.5" />
        {t('settings.model.addTier')}
      </Button>
    </div>
  )
}

function CapabilityTriRow({ label, value, onChange }: { label: string; value: Tri; onChange: (next: Tri) => void }) {
  const { t } = useTranslation()
  const options: Array<{ value: Tri; label: string }> = [
    { value: 'auto', label: t('settings.model.capAuto') },
    { value: 'on', label: t('settings.model.capOn') },
    { value: 'off', label: t('settings.model.capOff') },
  ]
  return (
    <div data-slot="capability-tri-row" className="flex items-center justify-between gap-2">
      <p className="text-xs text-muted">{label}</p>
      <SettingsSelect
        ariaLabel={label}
        value={value}
        options={options}
        onChange={onChange}
        triggerClassName="h-7 w-32 text-xs"
        itemClassName="text-xs"
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
}: {
  providerId: string
  modelId: string
  /** Not read directly — it is here so the capability lookup re-runs when the
   *  dialect changes, which is what decides whether this model has any
   *  provider-side tools at all. */
  apiFormat: string
  existing?: ModelConfig
  onSave: (input: ModelConfigInput) => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const [caps, setCaps] = useState<ProviderCapabilities | null>(null)

  useEffect(() => {
    api
      .getProviderCapabilities(providerId, modelId)
      .then(setCaps)
      .catch(() => {})
  }, [providerId, modelId, apiFormat])

  const defaultCtx = existing?.context_window ?? caps?.max_context_tokens ?? 128000
  const defaultMaxOut = existing?.max_output_tokens ?? caps?.max_output_tokens ?? null
  const defaultThreshold = existing?.compact_threshold ?? safeThreshold(defaultCtx, defaultMaxOut)

  const [contextWindow, setContextWindow] = useState(defaultCtx.toString())
  const [compactThreshold, setCompactThreshold] = useState(defaultThreshold.toString())
  const [maxOutput, setMaxOutput] = useState(defaultMaxOut?.toString() ?? '')
  const [inputPrice, setInputPrice] = useState(existing?.input_price?.toString() ?? '0')
  const [outputPrice, setOutputPrice] = useState(existing?.output_price?.toString() ?? '0')
  const [cachePrice, setCachePrice] = useState(existing?.cache_price?.toString() ?? '')
  const [cacheWritePrice, setCacheWritePrice] = useState(existing?.cache_write_price?.toString() ?? '')
  const [tiers, setTiers] = useState<TierDraft[]>(() => tiersFrom(existing?.price_tiers))
  const [serverTools, setServerTools] = useState<string[]>(() => nameList(existing?.server_tools))
  const [serverToolPrice, setServerToolPrice] = useState(existing?.server_tool_price?.toString() ?? '')
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
    const saved = parseOverrides(existing?.capability_overrides)
    setEfforts(EFFORT_LADDER.filter((e) => (caps.supported_efforts ?? EFFORT_LADDER).includes(e)))
    effortsDirty.current = saved.supported_efforts !== undefined
    setCapThinking(triFrom(saved.supports_thinking))
    setCapFast(triFrom(saved.supports_fast))
  }, [caps, existing])

  const buildOverrides = (): string | null => {
    // Merge into whatever is stored so keys this editor doesn't know about
    // survive a round-trip.
    const next: Record<string, unknown> = { ...parseOverrides(existing?.capability_overrides) }
    const put = (key: string, value: unknown) => {
      if (value === undefined) delete next[key]
      else next[key] = value
    }
    put('supported_efforts', effortsDirty.current ? efforts : undefined)
    put('supports_thinking', triTo(capThinking))
    put('supports_fast', triTo(capFast))
    return Object.keys(next).length > 0 ? JSON.stringify(next) : null
  }

  const resetOverrides = () => {
    effortsDirty.current = false
    setCapThinking('auto')
    setCapFast('auto')
    if (caps) setEfforts(EFFORT_LADDER.filter((e) => (caps.supported_efforts ?? EFFORT_LADDER).includes(e)))
  }

  const handleSave = () => {
    onSave({
      provider_id: providerId,
      model_id: modelId,
      context_window: parseInt(contextWindow) || 128000,
      compact_threshold: parseInt(compactThreshold) || 100000,
      max_output_tokens: maxOutput ? parseInt(maxOutput) : null,
      input_price: parseFloat(inputPrice) || 0,
      output_price: parseFloat(outputPrice) || 0,
      cache_price: cachePrice ? parseFloat(cachePrice) : null,
      cache_write_price: cacheWritePrice ? parseFloat(cacheWritePrice) : null,
      capability_overrides: buildOverrides(),
      price_tiers: tiersTo(tiers),
      // What the user asked for, not what is currently supported. Filtering here
      // against `caps` looked like defence and was a way to lose the setting:
      // capabilities load asynchronously, so a save while that request was still
      // in flight — or after it failed — silently wrote an empty list over a
      // switch the user had just turned on. The narrowing that matters happens
      // per turn in `resolve_turn_params`, where the model's support is known
      // for certain and a stale name costs nothing.
      server_tools: serverTools.length > 0 ? JSON.stringify(serverTools) : null,
      server_tool_price: serverToolPrice ? parseFloat(serverToolPrice) : null,
    })
  }

  return (
    // Every control in here overrides HeroUI's height down to 28px, which is a
    // deliberate density for a form of this many fields and a pointer. HeroUI's
    // own sizing is mobile-first (`h-10 md:h-9`) and the override threw that
    // away on every device, so the coarse-pointer variants put it back where a
    // finger is doing the aiming and leave the desktop exactly as it was.
    <div className="px-3 pb-3 space-y-2 bg-default/30">
      <div className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-2">
        <TextField fullWidth>
          <Label>{t('settings.model.contextWindow')}</Label>
          <Input
            value={contextWindow}
            onChange={(e) => setContextWindow(e.target.value)}
            className="h-7 pointer-coarse:h-10 text-xs"
          />
        </TextField>
        <TextField fullWidth>
          <Label>{t('settings.model.compactThreshold')}</Label>
          <Input
            value={compactThreshold}
            onChange={(e) => setCompactThreshold(e.target.value)}
            className="h-7 pointer-coarse:h-10 text-xs"
          />
        </TextField>
      </div>
      <TextField fullWidth>
        <Label>{t('settings.model.maxOutput')}</Label>
        <Input
          value={maxOutput}
          onChange={(e) => setMaxOutput(e.target.value)}
          placeholder={t('settings.model.optional')}
          className="h-7 pointer-coarse:h-10 text-xs"
        />
      </TextField>
      {/* Four rates, all per million tokens. The two cache boxes are blank by
          default and blank means "priced like input" — which is what every
          provider but Anthropic does, and what the usage report bills them at. */}
      <div className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-2">
        <TextField fullWidth>
          <Label>{t('settings.model.inputPrice')}</Label>
          <Input
            value={inputPrice}
            onChange={(e) => setInputPrice(e.target.value)}
            className="h-7 pointer-coarse:h-10 text-xs"
          />
        </TextField>
        <TextField fullWidth>
          <Label>{t('settings.model.outputPrice')}</Label>
          <Input
            value={outputPrice}
            onChange={(e) => setOutputPrice(e.target.value)}
            className="h-7 pointer-coarse:h-10 text-xs"
          />
        </TextField>
        <TextField fullWidth>
          <Label>{t('settings.model.cachePrice')}</Label>
          <Input
            value={cachePrice}
            onChange={(e) => setCachePrice(e.target.value)}
            placeholder="—"
            className="h-7 pointer-coarse:h-10 text-xs"
          />
          <Description className="text-xs">{t('settings.model.cachePriceHint')}</Description>
        </TextField>
        <TextField fullWidth>
          <Label>{t('settings.model.cacheWritePrice')}</Label>
          <Input
            value={cacheWritePrice}
            onChange={(e) => setCacheWritePrice(e.target.value)}
            placeholder="—"
            className="h-7 pointer-coarse:h-10 text-xs"
          />
          <Description className="text-xs">{t('settings.model.cacheWritePriceHint')}</Description>
        </TextField>
      </div>
      {/* Only where the model has any. Elsewhere this is not a switch that is
          off, it is a thing that does not exist — and an empty section reads as
          a feature that failed to load. */}
      {(caps?.server_tools?.length ?? 0) > 0 && (
        <div data-slot="server-tools" className="space-y-1.5 pt-1">
          <p className="text-xs text-muted">{t('settings.model.serverTools')}</p>
          <div className="flex flex-wrap gap-1">
            {caps?.server_tools?.map((name) => {
              const on = serverTools.includes(name)
              return (
                <Button
                  key={name}
                  data-slot="server-tool-chip"
                  variant={on ? 'primary' : 'outline'}
                  size="sm"
                  aria-pressed={on}
                  className="h-6 pointer-coarse:h-9 rounded-md px-2 text-xs font-normal"
                  onClick={() => setServerTools(on ? serverTools.filter((x) => x !== name) : [...serverTools, name])}
                >
                  {t(`settings.model.serverTool.${name}`, name)}
                </Button>
              )
            })}
          </div>
          <TextField fullWidth>
            <Label>{t('settings.model.serverToolPrice')}</Label>
            <Input
              value={serverToolPrice}
              onChange={(e) => setServerToolPrice(e.target.value)}
              placeholder="5"
              className="h-7 pointer-coarse:h-10 text-xs"
            />
            <Description className="text-xs">{t('settings.model.serverToolPriceHint')}</Description>
          </TextField>
          <p className="text-xs text-muted">{t('settings.model.serverToolsHint')}</p>
        </div>
      )}
      <Disclosure
        data-slot="price-tier-section"
        className="pt-1"
        isExpanded={showTiers}
        onExpandedChange={setShowTiers}
      >
        <Disclosure.Heading>
          <Disclosure.Trigger className="inline-flex items-center gap-1 rounded-md text-xs text-muted transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50">
            {tiers.length > 0
              ? t('settings.model.priceTiersCount', { count: tiers.length })
              : t('settings.model.priceTiers')}
            <Disclosure.Indicator className="size-3.5" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content className="min-h-0 w-full">
          <Disclosure.Body className="pt-1">
            <PriceTierEditor tiers={tiers} onChange={setTiers} />
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
          <Disclosure.Trigger className="inline-flex items-center gap-1 rounded-md text-xs text-muted transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus/50">
            {t('settings.model.capabilities')}
            <Disclosure.Indicator className="size-3.5" />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content className="min-h-0 w-full">
          {/* Body, not a plain wrapper: it is what keeps the panel measurable,
              so without it the overrides never collapse. */}
          <Disclosure.Body className="space-y-2">
            <div data-slot="effort-whitelist" className="space-y-1.5">
              <p className="text-xs text-muted">{t('settings.model.supportedEfforts')}</p>
              <div className="flex flex-wrap gap-1">
                {EFFORT_LADDER.map((tier) => {
                  const on = efforts.includes(tier)
                  return (
                    <Button
                      key={tier}
                      data-slot="effort-chip"
                      variant={on ? 'primary' : 'outline'}
                      size="sm"
                      aria-pressed={on}
                      className="h-6 pointer-coarse:h-9 px-2 text-xs font-normal"
                      onClick={() => {
                        // Rebuild from the ladder so the stored array stays in
                        // ascending order -- the median coercion ranks on position.
                        setEfforts(EFFORT_LADDER.filter((x) => (x === tier ? !on : efforts.includes(x))))
                        effortsDirty.current = true
                      }}
                    >
                      {t(`toolbar.thinking.${tier}`)}
                    </Button>
                  )
                })}
              </div>
            </div>
            <CapabilityTriRow label={t('settings.model.capThinking')} value={capThinking} onChange={setCapThinking} />
            <CapabilityTriRow label={t('settings.model.capFast')} value={capFast} onChange={setCapFast} />
            <p className="text-xs text-muted">{t('settings.model.capabilitiesHint')}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 pointer-coarse:h-9 px-0 text-xs text-muted hover:text-foreground"
              onClick={resetOverrides}
            >
              {t('settings.model.capReset')}
            </Button>
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="h-7 pointer-coarse:h-10 text-xs" onClick={handleSave}>
          {t('common.save')}
        </Button>
        {onDelete && (
          <Button size="sm" variant="ghost" className="h-7 pointer-coarse:h-10 text-xs text-danger" onClick={onDelete}>
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
}: {
  provider: Provider
  onUpdate: () => void
  /// Awaited so the button can show progress until the list has reloaded.
  onDelete: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(provider.name)
  const [providerType, setProviderType] = useState(provider.provider_type)
  const [baseUrl, setBaseUrl] = useState(provider.base_url)
  const [apiFormat, setApiFormat] = useState(provider.api_format || 'chat_completions')
  const [apiKey, setApiKey] = useState('')
  const { confirm, confirmDialog } = useConfirm()
  // Not a boolean: while the lookup is in flight `false` renders exactly like
  // "no key configured", and so does a lookup that failed. Both would invite the
  // user to enter a key they already have — and saving one rewrites the store
  // under a fresh passphrase, which is how the *other* providers' keys get lost.
  const [keyStatus, setKeyStatus] = useState<'loading' | 'set' | 'unset' | 'error'>('loading')
  const [savingKey, setSavingKey] = useState(false)
  const [keySaved, markKeySaved] = useTemporaryFlag()
  const [saved, markSaved] = useTemporaryFlag()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [balance, setBalance] = useState<ProviderBalance | null>(null)
  const [fetchingBalance, setFetchingBalance] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [modelConfigs, setModelConfigs] = useState<Map<string, ModelConfig>>(new Map())
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  const handleSave = useCallback(async () => {
    await api.updateProvider(provider.id, { name, providerType, baseUrl, apiFormat })
    markSaved()
    onUpdate()
  }, [provider.id, name, providerType, baseUrl, apiFormat, onUpdate, markSaved])

  const handleProviderTypeChange = useCallback(
    (next: string) => {
      const nextFormat =
        next === 'google' ? 'gemini_generate_content' : next === 'openai' ? 'responses' : 'chat_completions'
      setProviderType(next)
      setBaseUrl((current) => {
        const oldDefault =
          providerType === 'google' ? GOOGLE_FORMAT_DEFAULT_URLS[apiFormat] : PROVIDER_DEFAULT_URLS[providerType]
        return !current || current === oldDefault ? (PROVIDER_DEFAULT_URLS[next] ?? current) : current
      })
      setApiFormat(nextFormat)
    },
    [providerType, apiFormat],
  )

  const handleApiFormatChange = useCallback(
    (next: string) => {
      if (providerType === 'google') {
        setBaseUrl((current) => {
          const oldDefault = GOOGLE_FORMAT_DEFAULT_URLS[apiFormat]
          return !current || current === oldDefault ? (GOOGLE_FORMAT_DEFAULT_URLS[next] ?? current) : current
        })
      }
      setApiFormat(next)
    },
    [providerType, apiFormat],
  )

  const handleSaveKey = useCallback(async () => {
    if (!apiKey.trim()) return
    setSavingKey(true)
    try {
      await api.setProviderKey(provider.id, apiKey.trim())
      setKeyStatus('set')
      setApiKey('')
      markKeySaved()
    } catch (err) {
      console.error('Failed to save key:', err)
      alert(String(err))
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
      const map = new Map<string, ModelConfig>()
      for (const c of configs) map.set(c.model_id, c)
      setModelConfigs(map)
    } catch {
      /* ignore */
    }
  }, [provider.id])

  const handleFetchModels = useCallback(async () => {
    setFetchingModels(true)
    setModelsError(null)
    try {
      const list = await api.fetchProviderModels(provider.id, true)
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
    async (input: ModelConfigInput) => {
      await api.saveModelConfig(input)
      await loadModelConfigs()
      setEditingModelId(null)
    },
    [loadModelConfigs],
  )

  const handleDeleteModelConfig = useCallback(
    async (id: string) => {
      if (!(await confirm({ body: t('settings.confirmDelete.modelConfig') }))) return
      await api.deleteModelConfig(id)
      await loadModelConfigs()
      setEditingModelId(null)
    },
    [confirm, t, loadModelConfigs],
  )

  const typeOptions = [
    { value: 'openai', label: t('settings.provider.typeOpenAI') },
    { value: 'anthropic', label: t('settings.provider.typeAnthropic') },
    // Previously unreachable from the UI, which silently sent every DeepSeek
    // provider down the generic path with reasoning support switched off.
    { value: 'deepseek', label: t('settings.provider.typeDeepSeek') },
    { value: 'xai', label: t('settings.provider.typeXAI') },
    { value: 'google', label: t('settings.provider.typeGoogle') },
  ]
  const formatOptions = [
    { value: 'responses', label: t('settings.provider.apiFormatResponses') },
    { value: 'chat_completions', label: t('settings.provider.apiFormatChatCompletions') },
    { value: 'gemma_tool', label: t('settings.provider.apiFormatGemmaTool') },
  ]
  const googleFormatOptions = [
    { value: 'gemini_generate_content', label: t('settings.provider.apiFormatGeminiGenerateContent') },
    { value: 'chat_completions', label: t('settings.provider.apiFormatOpenAICompatible') },
  ]
  // `gemma_tool` simulates function calling through prompt injection on a plain
  // chat endpoint. It is meaningless against either of these.
  const dualFormatOptions = formatOptions.filter((option) => option.value !== 'gemma_tool')
  const formatDescription =
    providerType === 'google'
      ? apiFormat === 'gemini_generate_content'
        ? t('settings.provider.apiFormatGeminiGenerateContentHint')
        : t('settings.provider.apiFormatOpenAICompatibleHint')
      : undefined

  return (
    <div className="space-y-5">
      <TextField fullWidth>
        <Label>{t('settings.provider.name')}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>

      <SettingsSelect
        label={t('settings.provider.type')}
        value={providerType}
        options={typeOptions}
        onChange={handleProviderTypeChange}
        fullWidth
      />

      <TextField fullWidth>
        <Label>{t('settings.provider.baseUrl')}</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={
            providerType === 'google'
              ? (GOOGLE_FORMAT_PLACEHOLDERS[apiFormat] ?? GOOGLE_FORMAT_PLACEHOLDERS.gemini_generate_content)
              : (PROVIDER_DEFAULT_URLS[providerType] ?? PROVIDER_DEFAULT_URLS.openai)
          }
        />
      </TextField>

      {!SINGLE_FORMAT_TYPES.includes(providerType) && (
        <SettingsSelect
          label={t('settings.provider.apiFormat')}
          value={apiFormat}
          options={
            providerType === 'google'
              ? googleFormatOptions
              : DUAL_FORMAT_TYPES.includes(providerType)
                ? dualFormatOptions
                : formatOptions
          }
          onChange={handleApiFormatChange}
          description={formatDescription}
          fullWidth
        />
      )}

      <div className="flex items-center gap-2">
        <Button onClick={handleSave}>{t('common.save')}</Button>
        {saved && <SavedHint />}
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <TextField fullWidth type="password">
          <Label>{t('settings.provider.apiKey')}</Label>
          <div className="flex gap-2">
            <Input
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
              onClick={handleSaveKey}
              isDisabled={!apiKey.trim() || savingKey || keyStatus === 'loading'}
            >
              {savingKey ? <Spinner className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
              {keySaved ? t('common.saved') : t('settings.provider.saveKey')}
            </Button>
          </div>
        </TextField>
        {keyStatus === 'loading' && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Spinner className="w-3.5 h-3.5" />
            {t('settings.provider.apiKeyChecking')}
          </p>
        )}
        {keyStatus === 'set' && (
          <p className="text-xs text-success-soft-foreground">{t('settings.provider.keySaved')}</p>
        )}
        {keyStatus === 'error' && (
          <p className="text-xs text-warning-soft-foreground">{t('settings.provider.apiKeyCheckFailed')}</p>
        )}
      </div>

      {BALANCE_TYPES.includes(providerType) && (
        <div data-slot="provider-balance" className="border-t border-border pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">{t('settings.provider.balance')}</p>
            <Button variant="outline" onClick={handleFetchBalance} isDisabled={fetchingBalance || keyStatus !== 'set'}>
              <ArrowsRotateRight className={cn('w-3.5 h-3.5', fetchingBalance && 'animate-spin')} />
              {t('settings.provider.checkBalance')}
            </Button>
          </div>
          {balanceError && <p className="text-xs text-danger break-all">{balanceError}</p>}
          {balance && (
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              {!balance.is_available && (
                <p className="text-xs text-danger">{t('settings.provider.balanceUnavailable')}</p>
              )}
              {balance.accounts.map((account) => (
                <div key={account.currency} className="flex items-baseline justify-between gap-2">
                  <span className="text-sm">
                    {account.currency} {account.total.toFixed(2)}
                  </span>
                  {/* The split is the point: a total held up by expiring
                      promotional credit is closer to empty than it looks. */}
                  {account.topped_up != null && account.granted != null && (
                    <span className="text-xs text-muted">
                      {t('settings.provider.balanceSplit', {
                        toppedUp: account.topped_up.toFixed(2),
                        granted: account.granted.toFixed(2),
                      })}
                    </span>
                  )}
                </div>
              ))}
              {balance.accounts.length === 0 && (
                <p className="text-xs text-muted">{t('settings.provider.balanceNoDetail')}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">{t('settings.provider.models')}</p>
          <Button variant="outline" onClick={handleFetchModels} isDisabled={fetchingModels || keyStatus !== 'set'}>
            <ArrowsRotateRight className={cn('w-3.5 h-3.5', fetchingModels && 'animate-spin')} />
            {t('settings.provider.fetchModels')}
          </Button>
        </div>
        {modelsError && <p className="text-xs text-danger break-all">{modelsError}</p>}
        {models.length > 0 && (
          <div
            data-slot="provider-model-list"
            className="h-60 overflow-y-auto overscroll-contain border border-border rounded-lg"
          >
            {models.map((m) => {
              const cfg = modelConfigs.get(m.id)
              const isEditing = editingModelId === m.id
              return (
                <div key={m.id} className="border-b border-border last:border-0">
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className={cn('text-xs', cfg ? 'text-foreground' : 'text-muted')}>
                      {m.name}
                      {/* The dot is decoration; the name it carries is the
                          part a screen reader can use. On its own it was read
                          out as "black circle". */}
                      {cfg && (
                        <>
                          <span aria-hidden className="ml-1.5 text-xs text-success-soft-foreground">
                            ●
                          </span>
                          <span className="sr-only">{t('settings.provider.modelConfigured')}</span>
                        </>
                      )}
                    </span>
                    {/* The only way into a model's settings, at 24px and with no
                        accessible name — the icon swaps between two glyphs and
                        neither says anything. `touch-hitbox` because the `h-6`
                        overrides HeroUI's own mobile-first sizing, which would
                        otherwise have made it 40px here. */}
                    <Button
                      isIconOnly
                      variant="ghost"
                      aria-label={
                        isEditing
                          ? t('settings.provider.closeModelConfig', { model: m.name })
                          : t('settings.provider.editModelConfig', { model: m.name })
                      }
                      className="touch-hitbox h-6 w-6"
                      onClick={() => setEditingModelId(isEditing ? null : m.id)}
                    >
                      {isEditing ? <Xmark className="w-3.5 h-3.5" /> : <Sliders className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  {isEditing && (
                    <ModelConfigEditor
                      providerId={provider.id}
                      modelId={m.id}
                      // Which provider-side tools exist depends on the dialect,
                      // so the capability lookup has to be redone when it
                      // changes — otherwise switching to Responses leaves the
                      // panel insisting this model has none.
                      apiFormat={apiFormat}
                      existing={cfg}
                      onSave={handleSaveModelConfig}
                      onDelete={cfg ? () => handleDeleteModelConfig(cfg.id) : undefined}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
        {models.length === 0 && !fetchingModels && !modelsError && (
          <p className="text-xs text-muted">{t('settings.provider.fetchModelsHint')}</p>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <Button variant="ghost" className="text-danger hover:text-danger" onClick={handleDelete} isDisabled={deleting}>
          {deleting ? <Spinner className="w-3.5 h-3.5" /> : <TrashBin className="w-3.5 h-3.5" />}
          {deleting ? t('settings.provider.deletingProvider') : t('settings.provider.deleteProvider')}
        </Button>
      </div>
      {confirmDialog}
    </div>
  )
}

export function ProviderSettings() {
  const { t } = useTranslation()
  const nav = useMasterDetail()
  const { isNarrow, selectedId } = nav
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const initialized = useRef(false)

  const refresh = useCallback(async () => {
    const list = await api.listProviders()
    setProviders(list)
    return list
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    refresh().then(() => setLoading(false))
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

  const handleCreate = useCallback(async () => {
    const p = await api.createProvider('New Provider', 'openai', 'https://api.openai.com/v1', 'responses')
    await refresh()
    nav.openItem(p.id)
  }, [refresh, nav])

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

  const selected = providers.find((p) => p.id === selectedId)

  const providerList = (
    <>
      {providers.map((p) => (
        <SettingsRow
          key={p.id}
          icon={<Cloud />}
          label={p.name}
          isActive={selectedId === p.id}
          // A list of peers, not a row that opens something else.
          trailing={null}
          onClick={() => nav.openItem(p.id)}
        />
      ))}
      {providers.length === 0 && (
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
            <Button variant="outline" onClick={handleCreate}>
              <Plus className="w-4 h-4" />
              {t('settings.provider.addProvider')}
            </Button>
          </EmptyState.Content>
        </EmptyState>
      )}
    </>
  )

  return (
    <MasterDetail
      nav={nav}
      title={t('settings.provider.title')}
      actions={
        <Tooltip delay={0}>
          <Button isIconOnly aria-label={t('settings.provider.addProvider')} variant="ghost" onClick={handleCreate}>
            <Plus className="w-4 h-4" />
          </Button>
          <Tooltip.Content placement="top">{t('settings.provider.addProvider')}</Tooltip.Content>
        </Tooltip>
      }
      list={providerList}
      detailTitle={selected?.name}
      detail={
        selected ? (
          <ProviderEditor key={selected.id} provider={selected} onUpdate={refresh} onDelete={handleDelete} />
        ) : undefined
      }
      emptyDetail={t('settings.provider.selectProvider')}
    />
  )
}
