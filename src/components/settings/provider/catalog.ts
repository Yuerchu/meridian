import { useEffect, useState } from 'react'
import { api } from '@/api'
import type {
  ProviderApiFormat,
  ProviderCatalogAuthOptionInfoResponse,
  ProviderCatalogEntryInfoResponse,
  ProviderInfoResponse,
  ProviderType,
} from '@/types'

/**
 * Who a provider row is, according to the catalog compiled into the binary.
 *
 * Every lookup here answers "which vendor is this", and every one of them has
 * to survive not knowing: a row pointing at a relay matches nothing, and the
 * panel keeps working from what the row itself holds.
 */

/**
 * The vendor catalog.
 *
 * Deliberately not cached across mounts. It answers from a `LazyLock` over data
 * compiled into the binary — no lock, no disk, no network — so a round trip
 * costs microseconds and a cache would buy nothing while making the value
 * impossible to vary between tests.
 *
 * A failure degrades to an empty catalog rather than throwing: every reader
 * below falls back to what the row already holds, so the panel keeps working
 * without prefills instead of refusing to render.
 */
export function loadProviderCatalog(): Promise<ProviderCatalogEntryInfoResponse[]> {
  return api.listProviderCatalog().catch((err) => {
    console.error('Failed to load the provider catalog:', err)
    return []
  })
}

