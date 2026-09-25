#!/usr/bin/env node
/**
 * Architecture guard for Meridian's model/DTO contract.
 *
 * It intentionally checks syntax-level invariants rather than business rules:
 * layer-specific persistence names, strict first-party request objects, and
 * exact monetary representations. Runtime tests still own semantic validation.
 *
 *   pnpm contracts:check
 *   pnpm contracts:check:staged
 */
import { Buffer } from 'node:buffer'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stagedSnapshot } from './staged-snapshot.mjs'
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STAGED = process.argv.includes('--staged')
const problems = []

const slash = (path) => path.replaceAll('\\', '/')
// Core sources sit in the meridian-core submodule; "staged" there means the
// commit the outer index points at. See staged-snapshot.mjs.
const snapshot = STAGED ? stagedSnapshot(ROOT) : null

function readAt(path) {
  if (!STAGED) return readFileSync(join(ROOT, path), 'utf8')
  return snapshot.read(path)
}

function filesUnder(path, extensions) {
  if (STAGED) {
    return snapshot.list(path).filter((file) => extensions.some((extension) => file.endsWith(extension)))
  }
  const files = []
  const visit = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (extensions.some((extension) => entry.name.endsWith(extension))) files.push(slash(relative(ROOT, child)))
    }
  }
  visit(join(ROOT, path))
  return files
}

function add(file, message) {
  problems.push(`${file}: ${message}`)
}

try {
  const generatorFile = 'scripts/generate-invoke-response-schema.mjs'
  const generatorSource = STAGED ? readAt(generatorFile) : null
  if (STAGED && generatorSource == null) throw new Error(`${generatorFile} is missing from the staged snapshot`)
  const generatorUrl = STAGED
    ? `data:text/javascript;base64,${Buffer.from(generatorSource.replace(/^#![^\n]*\n/, '')).toString('base64')}`
    : new URL('./generate-invoke-response-schema.mjs', import.meta.url).href
  const generator = await import(generatorUrl)
  if (typeof generator.runInvokeResponseSchemaGenerator !== 'function') {
    throw new Error(`${generatorFile} must export runInvokeResponseSchemaGenerator`)
  }
  generator.runInvokeResponseSchemaGenerator({ root: ROOT, check: true, staged: STAGED })
} catch (error) {
  add('src/lib/invoke-response-schema.generated.ts', String(error).trim())
}

function requireRustFields(file, structName, expected) {
  const source = readAt(file)
  const fields = source == null ? null : rustStructFields(source, structName)
  if (fields == null) {
    add(file, `缺少契约结构 ${structName}`)
    return
  }
  for (const [field, allowed] of Object.entries(expected)) {
    const actual = fields.get(field)
    if (actual == null) add(file, `${structName} 缺少 ${field}`)
    else if (!allowed.test(actual)) add(file, `${structName}.${field} 类型不符合硬契约，当前为 ${actual}`)
  }
}

function requireTypescriptFields(file, interfaceName, expected) {
  const source = readAt(file)
  const fields = source == null ? null : typescriptInterfaceFields(source, interfaceName)
  if (fields == null) {
    add(file, `缺少契约接口 ${interfaceName}`)
    return
  }
  for (const [field, allowed] of Object.entries(expected)) {
    const actual = fields.get(field)
    if (actual == null) add(file, `${interfaceName} 缺少 ${field}`)
    else if (!allowed.test(actual)) add(file, `${interfaceName}.${field} 类型不符合硬契约，当前为 ${actual}`)
  }
}

function requireTypescriptRequiredFields(file, interfaceName, fieldNames) {
  const source = readAt(file)
  const fields = source == null ? null : typescriptInterfaceFieldDeclarations(source, interfaceName)
  if (fields == null) {
    add(file, `缺少契约接口 ${interfaceName}`)
    return
  }
  for (const field of fieldNames) {
    const declaration = fields.get(field)
    if (declaration == null) add(file, `${interfaceName} 缺少 ${field}`)
    else if (declaration.optional) {
      add(file, `${interfaceName}.${field} 必须是 required key；nullable 只能用显式 null 表达`)
    }
  }
}

function requireTypescriptOptionalFields(file, interfaceName, fieldNames) {
  const source = readAt(file)
  const fields = source == null ? null : typescriptInterfaceFieldDeclarations(source, interfaceName)
  if (fields == null) {
    add(file, `缺少契约接口 ${interfaceName}`)
    return
  }
  for (const field of fieldNames) {
    const declaration = fields.get(field)
    if (declaration == null) add(file, `${interfaceName} 缺少 ${field}`)
    else if (!declaration.optional) add(file, `${interfaceName}.${field} 是 patch 字段，必须保持 optional`)
  }
}

