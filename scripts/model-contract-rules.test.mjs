import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bareEntityImports,
  entityTypeAliases,
  forbiddenJsonFallbacks,
  hasCanonicalDecimalCheck,
  isBooleanField,
  isMoneyLeafField,
  rustProductionText,
  rustStructDeclarations,
  rustStructFields,
  rustTauriCommandDeclarations,
  rustTestOnlyFiles,
  seaEntityProblems,
  sqlBoolProblems,
  sqlColumnDefault,
  sqlCreateTableBody,
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
  for (const field of [
    'input_price',
    'total_cost',
    'balance_alert_threshold',
    'amount',
    'window_cost',
    'baseline_cost',
    'usage_min_cost',
    'total_balance',
  ]) {
    assert.equal(isMoneyLeafField(field), true, field)
  }
  for (const field of ['balance', 'billing_mode', 'unpriced_messages', 'pricing_tiers']) {
    assert.equal(isMoneyLeafField(field), false, field)
  }
})

test('a duration or a flag is not an amount however the rest of the name reads', () => {
  // Renaming these away from the domain's own word to satisfy the heuristic
  // costs clarity and buys nothing: neither can hold money.
  for (const field of [
    'balance_interval_minutes',
    'usage_check_interval_minutes',
    'usage_cooldown_minutes',
    'baseline_windows',
    'cost_timeout_secs',
    'balance_watch_enabled',
    'has_balance',
    'is_balance_low',
  ]) {
    assert.equal(isMoneyLeafField(field), false, field)
  }
  // The exclusions must not swallow a real amount that happens to sit beside
  // one of those words.
  for (const field of ['balance_threshold', 'cache_read_price', 'tool_cost']) {
    assert.equal(isMoneyLeafField(field), true, field)
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

// ── SeaORM 一侧 ────────────────────────────────────────────────────────────────

const SNAPSHOT = `-- header
CREATE TABLE "providers" ( "id" text NOT NULL PRIMARY KEY, "api_format" text NOT NULL DEFAULT 'chat_completions', "sort_order" integer NOT NULL DEFAULT 0, "catalog_id" text );

CREATE TABLE "model_configs" ( "id" text NOT NULL PRIMARY KEY, "input_price" text, "output_price" text, CHECK (input_price IS NULL OR input_price = '0' OR (
            typeof(input_price) = 'text'
            AND input_price NOT GLOB '*[^0-9.]*'
        )), CHECK (output_price IS NULL OR output_price = '0' OR (
            length(output_price) > 0
        )) );

CREATE INDEX "idx" ON "model_configs" ("input_price");
`

test('a CREATE TABLE body is cut by quote-aware paren matching, across lines', () => {
  const body = sqlCreateTableBody(SNAPSHOT, 'model_configs')
  assert.ok(body.startsWith(' "id" text NOT NULL PRIMARY KEY'))
  // The `(` inside '*[^0-9.]*' and the `)` closing a CHECK must not end the body early.
  assert.ok(body.trimEnd().endsWith('length(output_price) > 0\n        ))'))
  assert.equal(sqlCreateTableBody(SNAPSHOT, 'messages'), null)
})

test('the canonical decimal CHECK needs the text column, the NULL / zero arms and the typeof guard', () => {
  const body = sqlCreateTableBody(SNAPSHOT, 'model_configs')
  assert.equal(hasCanonicalDecimalCheck(body, 'input_price'), true)
  // output_price has a CHECK but no `typeof(...) = 'text'`: a REAL 0.5 would pass it.
  assert.equal(hasCanonicalDecimalCheck(body, 'output_price'), false)
  assert.equal(hasCanonicalDecimalCheck(body, 'cache_read_price'), false)
})

test('a column default is read without its quotes, and a column without one is null', () => {
  const body = sqlCreateTableBody(SNAPSHOT, 'providers')
  assert.equal(sqlColumnDefault(body, 'api_format'), 'chat_completions')
  assert.equal(sqlColumnDefault(body, 'sort_order'), '0')
  assert.equal(sqlColumnDefault(body, 'catalog_id'), null)
  assert.equal(sqlColumnDefault(body, 'missing'), null)
})

test('production text keeps offsets and drops test modules, test functions, strings and comments', () => {
  const source = `use sea_orm::Statement; // Statement::from_string in a comment
fn live() { let _ = "Statement::from_string"; }
#[cfg(test)]
mod tests { fn t() { Statement::from_string(x); } }
#[tokio::test]
async fn gated() { Statement::from_sql_and_values(x); }
fn tail() { conn.execute_unprepared(sql); }`
  const text = rustProductionText(source)
  assert.equal(text.length, source.length)
  assert.equal(/Statement::from_string|from_sql_and_values/.test(text), false)
  assert.equal(/execute_unprepared\(/.test(text), true)
})

test('whole-file test code is the tests.rs / *_tests.rs names and what a cfg(test) mod declares', () => {
  const files = {
    'core/src/db/sea/mod.rs': '#[cfg(test)]\nmod poc;\npub mod bridge;',
    'core/src/db/sea/poc.rs': '',
    'core/src/db/sea/bridge.rs': '',
    'core/src/db/sea/bridge_tests.rs': '',
    'core/src/db/sea/tests.rs': '',
    'core/src/agent.rs': '#[cfg(test)] mod fixtures;',
  }
  const set = rustTestOnlyFiles(Object.keys(files), (path) => files[path])
  assert.deepEqual([...set].filter((path) => path in files).sort(), [
    'core/src/db/sea/bridge_tests.rs',
    'core/src/db/sea/poc.rs',
    'core/src/db/sea/tests.rs',
  ])
  assert.equal(set.has('core/src/agent/fixtures.rs'), true, 'a non-mod.rs parent declares into its own directory')
  assert.equal(set.has('core/src/db/sea/bridge.rs'), false)
})

test('a bare entity item import is found, a module import or a same-named non-entity item is not', () => {
  const flagged = rustProductionText(`
    use crate::db::entity::conversation::{Entity, Model as ConvModel};
    use meridian_core::db::entity::provider::ActiveModel;
  `)
  assert.deepEqual(
    bareEntityImports(flagged).map(({ item, path }) => [item, path]),
    [
      ['Entity', 'crate::db::entity::conversation::Entity'],
      ['Model', 'crate::db::entity::conversation::Model'],
      ['ActiveModel', 'meridian_core::db::entity::provider::ActiveModel'],
    ],
  )
  const fine = rustProductionText(`
    use crate::db::entity::{conversation, provider};
    use super::introspect::{Column, ForeignKey};
    use sea_orm::entity::prelude::*;
    #[cfg(test)]
    mod tests { use crate::db::entity::conversation::Model; }
  `)
  assert.deepEqual(bareEntityImports(fine), [])
})

test('an alias for an entity type is found wherever it is written', () => {
  const text = rustProductionText(`
    pub type Conversation = crate::db::entity::conversation::Entity;
    type Row = conversation::Model;
    pub(crate) type Active<'a> = conversation::ActiveModel;
    pub type Pool = sea_orm::DatabaseConnection;
    type ListResponse = Vec<ConversationInfoResponse>;
  `)
  assert.deepEqual(
    entityTypeAliases(text).map(({ name, target }) => [name, target]),
    [
      ['Conversation', 'crate::db::entity::conversation::Entity'],
      ['Row', 'conversation::Model'],
      ['Active', 'conversation::ActiveModel'],
    ],
  )
})

test('an entity Model obeys the column type rules, and a correct one has no findings', () => {
  const good = `
    use sea_orm::entity::prelude::*;
    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "model_configs")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub input_price: Option<Decimal>,
        pub is_enabled: SqlBool,
        pub auto_compact_enabled: Option<crate::db::types::SqlBool>,
        pub created_at: EpochMs,
        pub deleted_at: Option<EpochMs>,
        pub temperature: Option<f64>,
    }
    #[derive(DerivePartialModel)]
    #[sea_orm(entity = "Entity")]
    pub struct TitleProjection { pub id: String }
  `
  assert.deepEqual(seaEntityProblems(good), [])

  const bad = `
    #[derive(Clone, Debug, DeriveEntityModel, serde::Serialize)]
    #[sea_orm(table_name = "model_configs")]
    pub struct Model {
        pub input_price: Option<f64>,
        pub is_enabled: i32,
        pub has_model: bool,
        pub created_at: Option<i64>,
        pub archived: bool,
    }
    #[derive(DerivePartialModel)]
    pub struct Title { pub id: String }
    #[derive(Deserialize)]
    pub struct ActiveModel {}
  `
  assert.deepEqual(seaEntityProblems(bad), [
    'Model 不得派生 Serialize / Deserialize：实体不是 wire 契约，经 InfoResponse 出去',
    'Model.input_price 是金额列，必须是 Decimal / Option<Decimal>，当前为 Option<f64>',
    'Model.is_enabled 是 0/1 标志列，必须是 SqlBool / Option<SqlBool>，当前为 i32',
    'Model.has_model 是 0/1 标志列，必须是 SqlBool / Option<SqlBool>，当前为 bool',
    'Model.created_at 是时间列，必须是 EpochMs / Option<EpochMs>，当前为 Option<i64>',
    'Model.archived 不得用 bool：sqlx 把任何非零整数读成 true，用 SqlBool',
    'Title 派生了 DerivePartialModel，名字必须以 Projection 结尾',
    'ActiveModel 不得派生 Serialize / Deserialize：实体不是 wire 契约，经 InfoResponse 出去',
  ])
})

test('SqlBool::from_stored has to be exactly the three arms', () => {
  const header = 'pub type EpochMs = i64;\npub struct SqlBool(bool);\nimpl SqlBool {\n'
  const strict = `${header}    fn from_stored(raw: i32) -> Option<Self> {
        match raw {
            0 => Some(Self::FALSE),
            1 => Some(Self::TRUE),
            _ => None,
        }
    }
}`
  assert.deepEqual(sqlBoolProblems(strict), [])
  const lenient = strict.replace('_ => None', '_ => Some(Self::TRUE)')
  assert.match(
    sqlBoolProblems(lenient)[0],
    /必须恰好是 0 => .*当前为 0 => Some\(Self::FALSE\)；1 => Some\(Self::TRUE\)；_ => Some\(Self::TRUE\)/,
  )
  const extra = strict.replace('            1 =>', '            2 => Some(Self::TRUE),\n            1 =>')
  assert.equal(sqlBoolProblems(extra).length, 1)
  assert.match(sqlBoolProblems(strict.replace('pub struct SqlBool(bool);', ''))[0], /缺少 SeaORM 侧/)
  assert.match(sqlBoolProblems(`${header}}`)[0], /缺少 fn from_stored/)
})