export function useProviderCatalog(): ProviderCatalogEntryInfoResponse[] {
  const [catalog, setCatalog] = useState<ProviderCatalogEntryInfoResponse[]>([])
  useEffect(() => {
    let cancelled = false
    void loadProviderCatalog().then((entries) => {
      if (!cancelled) setCatalog(entries)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return catalog
}

/**
 * The entry a *type* defaults to — the first one listed under it, catalog order
 * being editorial. This is the right lookup while the type select is being
 * changed, because at that moment the type is all the user has said.
 *
 * It is no longer an identity: Moonshot, SiliconFlow and OpenAI are all
 * `openai`, so this answers "what does picking that type start you from",
 * nothing more. Use {@link entryForRow} for what a row actually is.
 */
export function entryByType(
  catalog: ProviderCatalogEntryInfoResponse[],
  providerType: ProviderType,
): ProviderCatalogEntryInfoResponse | undefined {
  return catalog.find((e) => e.provider_type === providerType)
}

/**
 * The vendor a row names, and only that.
 *
 * `catalog_id` is the answer, but only while the type select still agrees with
 * it: the id is the saved row's and `providerType` is what the form is being
 * edited to, so a row switched from Moonshot to Anthropic must stop being
 * described by Moonshot's entry before it is saved. Switching back restores it,
 * which is the same "the row is the truth until Save" rule the rest of the form
 * follows.
 *
 * `undefined` for a row that names no vendor — a relay, or anything made by
 * hand. That is a real answer rather than a gap, and it is the one
 * {@link balanceEntry} rests on.
 */
export function namedVendor(
  catalog: ProviderCatalogEntryInfoResponse[],
  catalogId: string | null,
  providerType: ProviderType,
): ProviderCatalogEntryInfoResponse | undefined {
  const byId = catalogId ? catalog.find((e) => e.id === catalogId) : undefined
  return byId?.provider_type === providerType ? byId : undefined
}

/**
 * What describes the form: the row's own vendor, or failing that whatever the
 * type defaults to.
 *
 * The fallback is right for sign-ins, dialects and prefills — a relay speaking
 * the OpenAI dialect should be offered the OpenAI dialects, since that is what
 * the dialect *is*. It is wrong for anything that identifies an account, which
 * is why the balance button does not use this.
 */
export function entryForRow(
  catalog: ProviderCatalogEntryInfoResponse[],
  catalogId: string | null,
  providerType: ProviderType,
): ProviderCatalogEntryInfoResponse | undefined {
  return namedVendor(catalog, catalogId, providerType) ?? entryByType(catalog, providerType)
}

/**
 * The entry that decides whether a balance button is drawn — the row's named
 * vendor, with no fallback to the type.
 *
 * Falling back would draw the button on every row of a type some vendor of
 * which publishes a balance: `openai` covers OpenAI, Moonshot, SiliconFlow and
 * every relay, so the type answers for none of them. Refusing to guess costs a
 * hand-made row at a vendor's own address a button it could have had — the
 * backend is more generous there, which is what the daemon needs — and naming
 * the vendor on the row is the fix. The other direction would post the key to
 * an account endpoint whose operator never published one.
 */
export function balanceEntry(
  catalog: ProviderCatalogEntryInfoResponse[],
  catalogId: string | null,
  providerType: ProviderType,
): ProviderCatalogEntryInfoResponse | undefined {
  return namedVendor(catalog, catalogId, providerType)
}

export const PROVIDER_TYPES = new Set<ProviderType>(['openai', 'anthropic', 'deepseek', 'xai', 'google'])

export function requireProviderType(value: string): ProviderType {
  if (!PROVIDER_TYPES.has(value as ProviderType)) throw new Error(`unknown provider type ${JSON.stringify(value)}`)
  return value as ProviderType
}

/**
 * The sign-in option a persisted row is currently under.
 *
 * Keyed by `credential_kind` because that is what the row stores. Once an
 * entry is known, a missing match is corrupt first-party state rather than a
 * request to reinterpret the row under a different login.
 */
export function authFor(
  entry: ProviderCatalogEntryInfoResponse | undefined,
  credentialKind: string,
): ProviderCatalogAuthOptionInfoResponse | undefined {
  if (!entry) return undefined
  const auth = entry.auth.find((candidate) => candidate.credential_kind === credentialKind)
  if (!auth) throw new Error(`unknown credential kind ${JSON.stringify(credentialKind)} for catalog entry ${entry.id}`)
  return auth
}

/**
 * The dialects available under one sign-in option.
 *
 * One element means the dialect is not a choice and the selector is omitted —
 * which is what the old `SINGLE_FORMAT_TYPES` said about Anthropic, and what
 * `DUAL_FORMAT_TYPES` said about xAI and DeepSeek. Stating it as data means the
 * next vendor does not need a third list. Per option rather than per entry,
 * because the Codex login speaks `responses` alone while the key next to it
 * speaks both.
 */
export function formatsFor(auth: ProviderCatalogAuthOptionInfoResponse | undefined): ProviderApiFormat[] {
  return auth?.api_formats ?? []
}

/**
 * The address to prefill for one sign-in option speaking a given dialect.
 *
 * Google used to need its own table because its address changes with the
 * dialect. Here that is just what its data says, and every other vendor happens
 * to map both dialects to one address — so the special case disappears rather
 * than being handled.
 */
export function defaultUrlFor(
  auth: ProviderCatalogAuthOptionInfoResponse | undefined,
  apiFormat: ProviderApiFormat,
): string | undefined {
  const urls = auth?.default_base_url
  if (!urls) return undefined
  return urls[apiFormat] ?? Object.values(urls)[0]
}

export function parseProviderApiFormat(value: string): ProviderApiFormat {
  switch (value) {
    case 'chat_completions':
    case 'responses':
    case 'gemini_generate_content':
    case 'gemma_tool':
      return value
    default:
      throw new Error(`unknown provider API format: ${value}`)
  }
}

export const URL_PLACEHOLDERS: Record<string, string> = {
  gemini_generate_content: 'https://api.example.com',
  chat_completions: 'https://api.example.com/v1',
}

/** Whether this row signs in with a ChatGPT session rather than a key. */
export function usesChatGptLogin(provider: ProviderInfoResponse): boolean {
  return provider.credential_kind === 'codex_cli' || provider.credential_kind === 'chatgpt_oauth'
}

/**
 * Display names for the closed sign-in-kind set. Adding one requires adding
 * its backend resolver and its UI label in the same change.
 */
export const AUTH_METHOD_LABELS: Record<string, string> = {
  api_key: 'settings.provider.authMethodApiKey',
  codex_cli: 'settings.provider.authMethodCodexCli',
  chatgpt_oauth: 'settings.provider.authMethodChatGptOauth',
}

export function authMethodLabel(credentialKind: string): string {
  const label = AUTH_METHOD_LABELS[credentialKind]
  if (!label) throw new Error(`unknown provider credential kind ${JSON.stringify(credentialKind)}`)
  return label
}