function requireTypescriptStringKeyedFields(file, interfaceName, expected) {
  const source = readAt(file)
  const body = source?.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\b[^\\{]*\\{([\\s\\S]*?)\\n\\}`))?.[1]
  if (body == null) {
    add(file, `缺少契约接口 ${interfaceName}`)
    return
  }
  const fields = new Map()
  for (const match of body.matchAll(/^\s*(?:(\w+)|['"]([^'"]+)['"])\??\s*:\s*([^;\r\n]+);?\s*$/gm)) {
    fields.set(match[1] ?? match[2], match[3].replace(/\s+/g, ' ').trim())
  }
  for (const [field, allowed] of Object.entries(expected)) {
    const actual = fields.get(field)
    if (actual == null) add(file, `${interfaceName} 缺少 ${field}`)
    else if (!allowed.test(actual)) add(file, `${interfaceName}.${field} 类型不符合硬契约，当前为 ${actual}`)
  }
}

function requireRustFunctionArgument(file, functionName, field, allowed) {
  const source = readAt(file)
  const declaration =
    source == null ? null : rustTauriCommandDeclarations(source).find(({ name }) => name === functionName)
  const actual = declaration?.parameters.find(({ name }) => name === field)?.type
  if (actual == null) add(file, `${functionName} 缺少结构化参数 ${field}`)
  else if (!allowed.test(actual)) add(file, `${functionName}.${field} 不得以 JSON String 暴露，当前为 ${actual}`)

  const businessParameters = declaration?.parameters.filter(({ name, type }) => {
    if (/^(?:app|state|window|webview_window)$/.test(name)) return false
    return !/\btauri::(?:AppHandle|State|Window|WebviewWindow)\b/.test(type)
  })
  if (businessParameters != null && (businessParameters.length !== 1 || businessParameters[0]?.name !== field)) {
    add(file, `${functionName} 必须只接收名为 ${field} 的单一业务 DTO`)
  }
}

const modelFiles = filesUnder('src-tauri/crates/core/src/db/models', ['.rs'])
for (const file of modelFiles) {
  const source = readAt(file)
  if (source == null) continue

  for (const match of source.matchAll(
    /^(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)(?:<[^>]+>)?\s*=\s*(?:[\w:]+::)?(\w+(?:Row|Insert|Changeset))(?:<[^>]+>)?;/gm,
  )) {
    add(file, `禁止 persistence 兼容别名 ${match[1]} = ${match[2]}`)
  }

  for (const declaration of rustStructDeclarations(source)) {
    const { attributes, name } = declaration
    const queryable = /\b(?:Queryable|QueryableByName|Selectable|Identifiable)\b/.test(attributes)
    const insertable = /\bInsertable\b/.test(attributes)
    const changeset = /\bAsChangeset\b/.test(attributes)
    const roles = Number(queryable) + Number(insertable) + Number(changeset)
    if (roles > 1) add(file, `${name} 同时承担多个 persistence 角色，请拆成 Row / Insert / Changeset`)
    if (queryable && !name.endsWith('Row')) add(file, `持久化行 ${name} 必须以 Row 结尾`)
    if (insertable && !name.endsWith('Insert')) add(file, `持久化新增类型 ${name} 必须以 Insert 结尾`)
    if (changeset && !name.endsWith('Changeset')) add(file, `持久化变更类型 ${name} 必须以 Changeset 结尾`)
  }
}

const commandFiles = filesUnder('src-tauri/src/commands', ['.rs'])
for (const file of commandFiles) {
  const source = readAt(file)
  if (source == null) continue

  for (const declaration of rustStructDeclarations(source)) {
    const { attributes, isPublic, name } = declaration
    if (isPublic && /(?:Input|Dto|DTO|Patch)$/.test(name)) {
      add(file, `${name} 必须使用具体的 *Request / *InfoResponse / *ListResponse 后缀`)
    }
    if (file !== 'src-tauri/src/commands/entity_response.rs' && isPublic && /\bDeserialize\b/.test(attributes)) {
      if (!name.endsWith('Request') && !name.endsWith('Response')) {
        add(file, `公开命令 DTO ${name} 必须以 Request 或 Response 结尾`)
      }
      if (!/deny_unknown_fields/.test(attributes)) add(file, `${name} 必须使用 serde deny_unknown_fields`)
    }
    if (isPublic) {
      for (const [field, type] of rustStructFields(source, name) ?? []) {
        if (isBooleanField(field) && !/\bbool\b/.test(type)) {
          add(file, `公开 IPC 布尔字段 ${name}.${field} 必须使用 bool，当前为 ${type}`)
        }
      }
    }
  }
  if (/serde\([^\]]*\balias\s*=/.test(source)) add(file, 'first-party command DTO 禁止 serde alias')

  for (const match of source.matchAll(
    /#\[tauri::command\][\s\S]{0,700}?\b(?:async\s+)?fn\s+(\w+)[\s\S]{0,500}?->\s*Result<([^\r\n{]+)/g,
  )) {
    if (/\b(?:Row|Insert|Changeset)\b/.test(match[2])) {
      add(file, `命令 ${match[1]} 的公开返回值泄漏 persistence 类型`)
    }
  }
  for (const match of source.matchAll(/Result\s*<\s*Vec\s*<\s*(\w+InfoResponse)\s*>\s*,/g)) {
    add(file, `IPC 实体列表不得直接返回 Vec<${match[1]}>，请定义并使用 *ListResponse`)
  }

  // Create/update/upsert writes may carry routing identifiers directly, but
  // multiple loose payload fields must be one strict named Request DTO. This
  // keeps a field addition from silently widening both Tauri and remote IPC.
  for (const command of rustTauriCommandDeclarations(source)) {
    const businessParameters = command.parameters.filter(
      ({ name }) => !/^_?(?:app|state|window|webview_window)$/.test(name),
    )
    if (businessParameters.length > 1) {
      add(file, `命令 ${command.name} 的多个业务参数必须合并为一个严格命名 Request`)
    }

    if (!/^(?:create|update|upsert)_/.test(command.name)) continue
    const payload = command.parameters.filter(({ name, type }) => {
      if (/^(?:app|state|window|webview_window)$/.test(name)) return false
      if (/\btauri::(?:AppHandle|State|Window|WebviewWindow)\b/.test(type)) return false
      if (/^(?:id|ids)$/.test(name) || /_(?:id|ids)$/.test(name)) return false
      if (/Request\s*>?$/.test(type)) return false
      return true
    })
    if (payload.length > 1) {
      add(
        file,
        `写命令 ${command.name} 有多个散装业务参数 (${payload.map(({ name }) => name).join(', ')})，必须收敛为 *CreateRequest / *UpdateRequest`,
      )
    }
  }
}

const entityResponseFile = 'src-tauri/src/commands/entity_response.rs'
const entityResponses = readAt(entityResponseFile)
if (entityResponses != null) {
  for (const match of entityResponses.matchAll(
    /\b(?:strict_)?entity_response!\(\s*(?:[\w:]+::)?(\w+)\s*,\s*(\w+)\s*,\s*(\w+)/g,
  )) {
    if (!match[1].endsWith('Row')) add(entityResponseFile, `${match[1]} 不是明确的 persistence Row`)
    if (!match[2].endsWith('InfoResponse')) add(entityResponseFile, `${match[2]} 必须以 InfoResponse 结尾`)
    if (!match[3].endsWith('ListResponse')) add(entityResponseFile, `${match[3]} 必须以 ListResponse 结尾`)
  }
  for (const match of entityResponses.matchAll(/pub type\s+(\w+)\s*=\s*Vec<(\w+)>;/g)) {
    if (match[2].endsWith('InfoResponse') && !match[1].endsWith('ListResponse')) {
      add(entityResponseFile, `${match[1]} 是实体列表，必须以 ListResponse 结尾`)
    }
    if (match[1].endsWith('ListResponse') && !match[2].endsWith('InfoResponse')) {
      add(entityResponseFile, `${match[1]} 的元素必须是 *InfoResponse`)
    }
  }

  // SQLite represents booleans as i32. The response macro owns the strict
  // 0/1 conversion so neither Rust IPC DTOs nor generated TS types can inherit
  // that persistence representation.
  for (const [pattern, message] of [
    [
      /fn decode_sqlite_bool\(value: i32, field: &str\) -> Result<bool, String>/,
      '缺少 SQLite i32 到 IPC bool 的统一转换器',
    ],
    [/0\s*=>\s*Ok\(false\)/, 'SQLite bool 转换必须只把 0 解释为 false'],
    [/1\s*=>\s*Ok\(true\)/, 'SQLite bool 转换必须只把 1 解释为 true'],
    [/_\s*=>\s*Err\(/, 'SQLite bool 转换必须拒绝 0/1 以外的持久化值'],
    [/\$\(\s*pub\s+\$bool_field\s*:\s*bool\s*,\s*\)\*/, 'SQLite bool response macro 必须公开为 Rust bool'],
    [/decode_sqlite_bool\(\$value\.\$bool_field,/, 'SQLite bool response macro 必须执行严格 0/1 转换'],
  ]) {
    if (!pattern.test(entityResponses)) add(entityResponseFile, message)
  }

  // Also cover explicit/macro field declarations so a future response cannot
  // move a SQLite flag back into an integer-typed field list.
  const productionResponses = entityResponses.split(/\r?\n#\[cfg\(test\)\]/, 1)[0]
  for (const match of productionResponses.matchAll(
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(\w+)\s*:\s*((?:(?:Option|OverrideField)<[^,\r\n]+>|bool|[iu](?:8|16|32|64|128)))\s*,/gm,
  )) {
    if (isBooleanField(match[1]) && !/\bbool\b/.test(match[2])) {
      add(entityResponseFile, `公开 SQLite 布尔字段 ${match[1]} 必须使用 bool，当前为 ${match[2]}`)
    }
  }
}

// JSON-backed database columns are an implementation detail. IPC exposes the
// decoded collection/object, never the SQLite string that happens to store it.
requireRustFields(entityResponseFile, 'AssistantInfoResponse', {
  enabled_tools: /^Option<Vec<String>>$/,
})
requireRustFields(entityResponseFile, 'ConversationInfoResponse', {
  thinking_level: /^Option<(?:[\w:]+::)*StoredThinkingLevel>$/,
  mode: /^Option<(?:[\w:]+::)*ChatMode>$/,
})
requireRustFields(entityResponseFile, 'EmojiPackInfoResponse', {
  kind: /^EmojiPackKind$/,
})
requireRustFields(entityResponseFile, 'EmojiInfoResponse', {
  source: /^EmojiSource$/,
  semantic_status: /^EmojiSemanticStatus$/,
})
requireRustFields(entityResponseFile, 'JournalVersionInfoResponse', {
  op: /^JournalOperation$/,
  source: /^JournalSource$/,
  origin: /^Option<(?:[\w:]+::)*TurnOrigin>$/,
})
requireRustFields(entityResponseFile, 'MemoryInfoResponse', {
  scope_type: /^(?:[\w:]+::)*MemoryScope$/,
  memory_type: /^(?:[\w:]+::)*MemoryType$/,
  origin: /^(?:[\w:]+::)*Origin$/,
  visibility: /^(?:[\w:]+::)*Visibility$/,
  deleted_by: /^Option<(?:[\w:]+::)*DeletedBy>$/,
})
requireRustFields(entityResponseFile, 'ProjectInfoResponse', {
  source_type: /^(?:[\w:]+::)*ProjectSource$/,
})
requireRustFields(entityResponseFile, 'QueuedPromptInfoResponse', {
  delivery: /^(?:[\w:]+::)*Delivery$/,
})
requireRustFields(entityResponseFile, 'SkillInfoResponse', {
  source: /^SkillSource$/,
})
requireRustFields(entityResponseFile, 'TodoListInfoResponse', {
  status: /^(?:[\w:]+::)*ListStatus$/,
})
requireRustFields(entityResponseFile, 'TodoItemInfoResponse', {
  status: /^(?:[\w:]+::)*ItemStatus$/,
})
requireRustFields(entityResponseFile, 'CustomToolInfoResponse', {
  parameters_schema: /^(?:serde_json::)?Map<String, (?:serde_json::)?Value>$/,
  permission: /^(?:[\w:]+::)*Permission$/,
})
requireRustFields('src-tauri/src/commands/assistant.rs', 'AssistantUpdateRequest', {
  id: /^String$/,
  enabled_tools: /^Option<Option<Vec<String>>>$/,
})
requireRustFields('src-tauri/src/commands/assistant.rs', 'AssistantCreateRequest', {
  model_id: /^RequiredNullable<String>$/,
  temperature: /^RequiredNullable<f32>$/,
  top_p: /^RequiredNullable<f32>$/,
  max_tokens: /^RequiredNullable<i32>$/,
})
requireRustFields('src-tauri/src/commands/emoji.rs', 'EmojiPackCreateRequest', {
  description: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/memory.rs', 'MemoryUpsertRequest', {
  memory_type: /^RequiredNullable<MemoryType>$/,
})
requireRustFields('src-tauri/src/commands/memory.rs', 'MemoryScopedUpsertRequest', {
  project_id: /^RequiredNullable<String>$/,
  subject_scope_id: /^RequiredNullable<String>$/,
  memory_type: /^RequiredNullable<MemoryType>$/,
  owner_only: /^RequiredNullable<bool>$/,
})
requireRustFields('src-tauri/src/commands/project.rs', 'ProjectCreateRequest', {
  path: /^RequiredNullable<String>$/,
  source_id: /^RequiredNullable<String>$/,
  assistant_id: /^RequiredNullable<String>$/,
  description: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/skill.rs', 'SkillCreateRequest', {
  display_name: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/skill.rs', 'SkillUpdateRequest', {
  dir_name: /^String$/,
})
requireRustFields('src-tauri/src/commands/tool_system.rs', 'CustomToolUpdateRequest', {
  id: /^String$/,
  parameters_schema: /^Option<serde_json::Map<String, serde_json::Value>>$/,
})
requireRustFields('src-tauri/src/commands/tool_system.rs', 'CustomToolCreateRequest', {
  category_id: /^RequiredNullable<String>$/,
  parameters_schema: /^RequiredNullable<serde_json::Map<String, serde_json::Value>>$/,
  args_template: /^RequiredNullable<String>$/,
  working_directory: /^RequiredNullable<String>$/,
  timeout_ms: /^RequiredNullable<i32>$/,
  permission: /^RequiredNullable<Permission>$/,
})
requireRustFields(entityResponseFile, 'ToolPresetInfoResponse', {
  tool_names: /^Vec<String>$/,
})
requireRustFields('src-tauri/src/commands/tool_system.rs', 'ToolPresetUpdateRequest', {
  id: /^String$/,
  tool_names: /^Option<Vec<String>>$/,
})
requireRustFields('src-tauri/src/commands/tool_system.rs', 'ToolPresetCreateRequest', {
  description: /^RequiredNullable<String>$/,
  tool_names: /^Vec<String>$/,
})
requireRustFields(entityResponseFile, 'ModelConfigInfoResponse', {
  profile: /^ModelProfileInfoResponse$/,
  overrides_pricing: /^bool$/,
  pricing_tiers: /^Vec<(?:[\w:]+::)*PriceTier>$/,
  server_tools: /^Option<Vec<(?:[\w:]+::)*ServerToolKind>>$/,
  effective_pricing: /^ModelPricingInfoResponse$/,
})
// The model's own description, shared by every provider that reaches it.
requireRustFields(entityResponseFile, 'ModelProfileInfoResponse', {
  capability_overrides: /^Option<(?:[\w:]+::)*ProviderCapabilityOverrides>$/,
  pricing_tiers: /^Vec<(?:[\w:]+::)*PriceTier>$/,
  model_count: /^i64$/,
})
requireRustFields(entityResponseFile, 'ModelPricingInfoResponse', {
  pricing_tiers: /^Vec<(?:[\w:]+::)*PriceTier>$/,
})
requireRustFields('src-tauri/crates/core/src/provider/mod.rs', 'ProviderCapabilities', {
  server_tools: /^Vec<ServerToolKind>$/,
})
requireRustFields(entityResponseFile, 'ProviderCapabilityOverrides', {
  server_tools: /^OverrideField<Vec<(?:[\w:]+::)*ServerToolKind>>$/,
})
requireRustFields('src-tauri/src/commands/model_config.rs', 'ModelConfigUpsertRequest', {
  provider_id: /^String$/,
  model_id: /^String$/,
  profile: /^ModelProfileUpsertRequest$/,
  overrides_pricing: /^bool$/,
  pricing_tiers: /^Vec<(?:[\w:]+::)*PriceTier>$/,
  server_tools: /^RequiredNullable<Vec<(?:[\w:]+::)*ServerToolKind>>$/,
})
requireRustFields('src-tauri/src/commands/model_config.rs', 'ModelProfileUpsertRequest', {
  id: /^RequiredNullable<String>$/,
  name: /^String$/,
  max_output_tokens: /^RequiredNullable<i32>$/,
  capability_overrides: /^RequiredNullable<(?:[\w:]+::)*ProviderCapabilityOverrides>$/,
  pricing_tiers: /^Vec<(?:[\w:]+::)*PriceTier>$/,
})
requireRustFields('src-tauri/src/commands/model_config.rs', 'ModelConfigReadRequest', {
  provider_id: /^String$/,
  model_id: /^String$/,
})
requireRustFields('src-tauri/src/commands/model_config.rs', 'PriceTierRequest', {
  input_price: /^(?:[\w:]+::)*Decimal$/,
  output_price: /^(?:[\w:]+::)*Decimal$/,
  cache_read_price: /^RequiredNullable<(?:[\w:]+::)*Decimal>$/,
  cache_write_price: /^RequiredNullable<(?:[\w:]+::)*Decimal>$/,
})
requireRustFields('src-tauri/src/commands/provider.rs', 'ProviderCreateRequest', {
  name: /^String$/,
  provider_type: /^ProviderType$/,
  base_url: /^String$/,
  api_format: /^RequiredNullable<ApiFormat>$/,
  catalog_id: /^RequiredNullable<String>$/,
  auth_option: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/provider.rs', 'ProviderUpdateRequest', {
  id: /^String$/,
  name: /^Option<String>$/,
  provider_type: /^Option<ProviderType>$/,
  base_url: /^Option<String>$/,
  is_enabled: /^Option<bool>$/,
  api_format: /^Option<ApiFormat>$/,
  credential_kind: /^Option<CredentialKind>$/,
  transport_profile: /^Option<TransportProfile>$/,
})
requireRustFields('src-tauri/src/commands/provider.rs', 'ProviderKeyUpdateRequest', {
  provider_id: /^String$/,
  api_key: /^String$/,
})
requireRustFields('src-tauri/src/commands/provider.rs', 'ProviderModelListRequest', {
  provider_id: /^String$/,
  force_refresh: /^RequiredNullable<bool>$/,
})
requireRustFields('src-tauri/src/commands/provider.rs', 'ProviderCapabilitiesReadRequest', {
  provider_id: /^String$/,
  model_id: /^String$/,
})
const modelConfigCommandFile = 'src-tauri/src/commands/model_config.rs'
const modelConfigCommand = readAt(modelConfigCommandFile)
if (!/<Vec<PriceTierRequest> as serde::Deserialize>::deserialize\(deserializer\)/.test(modelConfigCommand ?? '')) {
  add(modelConfigCommandFile, 'pricing_tiers 必须经 PriceTierRequest 严格反序列化')
}
if (
  !/#\[serde\(deserialize_with\s*=\s*"deserialize_price_tiers"\)\]\s*pub pricing_tiers:/.test(modelConfigCommand ?? '')
) {
  add(modelConfigCommandFile, 'ModelConfigUpsertRequest.pricing_tiers 必须绑定严格 PriceTierRequest 反序列化器')
}
requireRustFields(entityResponseFile, 'McpServerInfoResponse', {
  args: /^Option<Vec<String>>$/,
  env: /^Option<(?:BTreeMap|HashMap)<String, String>>$/,
  headers: /^Option<(?:BTreeMap|HashMap)<String, String>>$/,
})
requireRustFields('src-tauri/src/commands/mcp.rs', 'McpServerUpdateRequest', {
  id: /^String$/,
  args: /^Option<Option<Vec<String>>>$/,
  env: /^Option<Option<(?:BTreeMap|HashMap)<String, String>>>$/,
  headers: /^Option<Option<(?:BTreeMap|HashMap)<String, String>>>$/,
})
requireRustFields('src-tauri/src/commands/mcp.rs', 'McpServerCreateRequest', {
  command: /^RequiredNullable<String>$/,
  args: /^RequiredNullable<Vec<String>>$/,
  env: /^RequiredNullable<(?:BTreeMap|HashMap)<String, String>>$/,
  url: /^RequiredNullable<String>$/,
  headers: /^RequiredNullable<(?:BTreeMap|HashMap)<String, String>>$/,
})

const namedCommandRequests = [
  ['src-tauri/src/commands/chat.rs', 'chat', 'ChatRequest'],
  ['src-tauri/src/commands/chat.rs', 'stop_chat', 'ChatStopRequest'],
  ['src-tauri/src/commands/user_command.rs', 'run_user_command', 'UserCommandRunRequest'],
  ['src-tauri/src/commands/user_command.rs', 'get_user_command_result', 'UserCommandResultReadRequest'],
  ['src-tauri/src/commands/model_config.rs', 'save_model_config', 'ModelConfigUpsertRequest'],
  ['src-tauri/src/commands/model_config.rs', 'get_model_config', 'ModelConfigReadRequest'],
  ['src-tauri/src/commands/onebot.rs', 'save_onebot_config', 'OneBotConfigUpdateRequest'],
  ['src-tauri/src/commands/hooks.rs', 'save_hooks_config', 'HookConfigUpdateRequest'],
  ['src-tauri/src/commands/remote.rs', 'save_listen_config', 'ListenConfigUpdateRequest'],
  ['src-tauri/src/commands/secret.rs', 'set_secret', 'SecretUpsertRequest'],
  ['src-tauri/src/commands/secret.rs', 'get_secret', 'SecretReadRequest'],
  ['src-tauri/src/commands/secret.rs', 'delete_secret', 'SecretDeleteRequest'],
  ['src-tauri/src/commands/preference.rs', 'get_preference', 'PreferenceReadRequest'],
  ['src-tauri/src/commands/acp.rs', 'acp_list_sessions', 'AcpSessionListRequest'],
  ['src-tauri/src/commands/acp.rs', 'acp_import_session', 'AcpImportSessionRequest'],
  ['src-tauri/src/commands/acp.rs', 'acp_open_session', 'AcpSessionOpenRequest'],
  ['src-tauri/src/commands/acp.rs', 'acp_send', 'AcpPromptSendRequest'],
  ['src-tauri/src/commands/acp.rs', 'acp_attach_session', 'AcpSessionAttachRequest'],
  ['src-tauri/src/commands/acp.rs', 'acp_session_config', 'AcpSessionConfigReadRequest'],
  ['src-tauri/src/commands/acp.rs', 'acp_set_session_config', 'AcpSessionConfigUpdateRequest'],
  ['src-tauri/src/commands/acp.rs', 'acp_save_config', 'AcpConfigUpdateRequest'],
  ['src-tauri/src/commands/emoji.rs', 'import_emojis', 'EmojiImportRequest'],
  ['src-tauri/src/commands/emoji.rs', 'rename_emoji', 'EmojiRenameRequest'],
  ['src-tauri/src/commands/emoji.rs', 'confirm_sticker_semantics', 'EmojiSemanticsConfirmRequest'],
  ['src-tauri/src/commands/emoji.rs', 'assign_emoji_pack', 'AssistantEmojiPackAssignmentRequest'],
  ['src-tauri/src/commands/emoji.rs', 'unassign_emoji_pack', 'AssistantEmojiPackAssignmentRequest'],
  ['src-tauri/src/commands/tool_system.rs', 'set_service_key', 'ServiceKeyUpdateRequest'],
  ['src-tauri/src/commands/dev.rs', 'voice_probe_echo', 'VoiceProbeEchoRequest'],
  ['src-tauri/src/commands/conversation.rs', 'create_conversation', 'ConversationCreateRequest'],
  ['src-tauri/src/commands/conversation.rs', 'compact', 'ConversationCompactionRequest'],
  ['src-tauri/src/commands/conversation.rs', 'set_conversation_assistant', 'ConversationAssistantUpdateRequest'],
  ['src-tauri/src/commands/conversation.rs', 'set_conversation_accept_edits', 'ConversationAcceptEditsUpdateRequest'],
  ['src-tauri/src/commands/conversation.rs', 'set_conversation_project', 'ConversationProjectUpdateRequest'],
  ['src-tauri/src/commands/conversation.rs', 'list_conversations_by_project', 'ConversationListByProjectRequest'],
  ['src-tauri/src/commands/conversation.rs', 'update_conversation_title', 'ConversationTitleUpdateRequest'],
  ['src-tauri/src/commands/conversation.rs', 'search_conversations', 'ConversationSearchRequest'],
  ['src-tauri/src/commands/assistant.rs', 'create_assistant', 'AssistantCreateRequest'],
  ['src-tauri/src/commands/assistant.rs', 'update_assistant', 'AssistantUpdateRequest'],
  ['src-tauri/src/commands/emoji.rs', 'create_emoji_pack', 'EmojiPackCreateRequest'],
  ['src-tauri/src/commands/mcp.rs', 'create_mcp_server', 'McpServerCreateRequest'],
  ['src-tauri/src/commands/mcp.rs', 'update_mcp_server', 'McpServerUpdateRequest'],
  ['src-tauri/src/commands/memory.rs', 'save_memory', 'MemoryUpsertRequest'],
  ['src-tauri/src/commands/memory.rs', 'save_memory_scoped', 'MemoryScopedUpsertRequest'],
  ['src-tauri/src/commands/memory.rs', 'update_memory', 'MemoryUpdateRequest'],
  ['src-tauri/src/commands/memory.rs', 'set_memory_subject_flags', 'MemorySubjectFlagsUpdateRequest'],
  ['src-tauri/src/commands/project.rs', 'create_project', 'ProjectCreateRequest'],
  ['src-tauri/src/commands/project.rs', 'update_project', 'ProjectUpdateRequest'],
  ['src-tauri/src/commands/provider.rs', 'create_provider', 'ProviderCreateRequest'],
  ['src-tauri/src/commands/provider.rs', 'update_provider', 'ProviderUpdateRequest'],
  ['src-tauri/src/commands/provider.rs', 'set_provider_key', 'ProviderKeyUpdateRequest'],
  ['src-tauri/src/commands/provider.rs', 'fetch_provider_models', 'ProviderModelListRequest'],
  ['src-tauri/src/commands/provider.rs', 'get_provider_capabilities', 'ProviderCapabilitiesReadRequest'],
  ['src-tauri/src/commands/skill.rs', 'create_skill', 'SkillCreateRequest'],
  ['src-tauri/src/commands/skill.rs', 'update_skill', 'SkillUpdateRequest'],
  ['src-tauri/src/commands/tool_system.rs', 'create_custom_tool', 'CustomToolCreateRequest'],
  ['src-tauri/src/commands/tool_system.rs', 'update_custom_tool', 'CustomToolUpdateRequest'],
  ['src-tauri/src/commands/tool_system.rs', 'create_tool_preset', 'ToolPresetCreateRequest'],
  ['src-tauri/src/commands/tool_system.rs', 'update_tool_preset', 'ToolPresetUpdateRequest'],
  ['src-tauri/src/commands/journal.rs', 'journal_blame', 'JournalBlameRequest'],
  ['src-tauri/src/commands/journal.rs', 'journal_file_history', 'JournalFileHistoryRequest'],
  ['src-tauri/src/commands/journal.rs', 'journal_version_content', 'JournalVersionContentRequest'],
  ['src-tauri/src/commands/logs.rs', 'read_logs', 'LogQueryRequest'],
  ['src-tauri/src/commands/logs.rs', 'set_log_level', 'LogLevelUpdateRequest'],
  ['src-tauri/src/commands/logs.rs', 'export_logs', 'LogExportRequest'],
  ['src-tauri/src/commands/queue.rs', 'queue_enqueue', 'QueuedPromptCreateRequest'],
  ['src-tauri/src/commands/queue.rs', 'queue_remove', 'QueuedPromptRemoveRequest'],
  ['src-tauri/src/commands/queue.rs', 'queue_reorder', 'QueuedPromptReorderRequest'],
  ['src-tauri/src/commands/queue.rs', 'queue_set_delivery', 'QueuedPromptDeliveryUpdateRequest'],
  ['src-tauri/src/commands/approval.rs', 'deny_tool_call', 'ToolCallDenyRequest'],
  ['src-tauri/src/commands/approval.rs', 'respond_to_ask', 'AskResponseRequest'],
  ['src-tauri/src/commands/sub_agent.rs', 'steer_conversation', 'ConversationSteerRequest'],
  ['src-tauri/src/commands/voice_corpus.rs', 'delete_voice_corpus', 'VoiceCorpusDeleteRequest'],
  ['src-tauri/src/commands/voice_corpus.rs', 'set_voice_optout', 'VoiceCorpusOptoutUpdateRequest'],
  ['src-tauri/src/commands/voice_corpus.rs', 'forget_voice_sender', 'VoiceCorpusForgetRequest'],
  ['src-tauri/src/commands/voice_corpus.rs', 'export_voice_corpus', 'VoiceCorpusExportRequest'],
  ['src-tauri/src/commands/usage.rs', 'usage_report', 'UsageReportRequest'],
  ['src-tauri/src/commands/message.rs', 'read_message_context_item', 'MessageContextReadRequest'],
  ['src-tauri/src/commands/message.rs', 'conversation_snapshot', 'ConversationSnapshotRequest'],
  ['src-tauri/src/commands/message.rs', 'switch_branch', 'MessageBranchSwitchRequest'],
  ['src-tauri/src/commands/message.rs', 'delete_message', 'MessageDeleteRequest'],
  ['src-tauri/src/commands/message.rs', 'rate_message', 'MessageRatingUpdateRequest'],
  ['src-tauri/src/commands/message.rs', 'export_conversation', 'ConversationExportRequest'],
  ['src-tauri/src/commands/message.rs', 'upload_file', 'MessageFileUploadRequest'],
  ['src-tauri/src/commands/voice.rs', 'voice_download_model', 'VoiceModelDownloadRequest'],
  ['src-tauri/src/commands/voice.rs', 'voice_import_model', 'VoiceModelImportRequest'],
  ['src-tauri/src/commands/voice.rs', 'voice_transcribe_pcm', 'VoicePcmTranscriptionRequest'],
  [
    'src-tauri/src/commands/conversation.rs',
    'set_conversation_reasoning_prefs',
    'ConversationReasoningPreferencesUpdateRequest',
  ],
  ['src-tauri/src/commands/conversation.rs', 'set_conversation_mode', 'ConversationModeUpdateRequest'],
]
const typescriptContracts = readAt('src/types.ts')
const namedWriteApiSource = readAt('src/api.ts')
const commandTableSource = readAt('src-tauri/src/command_table.rs')
for (const [file, command, requestType] of namedCommandRequests) {
  requireRustFunctionArgument(file, command, 'request', new RegExp(`^(?:[\\w:]+::)*${requestType}$`))
  if (typescriptContracts == null || typescriptInterfaceFields(typescriptContracts, requestType) == null) {
    add('src/types.ts', `缺少与 Rust 同名的 ${requestType}`)
  }
  const commandTablePattern = new RegExp(`\\b${command}\\s*\\(\\s*request\\s*:\\s*[^,()]+,?\\s*\\)`)
  if (!commandTablePattern.test(commandTableSource ?? '')) {
    add('src-tauri/src/command_table.rs', `${command} 必须且只能注册 request 参数`)
  }
  const apiPattern = new RegExp(`['"]${command}['"]\\s*,\\s*\\{\\s*request\\s*\\}`)
  if (!apiPattern.test(namedWriteApiSource ?? '')) add('src/api.ts', `${command} 必须只发送 { request }`)
}

requireRustFields('src-tauri/src/commands/emoji.rs', 'EmojiImportRequest', {
  pack_id: /^String$/,
  file_paths: /^Vec<String>$/,
})
requireRustFields('src-tauri/src/commands/emoji.rs', 'EmojiRenameRequest', {
  id: /^String$/,
  new_name: /^String$/,
})
requireRustFields('src-tauri/src/commands/emoji.rs', 'EmojiSemanticsConfirmRequest', {
  id: /^String$/,
  name: /^String$/,
  tags: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/emoji.rs', 'AssistantEmojiPackAssignmentRequest', {
  assistant_id: /^String$/,
  pack_id: /^String$/,
})
requireRustFields('src-tauri/src/commands/tool_system.rs', 'ServiceKeyUpdateRequest', {
  service: /^ServiceKey$/,
  key: /^String$/,
})
requireRustFields('src-tauri/src/commands/dev.rs', 'VoiceProbeEchoRequest', {
  sample_rate: /^u32$/,
  pcm: /^String$/,
})
requireRustFields('src-tauri/src/commands/memory.rs', 'MemoryUpdateRequest', {
  memory_type: /^Option<MemoryType>$/,
})
requireRustFields('src-tauri/src/commands/memory.rs', 'MemorySubjectFlagsUpdateRequest', {
  subject_scope_id: /^String$/,
  is_pinned: /^RequiredNullable<bool>$/,
  opted_out: /^RequiredNullable<bool>$/,
})
requireTypescriptFields('src/types.ts', 'EmojiImportRequest', {
  packId: /^string$/,
  filePaths: /^string\[\]$/,
})
requireTypescriptFields('src/types.ts', 'EmojiRenameRequest', {
  id: /^string$/,
  newName: /^string$/,
})
requireTypescriptFields('src/types.ts', 'EmojiSemanticsConfirmRequest', {
  id: /^string$/,
  name: /^string$/,
  tags: /^string \| null$/,
})
requireTypescriptFields('src/types.ts', 'AssistantEmojiPackAssignmentRequest', {
  assistantId: /^string$/,
  packId: /^string$/,
})
requireTypescriptFields('src/types.ts', 'ServiceKeyUpdateRequest', {
  service: /^ServiceKey$/,
  key: /^string$/,
})
requireTypescriptFields('src/types.ts', 'VoiceProbeEchoRequest', {
  sampleRate: /^number$/,
  pcm: /^string$/,
})
requireTypescriptFields('src/types.ts', 'MemoryUpdateRequest', {
  memoryType: /^MemoryType$/,
})
requireTypescriptFields('src/types.ts', 'MemorySubjectFlagsUpdateRequest', {
  subjectScopeId: /^string$/,
  isPinned: /^boolean \| null$/,
  optedOut: /^boolean \| null$/,
})
for (const [name, fields] of [
  ['EmojiImportRequest', ['packId', 'filePaths']],
  ['EmojiRenameRequest', ['id', 'newName']],
  ['EmojiSemanticsConfirmRequest', ['id', 'name', 'tags']],
  ['AssistantEmojiPackAssignmentRequest', ['assistantId', 'packId']],
  ['ServiceKeyUpdateRequest', ['service', 'key']],
  ['VoiceProbeEchoRequest', ['sampleRate', 'pcm']],
  ['MemorySubjectFlagsUpdateRequest', ['subjectScopeId', 'isPinned', 'optedOut']],
]) {
  requireTypescriptRequiredFields('src/types.ts', name, fields)
}

const usageCommandFile = 'src-tauri/src/commands/usage.rs'
requireRustFields(usageCommandFile, 'UsageReportRequest', {
  dimension: /^UsageDimension$/,
  since_ms: /^Option<i64>$/,
  until_ms: /^Option<i64>$/,
  origin: /^Option<TurnOrigin>$/,
  conversation_id: /^Option<String>$/,
})
const usageCommandSource = readAt(usageCommandFile)
if (/pub async fn usage_report[\s\S]{0,300}?(?:db::ops::usage::|UsageFilter)/.test(usageCommandSource ?? '')) {
  add(usageCommandFile, 'usage_report 禁止直接暴露 core db-ops 查询类型')
}

const messageCommandFile = 'src-tauri/src/commands/message.rs'
const messageCommandSource = readAt(messageCommandFile)
requireRustFields(messageCommandFile, 'MessageContextInfoResponse', { kind: /^MessageContextKind$/ })
requireRustFields(messageCommandFile, 'MessageInfoResponse', {
  rating: /^Option<MessageRating>$/,
  tool_outcome: /^Option<ToolOutcome>$/,
  auto_review: /^Option<(?:std::collections::)?BTreeMap<String, AutoReviewVerdictInfoResponse>>$/,
  tool_diffs: /^Option<(?:std::collections::)?BTreeMap<String, Vec<ToolCallDiffInfoResponse>>>$/,
})
if (/struct AutoReviewVerdictInfoResponse[\s\S]{0,900}?skip_serializing_if/.test(messageCommandSource ?? '')) {
  add(messageCommandFile, 'AutoReviewVerdictInfoResponse nullable key 与 evidence 必须始终序列化')
}
requireRustFields(messageCommandFile, 'TurnInfoResponse', {
  status: /^TurnStatus$/,
  phase: /^Option<TurnPhase>$/,
  usage: /^Option<TurnUsageInfoResponse>$/,
})
requireRustFields(messageCommandFile, 'TurnUsageInfoResponse', {
  input_cost: /^Option<meridian_core::decimal::Decimal>$/,
  output_cost: /^Option<meridian_core::decimal::Decimal>$/,
  cache_cost: /^Option<meridian_core::decimal::Decimal>$/,
  tool_cost: /^Option<meridian_core::decimal::Decimal>$/,
  total_cost: /^Option<meridian_core::decimal::Decimal>$/,
  pricing_status: /^TurnPricingStatus$/,
})
requireRustFields(messageCommandFile, 'SubAgentRunInfoResponse', {
  agent_kind: /^SubAgentKind$/,
  status: /^Option<TurnStatus>$/,
})
for (const forbidden of [
  /pub\s+kind:\s*meridian_core::workspace::reference::MessageContextKind/,
  /pub\s+tool_outcome:\s*Option<meridian_core::events::ToolOutcome>/,
  /pub\s+auto_review:\s*Option<[^>]*meridian_core::events::AutoReviewVerdict/,
  /pub\s+(?:status|phase|usage|agent_kind):\s*(?:Option<)?(?:db::|meridian_core::)/,
]) {
  if (forbidden.test(messageCommandSource ?? ''))
    add(messageCommandFile, 'message IPC response 禁止直接嵌入 core/db 类型')
}
for (const alias of [
  'MessageListResponse = Vec<MessageInfoResponse>',
  'BranchPointListResponse = Vec<BranchPointInfoResponse>',
  'TurnListResponse = Vec<TurnInfoResponse>',
  'SubAgentRunListResponse = Vec<SubAgentRunInfoResponse>',
]) {
  if (!(messageCommandSource ?? '').includes(`pub type ${alias};`)) {
    add(messageCommandFile, `缺少实体列表别名 ${alias}`)
  }
}

const voiceCommandFile = 'src-tauri/src/commands/voice.rs'
const voiceCommandSource = readAt(voiceCommandFile)
requireRustFields(voiceCommandFile, 'VoiceModelStatusInfoResponse', {
  installed: /^bool$/,
  path: /^Option<String>$/,
  size_bytes: /^u64$/,
  downloading: /^bool$/,
})
for (const command of ['voice_model_status', 'voice_import_model']) {
  const responsePattern = new RegExp(
    `pub async fn ${command}\\([\\s\\S]{0,240}?\\)\\s*->\\s*Result<VoiceModelStatusInfoResponse,\\s*String>`,
  )
  if (!responsePattern.test(voiceCommandSource ?? '')) {
    add(voiceCommandFile, `${command} 必须显式映射为 VoiceModelStatusInfoResponse`)
  }
}
if (/Result<voice::model::ModelStatus,\s*String>/.test(voiceCommandSource ?? '')) {
  add(voiceCommandFile, 'voice core ModelStatus 禁止直接作为 IPC response')
}

const hooksCommandFile = 'src-tauri/src/commands/hooks.rs'
const hooksCommandSource = readAt(hooksCommandFile)
requireRustFields(hooksCommandFile, 'HookStatusInfoResponse', {
  enabled: /^bool$/,
  running: /^bool$/,
  host: /^String$/,
  port: /^u16$/,
  handshake_path: /^Option<String>$/,
})
if (
  /pub async fn get_hooks_status\([\s\S]{0,220}?->\s*Result<hooks::HookStatus,\s*String>/.test(hooksCommandSource ?? '')
) {
  add(hooksCommandFile, 'hooks core HookStatus 禁止直接作为 IPC response')
}

const onebotCommandFile = 'src-tauri/src/commands/onebot.rs'
const onebotCommandSource = readAt(onebotCommandFile)
requireRustFields(onebotCommandFile, 'OneBotStatusInfoResponse', {
  enabled: /^bool$/,
  running: /^bool$/,
  connected_clients: /^u32$/,
  host: /^String$/,
  port: /^u16$/,
})
requireRustFields(onebotCommandFile, 'VoiceSendReadinessInfoResponse', {
  enabled: /^bool$/,
  has_model: /^bool$/,
  has_reference_id: /^bool$/,
  has_api_key: /^bool$/,
  ready: /^bool$/,
})
if (
  /pub async fn (?:get_onebot_status|get_voice_send_readiness)\([\s\S]{0,240}?->\s*Result<onebot::(?:OneBotStatus|VoiceSendReadiness),\s*String>/.test(
    onebotCommandSource ?? '',
  )
) {
  add(onebotCommandFile, 'onebot core status/readiness 禁止直接作为 IPC response')
}

if (!/updateMcpServer:\s*\(request:\s*McpServerUpdateRequest\)\s*=>/.test(namedWriteApiSource ?? '')) {
  add('src/api.ts', 'updateMcpServer 必须只接收 McpServerUpdateRequest')
}

const secretCommandFile = 'src-tauri/src/commands/secret.rs'
const secretCommandSource = readAt(secretCommandFile)
for (const name of ['SecretUpsertRequest', 'SecretReadRequest', 'SecretDeleteRequest']) {
  requireRustFields(secretCommandFile, name, { key: /^SecretKey$/ })
  requireTypescriptFields('src/types.ts', name, { key: /^SecretKey$/ })
}
requireRustFields(secretCommandFile, 'SecretUpsertRequest', { value: /^String$/ })
requireTypescriptFields('src/types.ts', 'SecretUpsertRequest', { value: /^string$/ })
if (
  !/pub enum SecretKey\s*\{[\s\S]*?RemoteToken/.test(secretCommandSource ?? '') ||
  /pub async fn (?:set|get|delete)_secret\([\s\S]{0,250}?\bkey:\s*String/.test(secretCommandSource ?? '')
) {
  add(secretCommandFile, 'secret IPC 必须使用闭合 SecretKey 与命名 Request，禁止开放 String key')
}
if (!/export type SecretKey\s*=\s*['"]REMOTE_TOKEN['"]/.test(typescriptContracts ?? '')) {
  add('src/types.ts', 'SecretKey 必须与 Rust 的闭合 secret key 集合一致')
}

const preferenceCommandFile = 'src-tauri/src/commands/preference.rs'
const preferenceCommandSource = readAt(preferenceCommandFile)
requireRustFields(preferenceCommandFile, 'PreferenceReadRequest', {
  key: /^PreferenceKey$/,
})
requireRustFields(preferenceCommandFile, 'PreferenceModelSelectionRequest', {
  provider_id: /^String$/,
  model_id: /^String$/,
})
requireTypescriptFields('src/types.ts', 'PreferenceReadRequest', {
  key: /^K$/,
})
requireTypescriptFields('src/types.ts', 'PreferenceModelSelectionRequest', {
  providerId: /^string$/,
  modelId: /^string$/,
})
requireTypescriptFields('src/types.ts', 'PreferenceModelSelectionInfoResponse', {
  provider_id: /^string$/,
  model_id: /^string$/,
})

for (const [name, values] of [
  ['ShellType', ['bash', 'powershell', 'cmd']],
  ['SandboxMode', ['auto', 'container', 'off']],
  ['SearchProvider', ['tavily', 'zhipu']],
  ['VoiceFilterLevel', ['off', 'standard', 'aggressive']],
]) {
  const declaration = typescriptContracts?.match(new RegExp(`export type ${name}\\s*=\\s*([^\\r\\n]+)`))?.[1]
  const actual = [...(declaration ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]).sort()
  if (actual.join(',') !== [...values].sort().join(',')) {
    add('src/types.ts', `${name} 必须是闭合枚举 ${values.join(' | ')}`)
  }
}

for (const [interfaceName, expected] of [
  [
    'PreferenceInfoValueByKey',
    {
      shell: /^ShellType \| null$/,
      'sandbox.enabled': /^SandboxMode \| null$/,
      search_provider: /^SearchProvider \| null$/,
      'voice.filter_level': /^VoiceFilterLevel \| null$/,
      'voice.download_url': /^string \| null$/,
      'android.manage_storage_enabled': /^boolean \| null$/,
      'autoreview.enabled': /^boolean \| null$/,
      'autoreview.model': /^PreferenceModelSelectionInfoResponse \| null$/,
      'autoreview.escalate': /^boolean \| null$/,
      'autoreview.allow_rules': /^string \| null$/,
      'autoreview.deny_rules': /^string \| null$/,
      'autoreview.environment': /^string \| null$/,
      'approvals.ttl_minutes': /^number \| null$/,
      'sub_agent.explore.model': /^PreferenceModelSelectionInfoResponse \| null$/,
      'sub_agent.agent.model': /^PreferenceModelSelectionInfoResponse \| null$/,
    },
  ],
  [
    'PreferenceUpdateValueByKey',
    {
      shell: /^ShellType$/,
      'sandbox.enabled': /^SandboxMode$/,
      search_provider: /^SearchProvider$/,
      'voice.filter_level': /^VoiceFilterLevel$/,
      'voice.download_url': /^string \| null$/,
      'android.manage_storage_enabled': /^boolean$/,
      'autoreview.enabled': /^boolean$/,
      'autoreview.model': /^PreferenceModelSelectionRequest \| null$/,
      'autoreview.escalate': /^boolean$/,
      'autoreview.allow_rules': /^string$/,
      'autoreview.deny_rules': /^string$/,
      'autoreview.environment': /^string$/,
      'approvals.ttl_minutes': /^number$/,
      'sub_agent.explore.model': /^PreferenceModelSelectionRequest \| null$/,
      'sub_agent.agent.model': /^PreferenceModelSelectionRequest \| null$/,
    },
  ],
]) {
  requireTypescriptStringKeyedFields('src/types.ts', interfaceName, expected)
}

if (
  !/#\[serde\(tag\s*=\s*"key",\s*deny_unknown_fields\)\]\s*pub enum PreferenceUpdateRequest\b/.test(
    preferenceCommandSource ?? '',
  )
) {
  add(preferenceCommandFile, 'PreferenceUpdateRequest 必须是拒绝未知字段的 key/value tagged union')
}
for (const [variant, payload] of [
  ['VoiceDownloadUrl', 'String'],
  ['AutoReviewModel', 'PreferenceModelSelectionRequest'],
  ['SubAgentExploreModel', 'PreferenceModelSelectionRequest'],
  ['SubAgentAgentModel', 'PreferenceModelSelectionRequest'],
]) {
  if (
    !new RegExp(`${variant}\\s*\\{\\s*value:\\s*RequiredNullable<${payload}>\\s*,?\\s*\\}`).test(
      preferenceCommandSource ?? '',
    )
  ) {
    add(preferenceCommandFile, `PreferenceUpdateRequest.${variant} 必须要求显式 value，nullable 只能用 null 表达`)
  }
}
if (
  !/#\[serde\(tag\s*=\s*"key",\s*content\s*=\s*"value"\)\]\s*pub enum PreferenceInfoResponse\b/.test(
    preferenceCommandSource ?? '',
  )
) {
  add(preferenceCommandFile, 'PreferenceInfoResponse 必须保持 key 与强类型 value 关联')
}
if (/serde\([^\]]*\b(?:default|alias|untagged)\b/.test(preferenceCommandSource ?? '')) {
  add(preferenceCommandFile, 'preference DTO 禁止 default / alias / untagged 兼容分支')
}
if (
  /pub async fn (?:get|set)_preference\([\s\S]{0,260}?\b(?:key|value):\s*String/.test(preferenceCommandSource ?? '')
) {
  add(preferenceCommandFile, 'preference IPC 禁止公开 String/String K/V 参数')
}

requireRustFunctionArgument(preferenceCommandFile, 'set_preference', 'request', /^PreferenceUpdateRequest$/)
if (
  !/\bset_preference\s*\(\s*request\s*:\s*\$crate::commands::preference::PreferenceUpdateRequest,?\s*\)/.test(
    commandTableSource ?? '',
  )
) {
  add('src-tauri/src/command_table.rs', 'set_preference 必须且只能注册 PreferenceUpdateRequest')
}
if (
  !/setPreference:\s*\(request:\s*PreferenceUpdateRequest\)\s*=>[\s\S]{0,100}?['"]set_preference['"]\s*,\s*\{\s*request\s*\}/.test(
    namedWriteApiSource ?? '',
  )
) {
  add('src/api.ts', 'setPreference 必须只接收 PreferenceUpdateRequest 并发送 { request }')
}
if (
  !/getPreference:\s*<K extends PreferenceKey>\(request:\s*PreferenceReadRequest<K>\)[\s\S]{0,120}?invoke<PreferenceInfoResponse<K>>\(['"]get_preference['"]\s*,\s*\{\s*request\s*\}/.test(
    namedWriteApiSource ?? '',
  )
) {
  add('src/api.ts', 'getPreference 必须使用 PreferenceReadRequest 与对应的 typed PreferenceInfoResponse')
}
if (
  /getPreference:\s*\(key:\s*string|setPreference:\s*\(key:\s*string|value:\s*string/.test(namedWriteApiSource ?? '')
) {
  add('src/api.ts', 'preference API 禁止兼容旧 String/String 调用')
}

const shellCoreFile = 'src-tauri/crates/core/src/tools/mod.rs'
const shellCoreSource = readAt(shellCoreFile)
if (!/["']cmd["']\s*=>\s*Ok\(Self::Cmd\)/.test(shellCoreSource ?? '')) {
  add(shellCoreFile, 'ShellType 必须与设置契约统一支持 cmd')
}

const preferenceDispatchFile = 'src-tauri/src/remote/dispatch.rs'
const preferenceDispatchSource = readAt(preferenceDispatchFile)
const preferenceGuard = preferenceDispatchSource?.match(/fn guard_preference\b([\s\S]*?)\n\}/)?.[1]
if (
  preferenceGuard == null ||
  !/\.get\("request"\)/.test(preferenceGuard) ||
  !/PreferenceKey\s*=\s*serde_json::from_value/.test(preferenceGuard) ||
  /args\s*\.get\("key"\)/.test(preferenceGuard)
) {
  add(preferenceDispatchFile, 'remote preference guard 必须读取新 { request: { key } } 形状并解析闭合 PreferenceKey')
}

const acpCommandFile = 'src-tauri/src/commands/acp.rs'
const acpCommandSource = readAt(acpCommandFile)
requireRustFields(acpCommandFile, 'AcpSessionOpenRequest', {
  cwd: /^String$/,
})
requireRustFields(acpCommandFile, 'AcpPromptSendRequest', {
  conversation_id: /^String$/,
  message: /^String$/,
  turn_id: /^RequiredNullable<String>$/,
  context_refs: /^RequiredNullable<Vec<meridian_core::workspace::reference::WorkspaceReferenceRequest>>$/,
})
requireRustFields(acpCommandFile, 'AcpSessionAttachRequest', {
  conversation_id: /^String$/,
  session_id: /^String$/,
  cwd: /^String$/,
})
requireRustFields(acpCommandFile, 'AcpSessionListRequest', {
  cwd: /^RequiredNullable<String>$/,
})
requireRustFields(acpCommandFile, 'AcpImportSessionRequest', {
  session_id: /^String$/,
  cwd: /^String$/,
  title: /^RequiredNullable<String>$/,
  updated_at: /^RequiredNullable<String>$/,
})
requireRustFields(acpCommandFile, 'AcpSessionConfigReadRequest', {
  conversation_id: /^String$/,
})
requireRustFields(acpCommandFile, 'AcpSessionConfigUpdateRequest', {
  conversation_id: /^String$/,
  config_id: /^String$/,
  value: /^serde_json::Value$/,
})
requireRustFields(acpCommandFile, 'AcpConfigOptionInfoResponse', {
  description: /^Option<String>$/,
  category: /^Option<String>$/,
  kind: /^Option<String>$/,
  current_value: /^Option<serde_json::Value>$/,
  options: /^Vec<AcpConfigOptionValueInfoResponse>$/,
})
requireRustFields(acpCommandFile, 'AcpConfigOptionValueInfoResponse', {
  description: /^Option<String>$/,
})
requireTypescriptFields('src/types.ts', 'AcpSessionListRequest', {
  cwd: /^string \| null$/,
})
requireTypescriptFields('src/types.ts', 'AcpSessionOpenRequest', {
  cwd: /^string$/,
})
requireTypescriptFields('src/types.ts', 'AcpPromptSendRequest', {
  conversationId: /^string$/,
  message: /^string$/,
  turnId: /^string \| null$/,
  contextRefs: /^WorkspaceReferenceRequest\[\] \| null$/,
})
requireTypescriptFields('src/types.ts', 'AcpSessionAttachRequest', {
  conversationId: /^string$/,
  sessionId: /^string$/,
  cwd: /^string$/,
})
requireTypescriptFields('src/types.ts', 'AcpImportSessionRequest', {
  sessionId: /^string$/,
  cwd: /^string$/,
  title: /^string \| null$/,
  updatedAt: /^string \| null$/,
})
requireTypescriptFields('src/types.ts', 'AcpSessionConfigReadRequest', {
  conversationId: /^string$/,
})
requireTypescriptFields('src/types.ts', 'AcpSessionConfigUpdateRequest', {
  conversationId: /^string$/,
  configId: /^string$/,
  value: /^unknown$/,
})
requireTypescriptFields('src/types.ts', 'AcpConfigOptionInfoResponse', {
  description: /^string \| null$/,
  category: /^string \| null$/,
  type: /^string \| null$/,
  currentValue: /^unknown$/,
  options: /^AcpConfigOptionValueInfoResponse\[\]$/,
})
requireTypescriptFields('src/types.ts', 'AcpConfigOptionValueInfoResponse', {
  description: /^string \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'AcpSessionListRequest', ['cwd'])
requireTypescriptRequiredFields('src/types.ts', 'AcpSessionOpenRequest', ['cwd'])
requireTypescriptRequiredFields('src/types.ts', 'AcpPromptSendRequest', [
  'conversationId',
  'message',
  'turnId',
  'contextRefs',
])
requireTypescriptRequiredFields('src/types.ts', 'AcpSessionAttachRequest', ['conversationId', 'sessionId', 'cwd'])
requireTypescriptRequiredFields('src/types.ts', 'AcpImportSessionRequest', ['sessionId', 'cwd', 'title', 'updatedAt'])
requireTypescriptRequiredFields('src/types.ts', 'AcpSessionConfigReadRequest', ['conversationId'])
requireTypescriptRequiredFields('src/types.ts', 'AcpSessionConfigUpdateRequest', [
  'conversationId',
  'configId',
  'value',
])
requireTypescriptRequiredFields('src/types.ts', 'AcpConfigOptionInfoResponse', [
  'description',
  'category',
  'type',
  'currentValue',
  'options',
])
requireTypescriptRequiredFields('src/types.ts', 'AcpConfigOptionValueInfoResponse', ['description'])
if (
  /Result\s*<\s*Vec\s*<\s*acp::import::DiscoveredSession/.test(acpCommandSource ?? '') ||
  /session:\s*acp::import::ImportRequest/.test(acpCommandSource ?? '') ||
  /Result\s*<\s*acp::import::ImportedSession/.test(acpCommandSource ?? '') ||
  /Result\s*<\s*Vec\s*<\s*meridian_core::acp::protocol::SessionConfigOption/.test(acpCommandSource ?? '')
) {
  add(acpCommandFile, 'ACP discovery/import/config 必须逐字段映射为 shell Request/Response，禁止公开 core 类型')
}
if (
  /pub async fn acp_(?:open_session|send|attach_session)\([\s\S]{0,500}?\b(?:cwd|message|session_id):\s*String/.test(
    acpCommandSource ?? '',
  )
) {
  add(acpCommandFile, 'ACP open/send/attach 必须只接收严格命名 Request，禁止裸业务参数')
}
if (/struct AcpConfigOption(?:Value)?InfoResponse[\s\S]{0,450}?skip_serializing_if/.test(acpCommandSource ?? '')) {
  add(acpCommandFile, 'ACP config response 的 nullable key 必须显式序列化为 null，禁止省略')
}
const eventContractFile = 'src-tauri/crates/core/src/events.rs'
const eventContractSource = readAt(eventContractFile)
requireRustFields(eventContractFile, 'AcpConfigOptionEvent', {
  description: /^Option<String>$/,
  category: /^Option<String>$/,
  kind: /^Option<String>$/,
  current_value: /^Option<serde_json::Value>$/,
  options: /^Vec<AcpConfigOptionValueEvent>$/,
})
if (/AcpConfig\s*\{[\s\S]{0,180}?Vec<crate::acp::protocol::SessionConfigOption>/.test(eventContractSource ?? '')) {
  add(eventContractFile, 'ACP 外部协议类型禁止直接作为一方 chat-stream 事件 DTO')
}
const autoReviewEventContract = eventContractSource?.match(/pub struct AutoReviewVerdict\s*\{([\s\S]*?)\n\}/)?.[1]
const chatStreamEventContract = eventContractSource?.slice(
  eventContractSource.indexOf('pub enum ChatStreamEvent'),
  eventContractSource.indexOf('pub struct EventBus'),
)
for (const [source, label] of [
  [autoReviewEventContract, 'AutoReviewVerdict'],
  [chatStreamEventContract, 'ChatStreamEvent'],
]) {
  if (/serde\([^\]]*\b(?:default|skip_serializing_if)\b/.test(source ?? '')) {
    add(eventContractFile, `${label} nullable key 必须 required-null，禁止 default / skip_serializing_if`)
  }
}
const autoReviewAgentFile = 'src-tauri/crates/core/src/agent/auto_review/mod.rs'
const autoReviewAgentSource = readAt(autoReviewAgentFile)
if (/\bfn\s+payload\s*\(/.test(autoReviewAgentSource ?? '')) {
  add(autoReviewAgentFile, '自动审查持久化必须复用 typed AutoReviewVerdict，禁止维护第二套 JSON payload')
}
const messageOpsFile = 'src-tauri/crates/core/src/db/ops/message.rs'
const messageOpsSource = readAt(messageOpsFile)
const recordAutoReview = messageOpsSource?.match(/pub fn record_auto_review\s*\([\s\S]*?\n\}/)?.[0]
if (!/verdict:\s*&crate::events::AutoReviewVerdict/.test(recordAutoReview ?? '')) {
  add(messageOpsFile, 'record_auto_review 写入参数必须是 typed AutoReviewVerdict')
}
if (!/BTreeMap<String,\s*crate::events::AutoReviewVerdict>/.test(recordAutoReview ?? '')) {
  add(messageOpsFile, 'record_auto_review 必须严格解码已有嵌套 verdict，禁止 Value passthrough')
}
if (!/call_id\.is_empty\(\)/.test(recordAutoReview ?? '')) {
  add(messageOpsFile, 'record_auto_review 必须拒绝空 call_id')
}
const providerContractFile = 'src-tauri/crates/core/src/provider/mod.rs'
const providerContractSource = readAt(providerContractFile)
if (
  !/struct ServerToolCall[\s\S]{0,900}?deserialize_required_nullable[^\]]*\]\s*pub arguments:\s*Option<String>/.test(
    providerContractSource ?? '',
  )
) {
  add(providerContractFile, 'ServerToolCall.arguments 必须是 required-null，禁止把缺键当作 null')
}
const acpImportCoreFile = 'src-tauri/crates/core/src/acp/import.rs'
const acpImportCoreSource = readAt(acpImportCoreFile)
if (
  /derive\([^)]*Deserialize[^)]*\)[\s\S]{0,100}?pub struct ImportRequest\b/.test(acpImportCoreSource ?? '') ||
  /#\[serde\(default\)\][\s\S]{0,80}?pub (?:title|updated_at):/.test(acpImportCoreSource ?? '')
) {
  add(acpImportCoreFile, 'ACP core import 不能充当宽松 IPC DTO；nullable key 必须由 shell Request 要求显式传入')
}
if (/pub struct ImportSessionResponse\b/.test(acpImportCoreSource ?? '')) {
  add(acpImportCoreFile, 'ACP core domain result 禁止使用协议层 Response 后缀')
}
requireRustFields(acpImportCoreFile, 'ImportedSession', {
  conversation_id: /^String$/,
  truncated: /^bool$/,
  messages: /^usize$/,
})

requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationSearchHitInfoResponse', {
  role: /^TranscriptRole$/,
})
const conversationOpsFile = 'src-tauri/crates/core/src/db/ops/conversation.rs'
const conversationOps = readAt(conversationOpsFile)
if (/derive\([^)]*Serialize[^)]*\)[\s\S]{0,100}?pub struct TranscriptHit\b/.test(conversationOps ?? '')) {
  add(conversationOpsFile, 'TranscriptHit 是内部查询结果，禁止直接序列化越过 command response 边界')
}

const workspaceReferenceFile = 'src-tauri/crates/core/src/workspace/reference.rs'
const workspaceReference = readAt(workspaceReferenceFile)
if (workspaceReference?.match(/pub struct\s+WorkspaceReferenceInput\b/)) {
  add(workspaceReferenceFile, '公开 IPC 输入必须命名为 WorkspaceReferenceRequest')
}
requireRustFields(workspaceReferenceFile, 'WorkspaceReferenceRequest', {
  path: /^String$/,
  line_start: /^Option<u32>$/,
  line_end: /^Option<u32>$/,
})
if (
  !/#\[serde\(rename_all\s*=\s*"camelCase",\s*deny_unknown_fields\)\]\s*pub struct WorkspaceReferenceRequest\b/.test(
    workspaceReference ?? '',
  ) ||
  !/deserialize_with\s*=\s*"crate::events::deserialize_required_nullable"\)\]\s*pub line_start: Option<u32>/.test(
    workspaceReference ?? '',
  ) ||
  !/deserialize_with\s*=\s*"crate::events::deserialize_required_nullable"\)\]\s*pub line_end: Option<u32>/.test(
    workspaceReference ?? '',
  )
) {
  add(workspaceReferenceFile, 'WorkspaceReferenceRequest 必须使用 camelCase 且要求显式 lineStart/lineEnd nullable keys')
}
if (
  /pub fn reconcile_references\(\s*supplied:\s*Option</.test(workspaceReference ?? '') ||
  /legacy\/raw caller|None\s*=>\s*Ok\(parsed\)/.test(workspaceReference ?? '')
) {
  add(workspaceReferenceFile, 'workspace reference 禁止 None/旧调用方回退到后端解析结果')
}
requireTypescriptFields('src/types.ts', 'WorkspaceReferenceRequest', {
  path: /^string$/,
  lineStart: /^number \| null$/,
  lineEnd: /^number \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'WorkspaceReferenceRequest', ['lineStart', 'lineEnd'])
const composerIntentFile = 'src/lib/composer-intent.ts'
const composerIntentSource = readAt(composerIntentFile)
if (
  !/lineStart:\s*reference\.lineStart\s*\?\?\s*null/.test(composerIntentSource ?? '') ||
  !/lineEnd:\s*reference\.lineEnd\s*\?\?\s*null/.test(composerIntentSource ?? '')
) {
  add(composerIntentFile, 'workspace reference producer 必须显式发送 nullable lineStart/lineEnd')
}
for (const [file, nullToEmpty] of [
  ['src-tauri/src/commands/chat.rs', /context_refs\.unwrap_or_default\(\)/],
  ['src-tauri/src/commands/queue.rs', /context_refs\.unwrap_or_default\(\)/],
  ['src-tauri/src/commands/acp.rs', /context_refs\.0\.unwrap_or_default\(\)/],
]) {
  const source = readAt(file)
  if (!nullToEmpty.test(source ?? '')) {
    add(file, '显式 contextRefs: null 必须表示空选择，禁止触发旧客户端解析回退')
  }
}

for (const file of ['src-tauri/crates/core/src/events.rs', ...filesUnder('src-tauri/crates/core/src/hooks', ['.rs'])]) {
  const source = readAt(file)
  if (source?.match(/serde\([^\]]*\balias\s*=/)) add(file, 'first-party protocol 禁止 serde alias')
}

const appEventFile = 'src/lib/app-event.ts'
const appEvents = readAt(appEventFile)
for (const required of [
  /'insets-changed':\s*WindowInsetsEvent/,
  /'remote-resync':\s*RemoteResyncEvent/,
  /case 'insets-changed':[\s\S]{0,120}parseWindowInsetsEvent/,
  /case 'remote-resync':[\s\S]{0,120}parseRemoteResyncEvent/,
  /default:\s*throw new Error\(`unknown app event channel:/,
]) {
  if (!required.test(appEvents ?? ''))
    add(appEventFile, '所有本地/远程 first-party event 都必须 exact parse，未知通道必须拒绝')
}
if (/default:[\s\S]{0,80}?return value/.test(appEvents ?? '')) {
  add(appEventFile, 'first-party event 禁止未知通道原样透传')
}

const platformFile = 'src-tauri/src/platform.rs'
const platformSource = readAt(platformFile)
if (/pub struct WindowInsets\b/.test(platformSource ?? '')) {
  add(platformFile, 'window insets 必须按 command response / event 分层命名')
}
if (!/pub enum PlatformInfoResponse\b/.test(platformSource ?? '') || /["']unknown["']/.test(platformSource ?? '')) {
  add(platformFile, 'get_platform 必须返回封闭 PlatformInfoResponse，禁止 unknown fallback')
}
requireRustFields(platformFile, 'SafRootInfoResponse', {
  uri: /^String$/,
  display_name: /^String$/,
  virtual_prefix: /^String$/,
})
if (!/pub type SafRootListResponse\s*=\s*Vec<SafRootInfoResponse>\s*;/.test(platformSource ?? '')) {
  add(platformFile, 'SAF 实体列表必须使用 SafRootListResponse = Vec<SafRootInfoResponse>')
}
if (/pub use\s+meridian_core::agent::file_access::SafRootEntry\s*;/.test(platformSource ?? '')) {
  add(platformFile, 'SAF persistence 类型 SafRootEntry 禁止从 shell 公开导出')
}
for (const command of ['pick_saf_directory', 'list_saf_roots', 'remove_saf_root']) {
  const responsePattern = new RegExp(
    `pub async fn ${command}\\([\\s\\S]{0,300}?\\)\\s*->\\s*Result<SafRootListResponse,\\s*String>`,
  )
  if (!responsePattern.test(platformSource ?? '')) {
    add(platformFile, `${command} 必须返回 SafRootListResponse，禁止直接暴露 SafRootEntry`)
  }
}

requireRustFields('src-tauri/src/commands/conversation.rs', 'ContextInfoResponse', {
  circuit_breaker_state: /CompactCircuitBreakerState$/,
  agent_kind: /^Option<ConversationAgentKind>$/,
})
const conversationCommandSource = readAt('src-tauri/src/commands/conversation.rs')
if (/struct ContextInfoResponse[\s\S]{0,700}?skip_serializing_if/.test(conversationCommandSource ?? '')) {
  add('src-tauri/src/commands/conversation.rs', 'ContextInfoResponse.agent_kind 必须显式序列化为 null')
}
requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationCreateRequest', {
  title: /^RequiredNullable<String>$/,
  project_id: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationCompactionRequest', {
  conversation_id: /^String$/,
  custom_instructions: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationAssistantUpdateRequest', {
  id: /^String$/,
  assistant_id: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationReasoningPreferencesUpdateRequest', {
  id: /^String$/,
  thinking_level: /^RequiredNullable<meridian_core::provider::capabilities::StoredThinkingLevel>$/,
  fast_mode: /^bool$/,
})
requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationModeUpdateRequest', {
  id: /^String$/,
  mode: /^RequiredNullable<meridian_core::agent::modes::ChatMode>$/,
})
requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationAcceptEditsUpdateRequest', {
  id: /^String$/,
  accept_edits: /^bool$/,
})
requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationProjectUpdateRequest', {
  id: /^String$/,
  project_id: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationListByProjectRequest', {
  project_id: /^String$/,
  archived: /^bool$/,
})
requireRustFields('src-tauri/src/commands/conversation.rs', 'ConversationSearchRequest', {
  query: /^String$/,
  limit: /^RequiredNullable<u32>$/,
})
requireTypescriptFields('src/types.ts', 'ConversationCreateRequest', {
  title: /^string \| null$/,
  projectId: /^string \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'ConversationCreateRequest', ['title', 'projectId'])
requireTypescriptFields('src/types.ts', 'ConversationCompactionRequest', {
  conversationId: /^string$/,
  customInstructions: /^string \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'ConversationCompactionRequest', ['customInstructions'])
requireTypescriptFields('src/types.ts', 'ConversationAssistantUpdateRequest', {
  id: /^string$/,
  assistantId: /^string \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'ConversationAssistantUpdateRequest', ['assistantId'])
requireTypescriptFields('src/types.ts', 'ConversationReasoningPreferencesUpdateRequest', {
  id: /^string$/,
  thinkingLevel: /^StoredThinkingLevel \| null$/,
  fastMode: /^boolean$/,
})
requireTypescriptRequiredFields('src/types.ts', 'ConversationReasoningPreferencesUpdateRequest', ['thinkingLevel'])
requireTypescriptFields('src/types.ts', 'ConversationModeUpdateRequest', {
  id: /^string$/,
  mode: /^ChatMode \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'ConversationModeUpdateRequest', ['mode'])
requireTypescriptFields('src/types.ts', 'ConversationAcceptEditsUpdateRequest', {
  id: /^string$/,
  acceptEdits: /^boolean$/,
})
requireTypescriptFields('src/types.ts', 'ConversationProjectUpdateRequest', {
  id: /^string$/,
  projectId: /^string \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'ConversationProjectUpdateRequest', ['projectId'])
requireTypescriptFields('src/types.ts', 'ConversationListByProjectRequest', {
  projectId: /^string$/,
  archived: /^boolean$/,
})
requireTypescriptFields('src/types.ts', 'ConversationSearchRequest', {
  query: /^string$/,
  limit: /^number \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'ConversationSearchRequest', ['limit'])
const chatCommandSource = readAt('src-tauri/src/commands/chat.rs')
requireRustFields('src-tauri/src/commands/chat.rs', 'ChatRequest', {
  conversation_id: /^String$/,
  message: /^RequiredNullable<String>$/,
  turn_id: /^RequiredNullable<String>$/,
  replaces: /^RequiredNullable<String>$/,
  model_override: /^RequiredNullable<String>$/,
  provider_override: /^RequiredNullable<String>$/,
  thinking_level: /^RequiredNullable<meridian_core::provider::capabilities::StoredThinkingLevel>$/,
  assistant_id: /^RequiredNullable<String>$/,
  fast: /^RequiredNullable<bool>$/,
  mode: /^RequiredNullable<meridian_core::agent::modes::ChatMode>$/,
  voice: /^RequiredNullable<bool>$/,
  context_refs: /^RequiredNullable<Vec<meridian_core::workspace::reference::WorkspaceReferenceRequest>>$/,
})
requireRustFields('src-tauri/src/commands/chat.rs', 'ChatStopRequest', {
  conversation_id: /^String$/,
  turn_id: /^RequiredNullable<String>$/,
})
requireTypescriptFields('src/types.ts', 'ChatRequest', {
  conversationId: /^string$/,
  message: /^string \| null$/,
  turnId: /^string \| null$/,
  replaces: /^string \| null$/,
  modelOverride: /^string \| null$/,
  providerOverride: /^string \| null$/,
  thinkingLevel: /^StoredThinkingLevel \| null$/,
  assistantId: /^string \| null$/,
  fast: /^boolean \| null$/,
  mode: /^ChatMode \| null$/,
  voice: /^boolean \| null$/,
  contextRefs: /^WorkspaceReferenceRequest\[\] \| null$/,
})
requireTypescriptFields('src/types.ts', 'ChatStopRequest', {
  conversationId: /^string$/,
  turnId: /^string \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'ChatRequest', [
  'conversationId',
  'message',
  'turnId',
  'replaces',
  'modelOverride',
  'providerOverride',
  'thinkingLevel',
  'assistantId',
  'fast',
  'mode',
  'voice',
  'contextRefs',
])
requireTypescriptRequiredFields('src/types.ts', 'ChatStopRequest', ['conversationId', 'turnId'])
if (/pub async fn chat\([^)]*\b(?:conversation_id|message|thinking_level|mode):/.test(chatCommandSource ?? '')) {
  add('src-tauri/src/commands/chat.rs', 'chat 必须只接收严格 ChatRequest，禁止散装参数')
}

for (const file of ['src-tauri/src/commands/user_command.rs', 'src-tauri/src/commands/user_command_android.rs']) {
  requireRustFields(file, 'UserCommandRunRequest', {
    conversation_id: /^String$/,
    turn_id: /^String$/,
    command: /^String$/,
    retry_without_sandbox: /^RequiredNullable<bool>$/,
  })
  requireRustFields(file, 'UserCommandResultReadRequest', {
    conversation_id: /^String$/,
    message_id: /^String$/,
  })
  const source = readAt(file)
  for (const [command, request] of [
    ['run_user_command', 'UserCommandRunRequest'],
    ['get_user_command_result', 'UserCommandResultReadRequest'],
  ]) {
    const pattern = new RegExp(`pub async fn ${command}\\([^)]*\\b_?request:\\s*${request}`)
    if (!pattern.test(source ?? '')) add(file, `${command} 必须只接收 ${request}`)
  }
}
requireTypescriptFields('src/types.ts', 'UserCommandRunRequest', {
  conversationId: /^string$/,
  turnId: /^string$/,
  command: /^string$/,
  retryWithoutSandbox: /^boolean \| null$/,
})
requireTypescriptFields('src/types.ts', 'UserCommandResultReadRequest', {
  conversationId: /^string$/,
  messageId: /^string$/,
})
requireTypescriptRequiredFields('src/types.ts', 'UserCommandRunRequest', [
  'conversationId',
  'turnId',
  'command',
  'retryWithoutSandbox',
])
requireTypescriptRequiredFields('src/types.ts', 'UserCommandResultReadRequest', ['conversationId', 'messageId'])
requireTypescriptFields('src/types.ts', 'ContextInfoResponse', {
  circuit_breaker_state: /^CompactCircuitBreakerState$/,
  agent_kind: /^ConversationAgentKind \| null$/,
})
requireTypescriptRequiredFields('src/types.ts', 'ContextInfoResponse', ['agent_kind'])
const compactSource = readAt('src-tauri/crates/core/src/agent/compact.rs')
if (
  !/pub enum CompactCircuitBreakerState\b/.test(compactSource ?? '') ||
  /=>\s*["']unknown["']/.test(compactSource ?? '')
) {
  add('src-tauri/crates/core/src/agent/compact.rs', '熔断状态必须是封闭枚举，禁止 unknown fallback')
}

const loggingReaderFile = 'src-tauri/crates/core/src/logging/reader.rs'
const loggingReaderSource = readAt(loggingReaderFile)
requireRustFields(loggingReaderFile, 'LogEntry', {
  level: /^LogRecordLevel$/,
})
requireRustFields(loggingReaderFile, 'LogQuery', {
  min_level: /^Option<LogLevel>$/,
})
requireRustFields('src-tauri/src/commands/logs.rs', 'LogQueryRequest', {
  min_level: /^Option<logging::LogLevel>$/,
})
requireRustFields('src-tauri/src/commands/logs.rs', 'LogSettingsResponse', {
  level: /^logging::LogLevel$/,
  levels: /^Vec<logging::LogLevel>$/,
})
requireRustFields('src-tauri/src/commands/logs.rs', 'LogLevelUpdateRequest', {
  level: /^logging::LogLevel$/,
})
requireRustFields('src-tauri/src/commands/logs.rs', 'LogEntryInfoResponse', {
  level: /^LogRecordLevel$/,
  cursor: /^LogCursorInfoResponse$/,
})
requireRustFields('src-tauri/src/commands/logs.rs', 'LogPageResponse', {
  entries: /^Vec<LogEntryInfoResponse>$/,
  next_cursor: /^Option<LogCursorInfoResponse>$/,
})
requireTypescriptFields('src/types.ts', 'LogEntryInfoResponse', {
  level: /^LogRecordLevel$/,
  cursor: /^LogCursorInfoResponse$/,
})
requireTypescriptFields('src/types.ts', 'LogQueryRequest', {
  minLevel: /^LogLevel \| null$/,
  cursor: /^LogCursorRequest \| null$/,
})
requireTypescriptFields('src/types.ts', 'LogPageResponse', {
  entries: /^LogEntryInfoResponse\[\]$/,
  nextCursor: /^LogCursorInfoResponse \| null$/,
})
requireTypescriptFields('src/types.ts', 'LogSettingsResponse', {
  level: /^LogLevel$/,
  levels: /^LogLevel\[\]$/,
})
if (
  !/deny_unknown_fields[\s\S]{0,120}?struct StoredLogRecord\b/.test(loggingReaderSource ?? '') ||
  !/pub fn query\([^)]*\) -> Result<LogPage, String>/.test(loggingReaderSource ?? '') ||
  /\braw:\s*Option<String>/.test(loggingReaderSource ?? '') ||
  /["']UNKNOWN["']|["']TRACE["']/.test(loggingReaderSource ?? '')
) {
  add(loggingReaderFile, '日志记录必须 exact parse、未知 schema/level 必须失败，禁止 raw/UNKNOWN/TRACE fallback')
}
requireRustFunctionArgument('src-tauri/src/commands/logs.rs', 'read_logs', 'request', /^LogQueryRequest$/)
const loggingCommandSource = readAt('src-tauri/src/commands/logs.rs')
if (/Result<reader::LogPage,\s*String>/.test(loggingCommandSource ?? '')) {
  add('src-tauri/src/commands/logs.rs', 'logging core LogPage 禁止直接作为 IPC response')
}

requireRustFields('src-tauri/src/commands/journal.rs', 'JournalBlameSpanInfoResponse', {
  kind: /^JournalBlameKind$/,
})
requireRustFields('src-tauri/src/commands/journal.rs', 'JournalBlameResponse', {
  spans: /^Vec<JournalBlameSpanInfoResponse>$/,
})
requireTypescriptFields('src/types.ts', 'JournalBlameSpanInfoResponse', {
  kind: /^JournalBlameKind$/,
})
requireTypescriptFields('src/types.ts', 'JournalBlameResponse', {
  spans: /^JournalBlameSpanInfoResponse\[\]$/,
})
const journalCommandSource = readAt('src-tauri/src/commands/journal.rs')
if (/Result<BlameResult,\s*String>/.test(journalCommandSource ?? '')) {
  add('src-tauri/src/commands/journal.rs', 'journal core BlameResult 禁止直接作为 IPC response')
}

const workspaceReferenceSource = readAt(workspaceReferenceFile)
requireRustFields(workspaceReferenceFile, 'WorkspaceReferencePreview', {
  kind: /^WorkspaceReferenceKind$/,
})
requireRustFields(workspaceReferenceFile, 'WorkspaceReferenceProbe', {
  kind: /^WorkspaceReferenceKind$/,
})
// The persisted vocabulary, not the workspace one: conversation excerpts
// freeze through the same carrier as `@` references without ever being a
// workspace reference. Still a closed enum — that is what the rule holds.
requireRustFields(workspaceReferenceFile, 'PreparedContextItem', {
  kind: /^MessageContextKind$/,
})
requireTypescriptFields('src/types.ts', 'WorkspaceReferencePreviewResponse', {
  kind: /^WorkspaceReferenceKind$/,
})
requireTypescriptFields('src/types.ts', 'WorkspaceReferenceProbeResponse', {
  kind: /^WorkspaceReferenceKind$/,
})
if (
  !/pub enum WorkspaceReferenceKind\b/.test(workspaceReferenceSource ?? '') ||
  !/pub enum MessageContextKind\b/.test(workspaceReferenceSource ?? '') ||
  /pub fn render_context_item\(\s*kind:\s*&str/.test(workspaceReferenceSource ?? '') ||
  /_\s*=>\s*["']project file["']/.test(workspaceReferenceSource ?? '')
) {
  add(workspaceReferenceFile, 'workspace/message context kind 必须是封闭枚举，render 禁止默认解释为 project_file')
}

const workspaceCommandFile = 'src-tauri/src/commands/workspace.rs'
for (const [command, request] of [
  ['workspace_root', 'WorkspaceRootRequest'],
  ['workspace_tree', 'WorkspaceTreeRequest'],
  ['workspace_read_file', 'WorkspaceFileReadRequest'],
  ['workspace_suggest_refs', 'WorkspaceReferenceSuggestRequest'],
  ['workspace_resolve_ref', 'WorkspaceReferenceResolveRequest'],
  ['workspace_probe_ref', 'WorkspaceReferenceProbeRequest'],
  ['workspace_git_status', 'WorkspaceGitStatusRequest'],
  ['workspace_git_diff', 'WorkspaceGitDiffRequest'],
  ['open_in_editor', 'WorkspaceEditorOpenRequest'],
]) {
  requireRustFunctionArgument(workspaceCommandFile, command, 'request', new RegExp(`^${request}$`))
}
for (const [request, fields] of [
  ['WorkspaceTreeRequest', ['dir']],
  ['WorkspaceReferenceSuggestRequest', ['conversationId', 'projectId', 'limit']],
  ['WorkspaceReferenceResolveRequest', ['conversationId', 'projectId', 'lineStart', 'lineEnd']],
  ['WorkspaceReferenceProbeRequest', ['conversationId', 'projectId']],
  ['WorkspaceGitDiffRequest', ['relPath']],
  ['WorkspaceEditorOpenRequest', ['line']],
]) {
  requireTypescriptRequiredFields('src/types.ts', request, fields)
}
for (const [response, expected] of [
  ['WorkspaceTreeEntryInfoResponse', { name: /^String$/, rel_path: /^String$/, is_dir: /^bool$/ }],
  [
    'WorkspaceFileContentResponse',
    {
      content: /^String$/,
      truncated: /^bool$/,
      total_lines: /^u64$/,
      size_bytes: /^u64$/,
      binary: /^bool$/,
    },
  ],
  ['WorkspaceReferenceSuggestionInfoResponse', { path: /^String$/, name: /^String$/, is_dir: /^bool$/ }],
  ['WorkspaceReferencePreviewResponse', { kind: /^workspace::reference::WorkspaceReferenceKind$/ }],
  ['WorkspaceReferenceProbeResponse', { kind: /^workspace::reference::WorkspaceReferenceKind$/ }],
  ['WorkspaceGitStatusEntryInfoResponse', { status: /^workspace::git::GitFileStatus$/ }],
  ['WorkspaceGitDiffResponse', { diff_text: /^String$/, truncated: /^bool$/ }],
]) {
  requireRustFields(workspaceCommandFile, response, expected)
}
const workspaceCommandSource = readAt(workspaceCommandFile)
if (
  /pub async fn workspace_(?:tree|read_file|suggest_refs|resolve_ref|probe_ref|git_status|git_diff)\([\s\S]{0,260}?->\s*Result<\s*(?:Vec\s*<\s*)?workspace::/.test(
    workspaceCommandSource ?? '',
  ) ||
  /pub async fn workspace_root\([\s\S]{0,220}?->\s*Result<\s*WorkspaceRoot\s*,/.test(workspaceCommandSource ?? '')
) {
  add(workspaceCommandFile, 'workspace 命令必须逐字段映射 shell Response，禁止直接公开 core 类型')
}
if (/serde\([^\]]*\b(?:default|alias|untagged)\b/.test(workspaceCommandSource ?? '')) {
  add(workspaceCommandFile, 'workspace DTO 禁止 default / alias / untagged 前向兼容分支')
}

const onebotCoreFile = 'src-tauri/crates/core/src/onebot/mod.rs'
const onebotCore = readAt(onebotCoreFile)
for (const obsolete of ['OneBotStatusResponse', 'VoiceSendReadinessResponse']) {
  if (new RegExp(`pub struct ${obsolete}\\b`).test(onebotCore ?? '')) {
    add(onebotCoreFile, `core 域类型 ${obsolete} 禁止使用协议层 Response 后缀`)
  }
}
const hooksCoreFile = 'src-tauri/crates/core/src/hooks/mod.rs'
const hooksCore = readAt(hooksCoreFile)
if (/pub struct HookStatusResponse\b/.test(hooksCore ?? '')) {
  add(hooksCoreFile, 'core 域类型 HookStatusResponse 禁止使用协议层 Response 后缀')
}

const strictObjectFiles = [
  ...commandFiles,
  ...filesUnder('src-tauri/src/remote', ['.rs']),
  ...filesUnder('src-tauri/crates/core/src/hooks', ['.rs']),
  'src-tauri/crates/core/src/events.rs',
  'src-tauri/crates/core/src/provider/state.rs',
  'src-tauri/crates/core/src/provider/capabilities.rs',
  'src-tauri/crates/core/src/provider/catalog.rs',
  'src-tauri/crates/core/src/agent/pricing.rs',
]
for (const file of new Set(strictObjectFiles)) {
  const source = readAt(file)
  if (source == null) continue
  if (/serde\([^\]]*\b(?:alias|other|flatten)\b/.test(source)) {
    add(file, 'first-party contract 禁止 serde alias / other / flatten 兼容模式')
  }
  for (const declaration of rustStructDeclarations(source)) {
    if (/\bDeserialize\b/.test(declaration.attributes) && !/deny_unknown_fields/.test(declaration.attributes)) {
      add(file, `first-party object ${declaration.name} 必须拒绝未知字段`)
    }
  }
}

const providerCatalogContractFile = 'src-tauri/crates/core/src/provider/catalog.rs'
const providerCatalogContract = readAt(providerCatalogContractFile)
if (/serde\([^\]]*\bdefault\b/.test(providerCatalogContract ?? '')) {
  add(providerCatalogContractFile, '首方 provider catalog 禁止用 serde default 补造缺失字段')
}
for (const field of ['official', 'api_key', 'docs', 'models']) {
  const pattern = new RegExp(
    `deserialize_with\\s*=\\s*"crate::events::deserialize_required_nullable"\\)\\]\\s*pub ${field}: Option<String>`,
  )
  if (!pattern.test(providerCatalogContract ?? '')) {
    add(providerCatalogContractFile, `Websites.${field} 必须是显式 required nullable key`)
  }
}

// Malformed first-party JSON must remain an error. This deliberately does not
// flag an optional `.ok()` probe by itself (for example, checking ownership of
// a stale hook handshake before deleting it); it flags only a decode chain that
// subsequently manufactures an empty/default contract value.
for (const file of [...filesUnder('src-tauri/crates/core/src', ['.rs']), ...filesUnder('src-tauri/src', ['.rs'])]) {
  const source = readAt(file)
  if (source == null) continue
  for (const finding of forbiddenJsonFallbacks(source)) {
    add(file, `第 ${finding.line} 行禁止把 malformed JSON 降级为空/default 值`)
  }
}

// Once decoded from the model-config storage column, server tool names remain
// a closed enum through capability resolution, turn configuration and IPC.
// The sole exception is the SQLite Row/Insert representation, which stores the
// JSON array as text and is already barred from crossing the command boundary.
for (const file of [...filesUnder('src-tauri/crates/core/src', ['.rs']), ...filesUnder('src-tauri/src', ['.rs'])]) {
  const source = readAt(file)
  if (source == null) continue
  const productionSource = source.split(/\r?\n#\[cfg\(test\)\]/, 1)[0]
  for (const declaration of rustStructDeclarations(productionSource)) {
    const type = rustStructFields(productionSource, declaration.name)?.get('server_tools')
    if (type == null || /\bServerToolKind\b/.test(type)) continue
    // The storage representations: the row itself, the resolved view the turn
    // loop reads, and the flat shape tests seed through. All three hold the
    // JSON array as text and none of them crosses the command boundary.
    const storageFiles = [
      'src-tauri/crates/core/src/db/models/model_config.rs',
      'src-tauri/crates/core/src/agent/model_config.rs',
      'src-tauri/crates/core/src/db/ops/model_config.rs',
    ]
    if (storageFiles.includes(file) && /\b(?:str|String)\b/.test(type)) continue
    add(file, `${declaration.name}.server_tools 必须使用 ServerToolKind，当前为 ${type}`)
  }
}

const schemaFile = 'src-tauri/crates/core/src/db/schema.rs'
const schema = readAt(schemaFile)
if (schema != null) {
  for (const match of schema.matchAll(/^\s*(\w+)\s*->\s*([^,]+),/gm)) {
    if (isMoneyLeafField(match[1]) && !/\bText\b/.test(match[2])) {
      add(schemaFile, `金额列 ${match[1]} 必须映射为 SQLite Text，不得使用 ${match[2].trim()}`)
    }
  }
}

const exactDecimalMigrationFile = 'src-tauri/crates/core/migrations/00000000000049_exact_decimal_money/up.sql'
const exactDecimalMigration = readAt(exactDecimalMigrationFile)
for (const [migrationTable, liveTable] of [
  ['model_configs_decimal', 'model_configs'],
  ['audit_messages_decimal', 'audit_messages'],
]) {
  const tableBody = exactDecimalMigration?.match(
    new RegExp(`CREATE TABLE ${migrationTable}\\s*\\(([\\s\\S]*?)\\r?\\n\\);`),
  )?.[1]
  for (const column of ['input_price', 'output_price', 'cache_read_price', 'cache_write_price', 'server_tool_price']) {
    const canonicalTextCheck = new RegExp(
      `\\b${column}\\s+TEXT\\s+CHECK\\s*\\(\\s*${column}\\s+IS\\s+NULL\\s+OR\\s+${column}\\s*=\\s*'0'\\s+OR\\s*\\(\\s*typeof\\(${column}\\)\\s*=\\s*'text'\\s+AND`,
    )
    if (tableBody == null || !canonicalTextCheck.test(tableBody)) {
      add(
        exactDecimalMigrationFile,
        `${liveTable}.${column} 必须在 canonical decimal CHECK 中显式拒绝非 TEXT SQLite storage class`,
      )
    }
  }
}

const canonicalAutoReviewMigrationFile = 'src-tauri/crates/core/migrations/00000000000050_canonical_auto_review/up.sql'
const canonicalAutoReviewMigration = readAt(canonicalAutoReviewMigrationFile)
const autoReviewRewrite = canonicalAutoReviewMigration?.match(
  /UPDATE messages\s+SET auto_review\s*=\s*\([\s\S]*?\)\s*WHERE auto_review IS NOT NULL;/,
)?.[0]
if (canonicalAutoReviewMigration == null) {
  add(canonicalAutoReviewMigrationFile, '缺少 auto_review 历史数据 canonical migration')
} else {
  for (const pattern of [
    /json_valid\(auto_review\)/,
    /CONSTRAINT valid_auto_review_shape CHECK \(ok = 1\)/,
    /COUNT\(DISTINCT verdict\.key\)/,
    /COUNT\(DISTINCT usage_field\.key\)/,
    /COUNT\(DISTINCT field\.key\)/,
  ]) {
    if (!pattern.test(canonicalAutoReviewMigration)) {
      add(canonicalAutoReviewMigrationFile, 'migration 50 必须拒绝 malformed / duplicate-key auto_review JSON')
      break
    }
  }
}
if (autoReviewRewrite == null) {
  add(canonicalAutoReviewMigrationFile, 'migration 50 必须原地重写 messages.auto_review')
} else {
  for (const key of ['outcome', 'risk', 'authorization', 'rationale', 'stage', 'model', 'evidence']) {
    if (!new RegExp(`['"]${key}['"]\\s*,`).test(autoReviewRewrite)) {
      add(canonicalAutoReviewMigrationFile, `migration 50 canonical verdict 缺少 ${key}`)
    }
  }
  if (/['"]usage['"]\s*,/.test(autoReviewRewrite)) {
    add(canonicalAutoReviewMigrationFile, 'migration 50 canonical verdict 禁止保留重复的 usage payload')
  }
}
const schemaDataFile = 'src/dev/schema-data.ts'
const schemaDataSource = readAt(schemaDataFile)
if (!/迁移 50 删除了旧形状里重复的 usage 并补齐缺键/.test(schemaDataSource ?? '')) {
  add(schemaDataFile, 'schema-data 必须记录 auto_review migration 50 的唯一 required-null 形状')
}

for (const file of [...filesUnder('src-tauri/crates/core/src', ['.rs']), ...filesUnder('src-tauri/src', ['.rs'])]) {
  const source = readAt(file)
  if (source == null) continue
  for (const match of source.matchAll(/^\s*pub(?:\([^)]*\))?\s+(\w+):\s*([^,\r\n]+)/gm)) {
    const [name, type] = [match[1], match[2].trim()]
    if (!isMoneyLeafField(name)) continue
    const structuredCost = name === 'cost' && /\b(?:Cost|RequestCost|ReviewCost)\b/.test(type)
    if (!/\bDecimal\b/.test(type) && !structuredCost) {
      add(file, `公开金额字段 ${name} 必须使用 Decimal，当前为 ${type}`)
    }
  }
  for (const match of source.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?(\w+):\s*([^,\r\n]+)/gm)) {
    if (isMoneyLeafField(match[1]) && /\b(?:f32|f64)\b/.test(match[2])) {
      add(file, `金额字段 ${match[1]} 禁止二进制浮点，当前为 ${match[2].trim()}`)
    }
  }
  if (/#\[cfg\(any\(\)\)\]\s*\r?\n\s*mod\s+obsolete/.test(source)) {
    add(file, '禁止用 cfg(any()) 隐藏旧契约测试；迁移或删除测试')
  }
}

const decimalFile = 'src-tauri/crates/core/src/decimal.rs'
const decimalSource = readAt(decimalFile)
if (decimalSource == null) add(decimalFile, '缺少统一 Decimal 边界类型')
for (const [pattern, message] of [
  [/pub const DECIMAL_PRECISION: usize = 38;/, 'Decimal 必须固定 NUMERIC(38,18) precision'],
  [/pub const DECIMAL_SCALE: usize = 18;/, 'Decimal 必须固定 NUMERIC(38,18) scale'],
  [/serializer\.serialize_str\(&self\.canonical\(\)\)/, 'Decimal JSON 必须序列化为 canonical string'],
  [/deserializer\.deserialize_str\(DecimalVisitor\)/, 'Decimal JSON 必须拒绝 number，只接受 string'],
  [/impl ToSql<Text, Sqlite> for Decimal/, 'Decimal SQLite 映射必须使用 Text'],
  [/impl FromSql<Text, Sqlite> for Decimal/, 'Decimal SQLite 读取必须使用 Text'],
]) {
  if (decimalSource != null && !pattern.test(decimalSource)) add(decimalFile, message)
}

// These names described the same cache-read rate and tier collection under
// different spellings before API revision 3.  Historical migrations keep the
// old schema so upgrades remain possible; live Rust/TypeScript code must not.
for (const file of [
  ...filesUnder('src-tauri/crates/core/src', ['.rs']),
  ...filesUnder('src-tauri/src', ['.rs']),
  ...filesUnder('src', ['.ts', '.tsx']),
]) {
  const source = readAt(file)
  if (source == null) continue
  if (/\bcache_price\b/.test(source)) add(file, '缓存读价统一命名为 cache_read_price')
  if (/\bprice_tiers\b/.test(source)) add(file, '阶梯价格统一命名为 pricing_tiers')
}

const pricingFile = 'src-tauri/crates/core/src/agent/pricing.rs'
const pricing = readAt(pricingFile)
const priceTier = pricing?.match(/pub struct PriceTier\s*\{([\s\S]*?)\n\}/)?.[1]
if (priceTier && /pub\s+(?:input|output|cache_read|cache_write)\s*:/.test(priceTier)) {
  add(pricingFile, 'PriceTier 金额字段必须使用完整的 *_price 名称')
}
const prices = pricing?.match(/pub struct Prices\s*\{([\s\S]*?)\n\}/)?.[1]
const expectedPriceFields = [
  'input_price',
  'output_price',
  'cache_read_price',
  'cache_write_price',
  'server_tool_price',
]
if (prices) {
  const actual = [...prices.matchAll(/^\s*pub\s+(\w+):\s*([^,\r\n]+)/gm)].map((match) => [match[1], match[2]])
  if (actual.map(([name]) => name).join(',') !== expectedPriceFields.join(',')) {
    add(pricingFile, `Prices 字段必须统一为 ${expectedPriceFields.join(', ')}`)
  }
  for (const [name, type] of actual) {
    if (!/\bDecimal\b/.test(type)) add(pricingFile, `Prices.${name} 必须使用 Decimal，当前为 ${type.trim()}`)
  }
}

const usageFile = 'src-tauri/crates/core/src/db/ops/usage.rs'
const usage = readAt(usageFile)
const usageBucket = usage?.match(/pub struct UsageBucket\s*\{([\s\S]*?)\n\}/)?.[1]
if (usageBucket) {
  if (/^\s*pub\s+cost\s*:/m.test(usageBucket)) add(usageFile, 'UsageBucket 总金额统一命名为 total_cost')
  if (!/^\s*pub\s+total_cost\s*:\s*Decimal\s*,/m.test(usageBucket)) {
    add(usageFile, 'UsageBucket.total_cost 必须存在且使用 Decimal')
  }
}

requireRustFields('src-tauri/crates/core/src/provider/balance.rs', 'BalanceAccount', {
  total_balance: /^Decimal$/,
  granted_balance: /^Option<Decimal>$/,
  topped_up_balance: /^Option<Decimal>$/,
})

for (const typesFile of filesUnder('src', ['.ts', '.tsx'])) {
  const types = readAt(typesFile)
  if (types == null) continue
  for (const match of types.matchAll(
    /^\s*(?:readonly\s+)?((?:price|cost|balance|amount)|\w+(?:_price|_cost|_balance|_amount|Price|Cost|Balance|Amount))\??:\s*((?:number|string)\b[^;,\r\n]*)/gm,
  )) {
    add(typesFile, `金额字段 ${match[1]} 必须使用 DecimalString，当前为 ${match[2].trim()}`)
  }
  for (const [index, line] of types.split(/\r?\n/).entries()) {
    if (/(?:price|cost|balance|amount)/i.test(line) && /(?:parseFloat\s*\(|\bNumber\s*\()/.test(line)) {
      add(typesFile, `第 ${index + 1} 行金额禁止经过 JavaScript number：${line.trim()}`)
    }
  }
}

const typesFile = 'src/types.ts'
const publicTypes = readAt(typesFile)
if (publicTypes != null) {
  for (const match of publicTypes.matchAll(/export\s+interface\s+(\w+)\b/g)) {
    const name = match[1]
    if (/(?:Input|Dto|DTO|Patch)$/.test(name)) {
      add(typesFile, `${name} 必须使用具体的 *Request / *InfoResponse / *ListResponse 后缀`)
    }
    const fields = typescriptInterfaceFields(publicTypes, name)
    for (const [field, type] of fields ?? []) {
      if (isMoneyLeafField(field) && !/\bDecimalString\b/.test(type)) {
        add(typesFile, `${name}.${field} 必须使用 DecimalString，当前为 ${type}`)
      }
      if (field === 'server_tools' && !/\bServerToolKind\b/.test(type)) {
        add(typesFile, `${name}.server_tools 必须使用 ServerToolKind，当前为 ${type}`)
      }
    }
    if (name.endsWith('Response')) {
      for (const [field, declaration] of typescriptInterfaceFieldDeclarations(publicTypes, name) ?? []) {
        if (declaration.optional) {
          add(typesFile, `${name}.${field} 是 wire response 字段，禁止 optional；可空必须使用 required-null`)
        }
      }
    }
  }
  for (const match of publicTypes.matchAll(/(?:^|[;{])\s*(?:readonly\s+)?(\w+)(\?)?\s*:\s*([^;,\r\n}]+)/gm)) {
    if (isBooleanField(match[1]) && !/\bboolean\b/.test(match[3])) {
      add(typesFile, `公开 IPC 布尔字段 ${match[1]} 必须使用 boolean，当前为 ${match[3].trim()}`)
    }
  }
  for (const match of publicTypes.matchAll(/export type\s+(\w+)\s*=\s*(\w+)\[\]/g)) {
    if (match[2].endsWith('InfoResponse') && !match[1].endsWith('ListResponse')) {
      add(typesFile, `${match[1]} 是实体列表，必须以 ListResponse 结尾`)
    }
    if (match[1].endsWith('ListResponse') && !match[2].endsWith('InfoResponse')) {
      add(typesFile, `${match[1]} 的元素必须是 *InfoResponse`)
    }
  }
}
const messageInfoFields = typescriptInterfaceFieldDeclarations(publicTypes ?? '', 'MessageInfoResponse')
if (messageInfoFields?.has('_blocks')) {
  add(typesFile, 'MessageInfoResponse 禁止包含 UI 派生字段 _blocks')
}
const messageViewModelFields = typescriptInterfaceFieldDeclarations(publicTypes ?? '', 'MessageViewModel')
if (!/export\s+interface\s+MessageViewModel\s+extends\s+MessageInfoResponse\s*\{/.test(publicTypes ?? '')) {
  add(typesFile, 'MessageViewModel 必须显式继承纯 wire MessageInfoResponse')
}
if (
  messageViewModelFields == null ||
  messageViewModelFields.size !== 1 ||
  messageViewModelFields.get('_blocks')?.optional !== true ||
  messageViewModelFields.get('_blocks')?.type !== 'ContentBlock[]'
) {
  add(typesFile, 'MessageViewModel 只能声明前端派生字段 _blocks?: ContentBlock[]')
}
if (/\bMessageViewModel\b/.test(readAt('src/api.ts') ?? '')) {
  add('src/api.ts', 'API 返回契约禁止引用 UI-only MessageViewModel')
}
if (/(?:"_blocks"|'_blocks')\s*:/.test(readAt('src/lib/invoke-response-schema.generated.ts') ?? '')) {
  add('src/lib/invoke-response-schema.generated.ts', '生成的 wire response schema 禁止接受 UI-only _blocks')
}
requireTypescriptFields(typesFile, 'AssistantInfoResponse', {
  enabled_tools: /^string\[\] \| null$/,
})
requireTypescriptFields(typesFile, 'ConversationInfoResponse', {
  thinking_level: /^StoredThinkingLevel \| null$/,
  mode: /^ChatMode \| null$/,
})
requireTypescriptFields(typesFile, 'EmojiPackInfoResponse', {
  kind: /^EmojiPackKind$/,
})
requireTypescriptFields(typesFile, 'EmojiInfoResponse', {
  source: /^EmojiSource$/,
  semantic_status: /^EmojiSemanticStatus$/,
})
requireTypescriptFields(typesFile, 'JournalVersionInfoResponse', {
  op: /^JournalOperation$/,
  source: /^JournalSource$/,
  origin: /^TurnOrigin \| null$/,
})
requireTypescriptFields(typesFile, 'MemoryInfoResponse', {
  scope_type: /^MemoryScope$/,
  memory_type: /^MemoryType$/,
  origin: /^MemoryOrigin$/,
  visibility: /^MemoryVisibility$/,
  deleted_by: /^MemoryDeletedBy \| null$/,
})
requireTypescriptFields(typesFile, 'ProjectInfoResponse', {
  source_type: /^ProjectSource$/,
  description: /^string \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'ProjectInfoResponse', ['description'])
requireTypescriptFields(typesFile, 'QueuedPromptInfoResponse', {
  delivery: /^QueueDelivery$/,
})
requireRustFields('src-tauri/src/commands/queue.rs', 'QueuedPromptCreateRequest', {
  delivery: /^Delivery$/,
  context_refs: /^RequiredNullable<Vec<meridian_core::workspace::reference::WorkspaceReferenceRequest>>$/,
})
requireRustFields('src-tauri/src/commands/queue.rs', 'QueuedPromptDeliveryUpdateRequest', {
  delivery: /^Delivery$/,
})
requireRustFields('src-tauri/src/commands/queue.rs', 'QueuedPromptRemoveRequest', {
  conversation_id: /^String$/,
  id: /^String$/,
})
requireRustFields('src-tauri/src/commands/queue.rs', 'QueuedPromptReorderRequest', {
  conversation_id: /^String$/,
  ids: /^Vec<String>$/,
})
requireRustFields('src-tauri/src/commands/approval.rs', 'ToolCallDenyRequest', {
  approval_id: /^String$/,
  reason: /^RequiredNullable<String>$/,
})
requireRustFields('src-tauri/src/commands/approval.rs', 'AskResponseRequest', {
  approval_id: /^String$/,
  response: /^String$/,
})
requireRustFields('src-tauri/src/commands/approval.rs', 'PendingApprovalInfoResponse', {
  retry: /^Option<meridian_core::events::ApprovalRetry>$/,
  asked_at: /^i64$/,
  parent_call_id: /^Option<String>$/,
  sub_conversation_id: /^Option<String>$/,
})
const approvalCommandSource = readAt('src-tauri/src/commands/approval.rs')
if (/struct PendingApprovalInfoResponse[\s\S]{0,1200}?skip_serializing_if/.test(approvalCommandSource ?? '')) {
  add('src-tauri/src/commands/approval.rs', 'PendingApprovalInfoResponse nullable key 必须显式序列化为 null')
}
requireRustFields('src-tauri/src/commands/sub_agent.rs', 'ConversationSteerRequest', {
  conversation_id: /^String$/,
  text: /^String$/,
})
requireTypescriptFields(typesFile, 'QueuedPromptCreateRequest', {
  delivery: /^QueueDelivery$/,
  contextRefs: /^WorkspaceReferenceRequest\[\] \| null$/,
})
requireTypescriptFields(typesFile, 'QueuedPromptDeliveryUpdateRequest', {
  delivery: /^QueueDelivery$/,
})
requireTypescriptFields(typesFile, 'QueuedPromptRemoveRequest', {
  conversationId: /^string$/,
  id: /^string$/,
})
requireTypescriptFields(typesFile, 'QueuedPromptReorderRequest', {
  conversationId: /^string$/,
  ids: /^string\[\]$/,
})
requireTypescriptFields(typesFile, 'ToolCallDenyRequest', {
  approvalId: /^string$/,
  reason: /^string \| null$/,
})
requireTypescriptFields(typesFile, 'AskResponseRequest', {
  approvalId: /^string$/,
  response: /^string$/,
})
requireTypescriptFields(typesFile, 'ConversationSteerRequest', {
  conversationId: /^string$/,
  text: /^string$/,
})
for (const [request, fields] of [
  ['QueuedPromptCreateRequest', ['conversationId', 'content', 'delivery', 'contextRefs']],
  ['QueuedPromptRemoveRequest', ['conversationId', 'id']],
  ['QueuedPromptReorderRequest', ['conversationId', 'ids']],
  ['QueuedPromptDeliveryUpdateRequest', ['conversationId', 'id', 'delivery']],
  ['ToolCallDenyRequest', ['approvalId', 'reason']],
  ['AskResponseRequest', ['approvalId', 'response']],
  ['ConversationSteerRequest', ['conversationId', 'text']],
]) {
  requireTypescriptRequiredFields(typesFile, request, fields)
}
requireRustFields('src-tauri/src/commands/voice_corpus.rs', 'VoiceCorpusDeleteRequest', {
  selector: /^VoiceCorpusDeleteSelector$/,
})
requireRustFields('src-tauri/src/commands/voice_corpus.rs', 'VoiceCorpusDeleteResponse', {
  failures: /^Vec<String>$/,
})
requireRustFields('src-tauri/src/commands/voice_corpus.rs', 'VoiceCorpusExportRequest', {
  output_dir: /^String$/,
})
requireTypescriptFields(typesFile, 'VoiceCorpusDeleteRequest', {
  selector: /^VoiceCorpusDeleteSelector$/,
})
requireTypescriptFields(typesFile, 'VoiceCorpusSessionInfoResponse', {
  kind: /^VoiceCorpusSessionKind$/,
})
requireTypescriptFields(typesFile, 'VoiceCorpusDeleteResponse', {
  failures: /^string\[\]$/,
})
requireTypescriptFields(typesFile, 'VoiceCorpusExportRequest', {
  outputDir: /^string$/,
})
const voiceCorpusCommandSource = readAt('src-tauri/src/commands/voice_corpus.rs')
if (/Result<(?:DeleteReport|ExportReport),\s*String>/.test(voiceCorpusCommandSource ?? '')) {
  add('src-tauri/src/commands/voice_corpus.rs', 'voice corpus core report 禁止直接作为 IPC response')
}
requireTypescriptFields(typesFile, 'UsageReportRequest', {
  dimension: /^UsageDimension$/,
  sinceMs: /^number \| null$/,
  untilMs: /^number \| null$/,
  origin: /^TurnOrigin \| null$/,
  conversationId: /^string \| null$/,
})
requireTypescriptFields(typesFile, 'MessageInfoResponse', {
  rating: /^MessageRating \| null$/,
  tool_outcome: /^ToolOutcome \| null$/,
  auto_review: /^Record<string, AutoReviewVerdictInfoResponse> \| null$/,
})
requireTypescriptFields(typesFile, 'AutoReviewVerdictInfoResponse', {
  risk: /^'low' \| 'medium' \| 'high' \| 'critical' \| null$/,
  authorization: /^'unknown' \| 'low' \| 'medium' \| 'high' \| null$/,
  rationale: /^string \| null$/,
  stage: /^'quick' \| 'investigate' \| null$/,
  model: /^string \| null$/,
  evidence: /^AutoReviewEvidenceInfoResponse\[\]$/,
})
requireTypescriptRequiredFields(typesFile, 'AutoReviewVerdictInfoResponse', [
  'risk',
  'authorization',
  'rationale',
  'stage',
  'model',
  'evidence',
])
requireTypescriptFields(typesFile, 'PendingApprovalInfoResponse', {
  retry: /^ApprovalRetry \| null$/,
  asked_at: /^number$/,
  parent_call_id: /^string \| null$/,
  sub_conversation_id: /^string \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'PendingApprovalInfoResponse', [
  'retry',
  'asked_at',
  'parent_call_id',
  'sub_conversation_id',
])
const chatStreamTypes = publicTypes?.slice(publicTypes.indexOf('export type ChatStreamEvent'))
if (/^\s*\w+\?\s*:/m.test(chatStreamTypes ?? '')) {
  add(typesFile, 'ChatStreamEvent 禁止 optional key；可空字段必须 required-null')
}
if (
  !/type:\s*'tool_approval_req'[\s\S]{0,700}?delegation:\s*\{[^}]+\}\s*\|\s*null[\s\S]{0,120}?retry:\s*ApprovalRetry\s*\|\s*null[\s\S]{0,200}?asked_at:\s*number\n/.test(
    chatStreamTypes ?? '',
  ) ||
  !/type:\s*'stop'[\s\S]{0,350}?message_id:\s*string\s*\|\s*null[\s\S]{0,250}?input_tokens:\s*number\s*\|\s*null[\s\S]{0,120}?output_tokens:\s*number\s*\|\s*null/.test(
    chatStreamTypes ?? '',
  )
) {
  add(typesFile, 'ChatStreamEvent approval/stop nullable 字段必须使用 required-null 精确形状')
}
requireTypescriptFields(typesFile, 'MessageTreeResponse', {
  messages: /^MessageListResponse$/,
  branches: /^BranchPointListResponse$/,
})
requireTypescriptFields(typesFile, 'TurnInfoResponse', {
  status: /^TurnStatus$/,
  phase: /^TurnPhase \| null$/,
  usage: /^TurnUsageInfoResponse \| null$/,
})
requireTypescriptFields(typesFile, 'TurnUsageInfoResponse', {
  input_cost: /^DecimalString \| null$/,
  output_cost: /^DecimalString \| null$/,
  cache_cost: /^DecimalString \| null$/,
  tool_cost: /^DecimalString \| null$/,
  total_cost: /^DecimalString \| null$/,
  pricing_status: /^TurnPricingStatus$/,
})
requireTypescriptFields(typesFile, 'SubAgentRunInfoResponse', {
  agent_kind: /^SubAgentKind$/,
  status: /^TurnStatus \| null$/,
})
requireTypescriptFields(typesFile, 'ConversationSnapshotResponse', {
  turns: /^TurnListResponse$/,
  pending_approvals: /^PendingApprovalListResponse$/,
  sub_agent_runs: /^SubAgentRunListResponse$/,
})
requireTypescriptFields(typesFile, 'VoiceModelStatusInfoResponse', {
  installed: /^boolean$/,
  path: /^string \| null$/,
  size_bytes: /^number$/,
  downloading: /^boolean$/,
})
requireTypescriptFields(typesFile, 'HookStatusInfoResponse', {
  enabled: /^boolean$/,
  running: /^boolean$/,
  host: /^string$/,
  port: /^number$/,
  handshake_path: /^string \| null$/,
})
requireTypescriptFields(typesFile, 'OneBotStatusInfoResponse', {
  enabled: /^boolean$/,
  running: /^boolean$/,
  connected_clients: /^number$/,
  host: /^string$/,
  port: /^number$/,
})
requireTypescriptFields(typesFile, 'VoiceSendReadinessInfoResponse', {
  enabled: /^boolean$/,
  has_model: /^boolean$/,
  has_reference_id: /^boolean$/,
  has_api_key: /^boolean$/,
  ready: /^boolean$/,
})
for (const obsolete of [
  'UsageFilter',
  'TurnUsageSummary',
  'VoiceModelStatus',
  'AutoReviewVerdict',
  'HookStatusResponse',
  'OneBotStatusResponse',
  'VoiceSendReadinessResponse',
]) {
  if (new RegExp(`export (?:interface|type) ${obsolete}\\b`).test(publicTypes ?? '')) {
    add(typesFile, `公开边界类型 ${obsolete} 必须使用统一的 Request / InfoResponse 命名`)
  }
}
requireTypescriptFields(typesFile, 'SkillInfoResponse', {
  source: /^SkillSource$/,
})
requireTypescriptFields(typesFile, 'TodoListInfoResponse', {
  status: /^TodoListStatus$/,
})
requireTypescriptFields(typesFile, 'TodoItemInfoResponse', {
  status: /^TodoItemStatus$/,
})
requireTypescriptFields(typesFile, 'CustomToolInfoResponse', {
  parameters_schema: /^Record<string, unknown>$/,
  permission: /^ToolPermission$/,
})
requireTypescriptFields(typesFile, 'AssistantUpdateRequest', {
  id: /^string$/,
  enabledTools: /^string\[\] \| null$/,
})
requireTypescriptFields(typesFile, 'AssistantCreateRequest', {
  modelId: /^string \| null$/,
  temperature: /^number \| null$/,
  topP: /^number \| null$/,
  maxTokens: /^number \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'AssistantCreateRequest', ['modelId', 'temperature', 'topP', 'maxTokens'])
requireTypescriptFields(typesFile, 'EmojiPackCreateRequest', {
  description: /^string \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'EmojiPackCreateRequest', ['description'])
requireTypescriptFields(typesFile, 'McpServerCreateRequest', {
  command: /^string \| null$/,
  args: /^string\[\] \| null$/,
  env: /^Record<string, string> \| null$/,
  url: /^string \| null$/,
  headers: /^Record<string, string> \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'McpServerCreateRequest', ['command', 'args', 'env', 'url', 'headers'])
requireTypescriptFields(typesFile, 'MemoryUpsertRequest', {
  memoryType: /^MemoryType \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'MemoryUpsertRequest', ['memoryType'])
requireTypescriptFields(typesFile, 'MemoryScopedUpsertRequest', {
  projectId: /^string \| null$/,
  subjectScopeId: /^string \| null$/,
  memoryType: /^MemoryType \| null$/,
  ownerOnly: /^boolean \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'MemoryScopedUpsertRequest', [
  'projectId',
  'subjectScopeId',
  'memoryType',
  'ownerOnly',
])
requireTypescriptFields(typesFile, 'ProjectCreateRequest', {
  path: /^string \| null$/,
  sourceId: /^string \| null$/,
  assistantId: /^string \| null$/,
  description: /^string \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'ProjectCreateRequest', ['path', 'sourceId', 'assistantId', 'description'])
requireTypescriptFields(typesFile, 'SkillCreateRequest', {
  displayName: /^string \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'SkillCreateRequest', ['displayName'])
requireTypescriptFields(typesFile, 'SkillUpdateRequest', {
  dirName: /^string$/,
})
requireTypescriptFields(typesFile, 'CustomToolUpdateRequest', {
  id: /^string$/,
  parametersSchema: /^Record<string, unknown>$/,
})
requireTypescriptFields(typesFile, 'CustomToolCreateRequest', {
  categoryId: /^string \| null$/,
  parametersSchema: /^Record<string, unknown> \| null$/,
  argsTemplate: /^string \| null$/,
  workingDirectory: /^string \| null$/,
  timeoutMs: /^number \| null$/,
  permission: /^ToolPermission \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'CustomToolCreateRequest', [
  'categoryId',
  'parametersSchema',
  'argsTemplate',
  'workingDirectory',
  'timeoutMs',
  'permission',
])
requireTypescriptFields(typesFile, 'ToolPresetInfoResponse', {
  tool_names: /^string\[\]$/,
})
requireTypescriptFields(typesFile, 'ToolPresetUpdateRequest', {
  id: /^string$/,
  toolNames: /^string\[\]$/,
})
requireTypescriptFields(typesFile, 'ToolPresetCreateRequest', {
  description: /^string \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'ToolPresetCreateRequest', ['description'])
requireTypescriptFields(typesFile, 'ModelConfigInfoResponse', {
  profile: /^ModelProfileInfoResponse$/,
  overrides_pricing: /^boolean$/,
  pricing_tiers: /^PriceTier\[\]$/,
  server_tools: /^ServerToolKind\[\] \| null$/,
  effective_pricing: /^ModelPricingInfoResponse$/,
})
requireTypescriptFields(typesFile, 'ModelProfileInfoResponse', {
  capability_overrides: /^ProviderCapabilityOverrides \| null$/,
  pricing_tiers: /^PriceTier\[\]$/,
  model_count: /^number$/,
})
requireTypescriptFields(typesFile, 'ModelPricingInfoResponse', {
  pricing_tiers: /^PriceTier\[\]$/,
})
requireTypescriptFields(typesFile, 'ProviderCapabilitiesInfoResponse', {
  server_tools: /^ServerToolKind\[\]$/,
})
requireTypescriptFields(typesFile, 'ProviderCapabilityOverrides', {
  server_tools: /^ServerToolKind\[\]$/,
})
requireTypescriptFields(typesFile, 'ProviderCreateRequest', {
  name: /^string$/,
  providerType: /^ProviderType$/,
  baseUrl: /^string$/,
  apiFormat: /^ProviderApiFormat \| null$/,
  catalogId: /^string \| null$/,
  authOption: /^string \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'ProviderCreateRequest', ['apiFormat', 'catalogId', 'authOption'])
requireTypescriptFields(typesFile, 'ProviderUpdateRequest', {
  id: /^string$/,
  name: /^string$/,
  providerType: /^ProviderType$/,
  baseUrl: /^string$/,
  isEnabled: /^boolean$/,
  apiFormat: /^ProviderApiFormat$/,
  credentialKind: /^ProviderCredentialKind$/,
  transportProfile: /^ProviderTransportProfile$/,
})
requireTypescriptOptionalFields(typesFile, 'ProviderUpdateRequest', [
  'name',
  'providerType',
  'baseUrl',
  'isEnabled',
  'apiFormat',
  'credentialKind',
  'transportProfile',
])
requireTypescriptFields(typesFile, 'ProviderKeyUpdateRequest', {
  providerId: /^string$/,
  apiKey: /^string$/,
})
requireTypescriptFields(typesFile, 'ProviderModelListRequest', {
  providerId: /^string$/,
  forceRefresh: /^boolean \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'ProviderModelListRequest', ['forceRefresh'])
requireTypescriptFields(typesFile, 'ProviderCapabilitiesReadRequest', {
  providerId: /^string$/,
  modelId: /^string$/,
})
requireTypescriptFields(typesFile, 'ModelConfigUpsertRequest', {
  provider_id: /^string$/,
  model_id: /^string$/,
  profile: /^ModelProfileUpsertRequest$/,
  overrides_pricing: /^boolean$/,
  pricing_tiers: /^PriceTier\[\]$/,
  server_tools: /^ServerToolKind\[\] \| null$/,
})
requireTypescriptFields(typesFile, 'ModelProfileUpsertRequest', {
  id: /^string \| null$/,
  name: /^string$/,
  max_output_tokens: /^number \| null$/,
  capability_overrides: /^ProviderCapabilityOverrides \| null$/,
  pricing_tiers: /^PriceTier\[\]$/,
})
requireTypescriptRequiredFields(typesFile, 'ModelProfileUpsertRequest', ['id', 'max_output_tokens'])
requireTypescriptFields(typesFile, 'ModelConfigReadRequest', {
  providerId: /^string$/,
  modelId: /^string$/,
})
requireTypescriptFields(typesFile, 'PriceTier', {
  input_price: /^DecimalString$/,
  output_price: /^DecimalString$/,
  cache_read_price: /^DecimalString \| null$/,
  cache_write_price: /^DecimalString \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'PriceTier', ['cache_read_price', 'cache_write_price'])
requireTypescriptFields(typesFile, 'McpServerInfoResponse', {
  args: /^string\[\] \| null$/,
  env: /^Record<string, string> \| null$/,
  headers: /^Record<string, string> \| null$/,
})
requireTypescriptFields(typesFile, 'McpServerUpdateRequest', {
  id: /^string$/,
  args: /^string\[\] \| null$/,
  env: /^Record<string, string> \| null$/,
  headers: /^Record<string, string> \| null$/,
})
requireTypescriptRequiredFields(typesFile, 'McpServerUpdateRequest', ['id'])
requireTypescriptFields(typesFile, 'SafRootInfoResponse', {
  uri: /^string$/,
  display_name: /^string$/,
  virtual_prefix: /^string$/,
})
if (!/export type SafRootListResponse\s*=\s*SafRootInfoResponse\[\]/.test(publicTypes ?? '')) {
  add(typesFile, 'SAF 实体列表必须使用 SafRootListResponse = SafRootInfoResponse[]')
}
if (/\bSafRootEntry\b/.test(publicTypes ?? '')) {
  add(typesFile, '公开 IPC 禁止复用 persistence 命名 SafRootEntry')
}
requireTypescriptFields(typesFile, 'ProviderBalanceAccountInfoResponse', {
  total_balance: /^DecimalString$/,
  granted_balance: /^DecimalString \| null$/,
  topped_up_balance: /^DecimalString \| null$/,
})
const publicUsageBucket = publicTypes?.match(/export interface UsageBucketInfoResponse\s*\{([\s\S]*?)\n\}/)?.[1]
if (!publicUsageBucket) {
  add(typesFile, '缺少 UsageBucketInfoResponse 公开 DTO')
} else {
  if (/^\s*cost\s*:/m.test(publicUsageBucket)) add(typesFile, 'UsageBucketInfoResponse 总金额统一命名为 total_cost')
  if (!/^\s*total_cost\s*:\s*DecimalString\s*$/m.test(publicUsageBucket)) {
    add(typesFile, 'UsageBucketInfoResponse.total_cost 必须存在且使用 DecimalString')
  }
}

const apiFile = 'src/api.ts'
const apiSource = readAt(apiFile)
for (const match of apiSource?.matchAll(/invoke<(\w+InfoResponse)\[\]>/g) ?? []) {
  add(apiFile, `IPC 实体列表不得直接使用 ${match[1]}[]，请使用 *ListResponse`)
}
for (const [method, command] of [
  ['pickSafDirectory', 'pick_saf_directory'],
  ['listSafRoots', 'list_saf_roots'],
  ['removeSafRoot', 'remove_saf_root'],
]) {
  const responsePattern = new RegExp(`${method}:[\\s\\S]{0,160}?invoke<SafRootListResponse>\\('${command}'`)
  if (!responsePattern.test(apiSource ?? '')) add(apiFile, `${method} 必须使用 SafRootListResponse`)
}
for (const [method, command, response] of [
  ['usageReport', 'usage_report', 'UsageBucketListResponse'],
  ['voiceModelStatus', 'voice_model_status', 'VoiceModelStatusInfoResponse'],
  ['voiceImportModel', 'voice_import_model', 'VoiceModelStatusInfoResponse'],
  ['exportConversation', 'export_conversation', 'ConversationExportResponse'],
]) {
  const responsePattern = new RegExp(`${method}:[\\s\\S]{0,220}?invoke<${response}>\\('${command}'`)
  if (!responsePattern.test(apiSource ?? '')) add(apiFile, `${method} 必须使用 ${response}`)
}

const dispatchFile = 'src-tauri/src/remote/dispatch.rs'
const dispatch = readAt(dispatchFile)
if (dispatch != null) {
  if (!dispatch.includes('validate_args($args')) add(dispatchFile, 'remote command 必须拒绝未知参数')
  if (dispatch.includes('.or_else(|| args.get(name))')) add(dispatchFile, 'remote command 禁止 snake_case 参数兼容别名')
}

for (const file of filesUnder('src-tauri/src/remote', ['.rs'])) {
  const source = readAt(file)
  if (source == null) continue
  if (/serde\([^\]]*\balias\s*=/.test(source)) add(file, 'first-party remote protocol 禁止 serde alias')
  for (const match of source.matchAll(/#\[derive\(([^)]*\bDeserialize\b[^)]*)\)\]([\s\S]{0,180}?)\bstruct\s+(\w+)/g)) {
    if (!/deny_unknown_fields/.test(match[2])) {
      add(file, `remote DTO ${match[3]} 必须使用 serde deny_unknown_fields`)
    }
  }
}

const remoteHttpFile = 'src-tauri/src/remote/http.rs'
const remoteHttp = readAt(remoteHttpFile)
if (remoteHttp?.includes('"conversationId" | "conversation_id"')) {
  add(remoteHttpFile, 'upload 禁止 conversation_id 兼容别名')
}
const transportFile = 'src/lib/transport.ts'
const transportSource = readAt(transportFile)
if ((transportSource?.match(/assertInvokeResponse<T>\(cmd, args, value\)/g)?.length ?? 0) !== 2) {
  add(transportFile, 'local tauriInvoke 与 remote { ok } 必须共用生成式 exact response validator')
}
if (/body\.ok\s+as\s+T\b/.test(transportSource ?? '') || /return\s+body\.ok\b/.test(transportSource ?? '')) {
  add(transportFile, 'invoke response 禁止 generic cast / unknown passthrough')
}
if (
  !/pub\(crate\) const API_REV:\s*u32\s*=\s*3;/.test(remoteHttp ?? '') ||
  !/pub\(crate\) const MIN_CLIENT_REV:\s*u32\s*=\s*3;/.test(remoteHttp ?? '') ||
  !/export const CLIENT_API_REV\s*=\s*3\b/.test(transportSource ?? '')
) {
  add(remoteHttpFile, 'Rust API_REV/MIN_CLIENT_REV 与 TypeScript CLIENT_API_REV 必须共同锁定为 3')
}

if (problems.length > 0) {
  console.error(`✗ 模型/DTO 硬性标准检查失败（${STAGED ? '暂存区' : '工作树'}），共 ${problems.length} 处：\n`)
  for (const problem of problems) console.error(`  · ${problem}`)
  process.exit(1)
}

console.log(
  `✓ 模型/DTO 硬性标准通过（${STAGED ? '暂存区' : '工作树'}）：严格 DTO / 分层命名 / typed JSON / Decimal money / exact response`,
)
