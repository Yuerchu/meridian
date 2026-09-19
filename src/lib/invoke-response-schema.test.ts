import { INVOKE_RESPONSE_SCHEMA_COMMAND_COUNT, invokeResponseSchemaDocument } from './invoke-response-schema.generated'
import { assertInvokeResponse } from './invoke-response-schema'

function validate(command: string, value: unknown, args?: Record<string, unknown>) {
  assertInvokeResponse(command, args, value)
}

describe('invoke response schema', () => {
  it('covers every invoke declared by api.ts', () => {
    expect(INVOKE_RESPONSE_SCHEMA_COMMAND_COUNT).toBe(223)
    expect(Object.keys(invokeResponseSchemaDocument.commands)).toHaveLength(223)
    expect(() => validate('toString', 'prototype value')).toThrow('No response schema is registered')
  })

  it('validates void and primitive responses instead of trusting a generic', () => {
    expect(() => validate('update_conversation_title', null)).not.toThrow()
    expect(() => validate('delete_secret', true)).not.toThrow()
    expect(() => validate('acp_open_session', 'session-1')).not.toThrow()
    expect(() => validate('voice_probe_echo', 42)).not.toThrow()

    expect(() => validate('update_conversation_title', undefined)).toThrow('must be null')
    expect(() => validate('delete_secret', 1)).toThrow('must be a boolean')
    expect(() => validate('voice_probe_echo', Number.NaN)).toThrow('must be a finite number')
  })

  it('rejects missing and unknown fields in nested entity responses', () => {
    const insets = { top: 0, right: 0, bottom: 12, left: 0, imeBottom: 12 }
    expect(() => validate('get_window_insets', insets)).not.toThrow()
    expect(() => validate('get_window_insets', { ...insets, future: true })).toThrow('unknown field "future"')

    const { bottom: _bottom, ...missing } = insets
    expect(() => validate('get_window_insets', missing)).toThrow('bottom must be present')
  })

  it('keeps closed enums closed', () => {
    expect(() => validate('get_platform', 'windows')).not.toThrow()
    expect(() => validate('get_platform', 'unknown')).toThrow('does not match any allowed shape')
  })

  it('requires canonical decimal strings throughout nullable nested responses', () => {
    const balance = {
      is_available: true,
      accounts: [
        {
          currency: 'USD',
          total_balance: '12.34',
          granted_balance: null,
          topped_up_balance: '0',
        },
      ],
    }
    expect(() => validate('get_provider_balance', balance)).not.toThrow()
    expect(() => validate('get_provider_balance', null)).not.toThrow()
    expect(() =>
      validate('get_provider_balance', {
        ...balance,
        accounts: [{ ...balance.accounts[0], total_balance: '012.34' }],
      }),
    ).toThrow('canonical decimal string')
    expect(() =>
      validate('get_provider_balance', {
        ...balance,
        accounts: [{ ...balance.accounts[0], total_balance: 12.34 }],
      }),
    ).toThrow('canonical decimal string')
  })

  it('allows omitted optional fields but validates them when present', () => {
    const model = {
      id: 'config-1',
      provider_id: 'provider-1',
      model_id: 'model-1',
      display_name: null,
      context_window: 128_000,
      compact_threshold: 100_000,
      max_output_tokens: null,
      input_price: '1.25',
      output_price: '2.5',
      cache_read_price: null,
      cache_write_price: null,
      created_at: 1,
      updated_at: 1,
      capability_overrides: { supports_tools: true },
      pricing_tiers: [],
      server_tools: null,
      server_tool_price: null,
    }
    expect(() => validate('get_model_config', model)).not.toThrow()
    expect(() =>
      validate('get_model_config', {
        ...model,
        capability_overrides: { supports_tools: true, supports_pdf: undefined },
      }),
    ).toThrow('must be a boolean')
    expect(() =>
      validate('get_model_config', {
        ...model,
        capability_overrides: { supports_tools: true, future: true },
      }),
    ).toThrow('unknown field "future"')
  })

  it('validates recursive JsonValue and string-keyed records without accepting non-JSON values', () => {
    const tool = {
      server_id: 'server-1',
      server_name: 'docs',
      qualified_name: 'docs.search',
      name: 'search',
      description: 'Search docs',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    }
    expect(() => validate('list_mcp_tools', [tool])).not.toThrow()
    expect(() => validate('list_mcp_tools', [{ ...tool, input_schema: { value: undefined } }])).toThrow(
      'must be a JSON value',
    )

    const sparse = Array.from({ length: 1 })
    delete sparse[0]
    expect(() => validate('list_mcp_tools', sparse)).toThrow('dense JSON array')

    const customTool = {
      id: 'tool-1',
      name: 'lookup',
      description: 'Lookup',
      category_id: null,
      parameters_schema: { type: 'object', required: ['query'] },
      command: 'lookup',
      args_template: null,
      working_directory: null,
      timeout_ms: null,
      permission: 'ask',
      is_enabled: true,
      sort_order: 0,
      created_at: 1,
      updated_at: 1,
    }
    expect(() => validate('list_custom_tools', [customTool])).not.toThrow()
    expect(() => validate('list_custom_tools', [{ ...customTool, parameters_schema: { invalid: 1n } }])).toThrow(
      'must be a JSON value',
    )
  })

  it('correlates get_preference response key and value type with the request key', () => {
    const shellArgs = { request: { key: 'shell' } }
    expect(() => validate('get_preference', { key: 'shell', value: 'cmd' }, shellArgs)).not.toThrow()
    expect(() => validate('get_preference', { key: 'shell', value: null }, shellArgs)).not.toThrow()
    expect(() => validate('get_preference', { key: 'shell', value: 'auto' }, shellArgs)).toThrow(
      'does not match any allowed shape',
    )
    expect(() => validate('get_preference', { key: 'sandbox.enabled', value: 'auto' }, shellArgs)).toThrow(
      'must equal requested key',
    )
    expect(() => validate('get_preference', { key: 'shell', value: 'cmd', future: true }, shellArgs)).toThrow(
      'exact object',
    )

    const modelArgs = { request: { key: 'autoreview.model' } }
    expect(() =>
      validate('get_preference', { key: 'autoreview.model', value: { provider_id: 'p1', model_id: 'm1' } }, modelArgs),
    ).not.toThrow()
    expect(() =>
      validate(
        'get_preference',
        { key: 'autoreview.model', value: { provider_id: 'p1', model_id: 'm1', future: true } },
        modelArgs,
      ),
    ).toThrow('unknown field "future"')
  })
})
