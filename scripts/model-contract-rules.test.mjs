import assert from 'node:assert/strict'
import test from 'node:test'

import {
  forbiddenJsonFallbacks,
  isBooleanField,
  isMoneyLeafField,
  rustStructDeclarations,
  rustStructFields,
  rustTauriCommandDeclarations,
  typescriptInterfaceFieldDeclarations,
  typescriptInterfaceFields,
} from './model-contract-rules.mjs'

test('extracts Rust fields without truncating nested generic types', () => {
  const source = `
    /// A whole-struct comparison in prose must not become a declaration.
    #[derive(Debug, serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    pub struct McpServerUpdateRequest {
      #[serde(default)]
      env: Option<Option<BTreeMap<String, String>>>,
      args: Option<Option<Vec<String>>>,
    }
  `
  assert.deepEqual(
    [...rustStructFields(source, 'McpServerUpdateRequest')],
    [
      ['env', 'Option<Option<BTreeMap<String, String>>>'],
      ['args', 'Option<Option<Vec<String>>>'],
    ],
  )
  assert.deepEqual(rustStructDeclarations(source), [
    {
      attributes: '#[derive(Debug, serde::Deserialize)]\n    #[serde(deny_unknown_fields)]\n    ',
      isPublic: true,
      name: 'McpServerUpdateRequest',
    },
  ])
  assert.equal(rustStructFields(source, 'comparison'), null)
})

test('extracts TypeScript fields through comments and nested object braces', () => {
  const source = `
    export interface ExampleInfoResponse {
      /** The provider's object; braces in prose { do not end the interface. } */
      env: Record<string, string> | null
      values?: string[] | null
    }
  `
  assert.deepEqual(
    [...typescriptInterfaceFields(source, 'ExampleInfoResponse')],
    [
      ['env', 'Record<string, string> | null'],
      ['values', 'string[] | null'],
    ],
  )
  assert.deepEqual(
    [...typescriptInterfaceFieldDeclarations(source, 'ExampleInfoResponse')],
    [
      ['env', { optional: false, type: 'Record<string, string> | null' }],
      ['values', { optional: true, type: 'string[] | null' }],
    ],
  )
})

test('extracts Tauri command parameters without splitting generic types', () => {
  const source = `
    #[tauri::command]
    pub async fn create_example(
      app: tauri::AppHandle,
      request: ExampleCreateRequest,
      state: tauri::State<'_, BTreeMap<String, String>>,
    ) -> Result<(), String> {
      Ok(())
    }
  `
  assert.deepEqual(rustTauriCommandDeclarations(source), [
    {
      name: 'create_example',
      parameters: [
        { name: 'app', type: 'tauri::AppHandle' },
        { name: 'request', type: 'ExampleCreateRequest' },
        { name: 'state', type: "tauri::State<'_, BTreeMap<String, String>>" },
      ],
    },
  ])
})

test('finds a Tauri command through long instrumentation attributes', () => {
  const padding = 'field_name = tracing::field::Empty,\n'.repeat(20)
  const source = `
#[tauri::command]
#[tracing::instrument(skip_all, fields(${padding}))]
pub async fn chat(app: tauri::AppHandle, request: ChatRequest) -> Result<(), String> {
    Ok(())
}`

  assert.deepEqual(rustTauriCommandDeclarations(source), [
    {
      name: 'chat',
      parameters: [
        { name: 'app', type: 'tauri::AppHandle' },
        { name: 'request', type: 'ChatRequest' },
      ],
    },
  ])
})

test('recognises monetary leaves but not capability or accounting metadata', () => {
  for (const field of ['input_price', 'total_cost', 'balance_alert_threshold', 'amount']) {
    assert.equal(isMoneyLeafField(field), true, field)
  }
  for (const field of ['balance', 'billing_mode', 'unpriced_messages', 'pricing_tiers']) {
    assert.equal(isMoneyLeafField(field), false, field)
  }
})

test('recognises public boolean field conventions', () => {
  for (const field of [
    'is_enabled',
    'has_model',
    'can_retry_without_sandbox',
    'supports_tools',
    'thinking_enabled',
    'accept_edits',
    'fast_mode',
    'opted_out',
    'retry_without_sandbox',
    'truncated',
  ]) {
    assert.equal(isBooleanField(field), true, field)
  }
  for (const field of ['enabled_tools', 'sort_order', 'island', 'supports']) {
    assert.equal(isBooleanField(field), false, field)
  }
})

test('finds malformed JSON fallbacks to empty/default values', () => {
  const source = `
    let a = serde_json::from_str::<Value>(arguments).unwrap_or_default();
    let b = serde_json::from_str::<Value>(arguments)
      .ok()
      .and_then(read)
      .unwrap_or_default();
    let c = serde_json::from_value(value).unwrap_or_else(|_| json!({}));
    let d = serde_json::from_slice(bytes).unwrap_or(Value::Null);
  `
  assert.equal(forbiddenJsonFallbacks(source).length, 4)
})

test('does not reject explicit errors or non-contract optional probes', () => {
  const source = `
    let value = serde_json::from_str::<Wire>(raw).map_err(|error| error.to_string())?;
    let owner = serde_json::from_str::<Value>(raw).ok().and_then(read_generation);
    let values = maybe.map(|value| serde_json::from_value(value).unwrap()).unwrap_or_default();
  `
  assert.deepEqual(forbiddenJsonFallbacks(source), [])
})
