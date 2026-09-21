import type { ProviderCatalogEntryInfoResponse, ProviderInfoResponse } from '@/types'
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
  usesChatGptLogin,
} from './catalog'

const entry = (over: Partial<ProviderCatalogEntryInfoResponse>): ProviderCatalogEntryInfoResponse => ({
  id: 'openai',
  provider_type: 'openai',
  name: 'OpenAI',
  icon: 'openai',
  balance: false,
  websites: { official: '', api_key: '', docs: '', models: '' },
  auth: [],
  models: [],
  ...over,
})

const CATALOG = [
  entry({
    id: 'openai',
    name: 'OpenAI',
    auth: [
      {
        id: 'api_key',
        credential_kind: 'api_key',
        transport_profile: 'standard',
        label: null,
        api_formats: ['responses', 'chat_completions'],
        default_base_url: { responses: 'https://api.openai.com/v1', chat_completions: 'https://api.openai.com/v1' },
      },
      {
        id: 'codex_cli',
        credential_kind: 'codex_cli',
        transport_profile: 'codex',
        label: 'Codex CLI',
        api_formats: ['responses'],
        default_base_url: { responses: 'https://chatgpt.com/backend-api/codex' },
      },
    ],
  }),
  entry({ id: 'moonshot', name: 'Moonshot', balance: true }),
  entry({ id: 'anthropic', provider_type: 'anthropic', name: 'Anthropic' }),
]

/**
 * Four vendors share the `openai` type — OpenAI itself, Moonshot, SiliconFlow
 * and every relay — so the type cannot answer "whose service is this". Which of
 * these lookups falls back to the type and which refuses to is the whole
 * distinction, and getting it backwards either hides a working feature or posts
 * a key at an endpoint its operator never published.
 */
describe('catalog lookups', () => {
  it('describes a row by its own vendor, and falls back to the type for the rest', () => {
    expect(entryForRow(CATALOG, 'moonshot', 'openai')?.name).toBe('Moonshot')
    // No id: the type's first entry is a good enough source of dialects and
    // prefills, which is all `entryForRow` feeds.
    expect(entryForRow(CATALOG, null, 'openai')?.name).toBe('OpenAI')
    expect(entryByType(CATALOG, 'anthropic')?.name).toBe('Anthropic')
  })

  /**
   * The id is the saved row's and the type is what the form is being edited to.
   * A row switched from Moonshot to Anthropic stops being Moonshot before it is
   * saved, and switching back restores it — the same "the row is the truth
   * until Save" rule the rest of the form follows.
   */
  it('stops believing an id the type no longer agrees with', () => {
    expect(entryForRow(CATALOG, 'moonshot', 'anthropic')?.name).toBe('Anthropic')
    expect(balanceEntry(CATALOG, 'moonshot', 'anthropic')).toBeUndefined()
  })

  it('draws the balance button only for a row that names its vendor', () => {
    expect(balanceEntry(CATALOG, 'moonshot', 'openai')?.balance).toBe(true)
    // A relay, or anything made by hand. Refusing costs it a button it might
    // have had; guessing would post the key to somebody else's account endpoint.
    expect(balanceEntry(CATALOG, null, 'openai')).toBeUndefined()
  })
})

describe('sign-in options', () => {
  it('reads the dialects and the address off the option, not the vendor', () => {
    const openai = entryByType(CATALOG, 'openai')
    expect(formatsFor(authFor(openai, 'api_key'))).toEqual(['responses', 'chat_completions'])
    // The Codex login speaks one dialect while the key beside it speaks two,
    // which is why this is per option rather than per entry.
    expect(formatsFor(authFor(openai, 'codex_cli'))).toEqual(['responses'])
    expect(defaultUrlFor(authFor(openai, 'codex_cli'), 'responses')).toBe('https://chatgpt.com/backend-api/codex')
  })

  it('answers with nothing for a vendor the catalog does not describe', () => {
    expect(authFor(undefined, 'api_key')).toBeUndefined()
    expect(formatsFor(undefined)).toEqual([])
    expect(defaultUrlFor(undefined, 'responses')).toBeUndefined()
  })

  /**
   * A credential kind the entry does not list is a row the catalog and the
   * database disagree about. Answering `undefined` would draw a key field for a
   * login that has no key.
   */
  it('refuses a credential kind its vendor does not offer', () => {
    expect(() => authFor(entryByType(CATALOG, 'anthropic'), 'codex_cli')).toThrow(/unknown credential kind/)
  })

  it('knows which rows sign in with a session rather than a key', () => {
    const provider = (credentialKind: string) => ({ credential_kind: credentialKind }) as ProviderInfoResponse
    expect(usesChatGptLogin(provider('codex_cli'))).toBe(true)
    expect(usesChatGptLogin(provider('api_key'))).toBe(false)
  })
})

/** Unknown values are a contract error, not a default to fall back to. */
describe('strict decoders', () => {
  it('accepts the four dialects and nothing else', () => {
    for (const format of ['chat_completions', 'responses', 'gemini_generate_content', 'gemma_tool']) {
      expect(parseProviderApiFormat(format)).toBe(format)
    }
    expect(() => parseProviderApiFormat('grpc')).toThrow(/unknown provider API format/)
  })

  it('accepts the five provider types and nothing else', () => {
    expect(requireProviderType('anthropic')).toBe('anthropic')
    expect(() => requireProviderType('vertex')).toThrow(/unknown provider type/)
  })

  it('names every credential kind it can be given', () => {
    expect(authMethodLabel('api_key')).toBeTruthy()
    expect(() => authMethodLabel('smartcard')).toThrow()
  })
})
