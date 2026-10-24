import {
  assistantsUnsupportedByModel,
  assistantsWithModelConflicts,
  boundAssistantConflicts,
} from './assistant-model-lock'

describe('boundAssistantConflicts', () => {
  it('allows a blank override and a limit inside the window', () => {
    expect(
      boundAssistantConflicts({
        contextLimit: 0,
        thinkingEnabled: false,
        maxTokens: null,
        modelWindow: 128_000,
        maxOutput: 32_768,
        supportsThinking: true,
      }),
    ).toEqual([])
    expect(
      boundAssistantConflicts({
        contextLimit: 64_000,
        thinkingEnabled: false,
        maxTokens: null,
        modelWindow: 128_000,
        maxOutput: 32_768,
        supportsThinking: true,
      }),
    ).toEqual([])
  })

  it('names a context override that is larger than the model window', () => {
    expect(
      boundAssistantConflicts({
        contextLimit: 1_000_000,
        thinkingEnabled: false,
        maxTokens: null,
        modelWindow: 128_000,
        maxOutput: null,
        supportsThinking: null,
      }),
    ).toEqual(['context'])
  })

  it('does not invent a ceiling when the window is unknown', () => {
    expect(
      boundAssistantConflicts({
        contextLimit: 1_000_000,
        thinkingEnabled: true,
        maxTokens: 64_000,
        modelWindow: null,
        maxOutput: null,
        supportsThinking: null,
      }),
    ).toEqual([])
  })

  it('names thinking that the model cannot do, and an output ceiling above the model', () => {
    expect(
      boundAssistantConflicts({
        contextLimit: 0,
        thinkingEnabled: true,
        maxTokens: 64_000,
        modelWindow: 128_000,
        maxOutput: 32_768,
        supportsThinking: false,
      }),
    ).toEqual(['output', 'thinking'])
  })
})

describe('assistantsUnsupportedByModel', () => {
  const elegy = {
    name: 'Elegy',
    provider_id: 'p1',
    model_id: 'gemma',
    context_limit: 1_000_000,
    thinking_enabled: true,
    max_tokens: null,
  }

  it('only lists assistants bound to this provider and model', () => {
    const other = { ...elegy, name: 'Other', provider_id: 'p2' }
    expect(
      assistantsUnsupportedByModel([elegy, other], 'p1', 'gemma', {
        contextWindow: 128_000,
        maxOutput: null,
        supportsThinking: true,
      }),
    ).toEqual([elegy])
  })
})

describe('assistantsWithModelConflicts', () => {
  const elegy = {
    name: 'Elegy',
    provider_id: 'p1',
    model_id: 'gemma',
    context_limit: 1_000_000,
    thinking_enabled: true,
    max_tokens: null,
  }

  it('names every reason one assistant does not fit', () => {
    expect(
      assistantsWithModelConflicts([elegy], 'p1', 'gemma', {
        contextWindow: 128_000,
        maxOutput: 32_768,
        supportsThinking: false,
      }),
    ).toEqual([{ assistant: elegy, conflicts: ['context', 'thinking'] }])
  })

  it('leaves a compatible assistant out entirely', () => {
    const quiet = { ...elegy, name: 'Quiet', context_limit: 64_000, thinking_enabled: false }
    expect(
      assistantsWithModelConflicts([quiet], 'p1', 'gemma', {
        contextWindow: 128_000,
        maxOutput: null,
        supportsThinking: true,
      }),
    ).toEqual([])
  })
})
