#!/usr/bin/env node
/**
 * 核对 `src-tauri/crates/providers/src/vendors/<id>/manifest.json` 和 Rust 权威代码
 * （`registry.rs`、`capabilities.rs`、`schema.snapshot.sql`）对不对得上。
 *
 * 每家厂商独立目录 `vendors/<id>/manifest.json`，`build.rs` 自动发现并嵌入；
 * 外部厂商提交 L1 PR 只需新增一个 `manifest.json` 文件，零 Rust、零前端改动。
 *
 *   node scripts/check-provider-catalog.mjs            核对工作树
 *   node scripts/check-provider-catalog.mjs --staged   核对暂存区(pre-commit 用这个)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sqlColumnDefault, sqlCreateTableBody } from './model-contract-rules.mjs'
import { stagedSnapshot } from './staged-snapshot.mjs'

const SELF = fileURLToPath(import.meta.url)
const ROOT = join(dirname(SELF), '..')
const STAGED = process.argv.includes('--staged')
const snapshot = STAGED ? stagedSnapshot(ROOT) : null

const PROVIDERS = 'src-tauri/crates/providers/src'
const VENDORS_DIR_REL = `${PROVIDERS}/vendors`
const MODELS_DIR_REL = `${PROVIDERS}/models`
const PROTOCOLS_REL = `${PROVIDERS}/protocols/mod.rs`
const REGISTRY_REL = `${PROVIDERS}/registry.rs`
const CAPABILITIES_REL = `${PROVIDERS}/capabilities.rs`
const SCHEMA_SNAPSHOT_REL = 'src-tauri/crates/core/schema.snapshot.sql'

const CAPABILITY_DOMAINS = ['chat', 'web_search', 'tts', 'embedding', 'image_gen', 'video_gen']
const CONFIG_FIELD_KINDS = ['text', 'secret', 'select', 'boolean', 'file_path', 'multiline_secret']
const TRANSPORT_PROFILES = ['standard', 'chatgpt_codex', 'local_native']
const CREDENTIAL_KINDS = ['api_key', 'google_vertex_service_account', 'codex_cli', 'chatgpt_oauth', 'none']
const CREDENTIALS_BY_TRANSPORT = {
  standard: ['api_key', 'google_vertex_service_account'],
  chatgpt_codex: ['codex_cli', 'chatgpt_oauth'],
  local_native: ['none'],
}

function read(rel) {
  if (!STAGED) return readFileSync(join(ROOT, rel), 'utf8')
  return snapshot.read(rel) ?? readFileSync(join(ROOT, rel), 'utf8')
}

function listManifestPaths() {
  if (STAGED) {
    return snapshot
      .list(VENDORS_DIR_REL)
      .filter((rel) => rel.endsWith('/manifest.json'))
      .sort()
  }
  const absDir = join(ROOT, VENDORS_DIR_REL)
  const paths = []
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const rel = `${VENDORS_DIR_REL}/${entry.name}/manifest.json`
    if (existsSync(join(ROOT, rel))) paths.push(rel)
  }
  return paths.sort()
}

const problems = []
const fail = (msg) => problems.push(msg)
const requireExactObject = (value, keys, at) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${at}: 必须是 object`)
    return false
  }
  const expected = new Set(keys)
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail(`${at}: 缺 ${key}`)
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail(`${at}: 未知字段 ${key}`)
  }
  return true
}

const manifestPaths = listManifestPaths()
if (manifestPaths.length === 0) {
  console.error(`✗ ${VENDORS_DIR_REL} 下没有找到任何 manifest.json`)
  process.exit(1)
}

const registrySrc = read(REGISTRY_REL)
const rustVariantToSnake = (variant) =>
  variant
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
const enumVariantsSnake = (name) => {
  const body = registrySrc.match(new RegExp(`pub enum ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
  return new Set([...body.matchAll(/^\s*([A-Z][A-Za-z0-9]*)\s*,\s*$/gm)].map((match) => rustVariantToSnake(match[1])))
}
const KNOWN_TYPES = enumVariantsSnake('ProviderType')
if (KNOWN_TYPES.size === 0) fail(`没能从 ${REGISTRY_REL} 里认出任何 provider_type,校验器需要更新`)

const API_FORMATS = [...enumVariantsSnake('ApiFormat')]
if (API_FORMATS.length === 0) fail(`没能从 ${REGISTRY_REL} 里认出任何 ApiFormat 变体,校验器需要更新`)

function listModelFamilyPaths() {
  if (STAGED) {
    return snapshot
      .list(MODELS_DIR_REL)
      .filter((rel) => rel.endsWith('.json'))
      .sort()
  }
  const absDir = join(ROOT, MODELS_DIR_REL)
  return readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => `${MODELS_DIR_REL}/${entry.name}`)
    .sort()
}

const capsSrc = read(CAPABILITIES_REL)
const resolveFn = capsSrc.slice(capsSrc.indexOf('pub fn resolve'))
const NAMESPACES = new Set([...resolveFn.matchAll(/"([a-z0-9_]+)"\s*\)/g)].map((m) => m[1]))
const protocolsSrc = read(PROTOCOLS_REL)
const KNOWN_PROTOCOLS = new Set([...protocolsSrc.matchAll(/id:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]))
const modelFamilyPaths = listModelFamilyPaths()
if (modelFamilyPaths.length === 0) fail(`${MODELS_DIR_REL} 下没有找到任何模型家族文件`)
for (const rel of modelFamilyPaths) {
  const stem = rel
    .split('/')
    .pop()
    .replace(/\.json$/, '')
  const familyDoc = JSON.parse(read(rel))
  if (familyDoc.family !== stem) fail(`${rel}: family '${familyDoc.family}' 必须与文件名 '${stem}' 一致`)
  if (!Array.isArray(familyDoc.canonical_protocols) || familyDoc.canonical_protocols.length === 0) {
    fail(`${rel}: 必须声明非空 canonical_protocols（官方标准协议）`)
  } else {
    for (const proto of familyDoc.canonical_protocols) {
      if (!KNOWN_PROTOCOLS.has(proto)) fail(`${rel}: canonical_protocols 包含未注册协议 '${proto}'`)
    }
  }
  if (typeof familyDoc.origin_vendor === 'string') NAMESPACES.add(familyDoc.origin_vendor)
}

const providersBody = sqlCreateTableBody(read(SCHEMA_SNAPSHOT_REL), 'providers')
const schemaDefault = providersBody == null ? null : sqlColumnDefault(providersBody, 'api_format')
if (schemaDefault == null) {
  fail(`${SCHEMA_SNAPSHOT_REL} 里没认出 providers.api_format 的 DEFAULT,校验器需要更新`)
} else if (!API_FORMATS.includes(schemaDefault)) {
  fail(`schema 里 providers.api_format 的默认值是 '${schemaDefault}',不是 ApiFormat 的变体`)
}

const seenIds = new Set()
for (const rel of manifestPaths) {
  const dirId = rel.split('/').slice(-2, -1)[0]
  const at = `vendors/${dirId}/manifest.json`
  let entry
  try {
    entry = JSON.parse(read(rel))
  } catch (e) {
    fail(`${at}: JSON 解析失败：${e.message}`)
    continue
  }

  if (
    !requireExactObject(
      entry,
      [
        'version',
        'id',
        'provider_type',
        'name',
        'icon',
        'sort_order',
        'domains',
        'balance',
        'websites',
        'auth',
        'config_fields',
        'models_dev',
        'models',
      ],
      at,
    )
  ) {
    continue
  }

  if (entry.version !== 1) fail(`${at}: version 必须是 1，当前为 ${JSON.stringify(entry.version)}`)
  if (entry.id !== dirId) fail(`${at}: id '${entry.id}' 必须与目录名 '${dirId}' 一致`)
  if (seenIds.has(entry.id)) fail(`${at}: vendor id 重复`)
  seenIds.add(entry.id)

  for (const field of ['name', 'icon']) {
    if (!entry[field]) fail(`${at}: 缺 ${field}`)
  }
  if (typeof entry.sort_order !== 'number' || !Number.isInteger(entry.sort_order)) {
    fail(`${at}: sort_order 必须是整数`)
  }
  if (typeof entry.balance !== 'boolean') fail(`${at}: balance 必须是 boolean`)

  const domains = Array.isArray(entry.domains) ? entry.domains : []
  if (!Array.isArray(entry.domains) || domains.length === 0) {
    fail(`${at}: domains 必须是非空 array`)
  }
  for (const d of domains) {
    if (!CAPABILITY_DOMAINS.includes(d)) fail(`${at}: 未知 capability domain '${d}'`)
  }

  if (requireExactObject(entry.websites, ['official', 'api_key', 'docs', 'models'], `${at}.websites`)) {
    for (const field of ['official', 'api_key', 'docs', 'models']) {
      if (entry.websites[field] !== null && typeof entry.websites[field] !== 'string') {
        fail(`${at}.websites.${field}: 必须是 string | null`)
      }
    }
  }

  if (entry.models_dev !== null) {
    if (requireExactObject(entry.models_dev, ['default', 'cn'], `${at}.models_dev`)) {
      for (const field of ['default', 'cn']) {
        if (!Array.isArray(entry.models_dev[field]) || entry.models_dev[field].some((x) => typeof x !== 'string')) {
          fail(`${at}.models_dev.${field}: 必须是 string[]`)
        }
      }
    }
  }

  const isChat = domains.includes('chat')
  if (isChat) {
    const type = entry.provider_type
    if (typeof type !== 'string' || !type) {
      fail(`${at}: chat 域厂商必须声明 provider_type`)
    } else if (!KNOWN_TYPES.has(type)) {
      fail(`${at}: ProviderType 不认识 provider_type '${type}'`)
    } else if (!NAMESPACES.has(type)) {
      fail(`${at}: capabilities 没有 provider_type '${type}' 的 namespace`)
    }
  } else if (entry.provider_type !== null) {
    fail(`${at}: 非 chat 域厂商 provider_type 应为 null`)
  }

  const auth = Array.isArray(entry.auth) ? entry.auth : []
  if (!Array.isArray(entry.auth)) fail(`${at}.auth: 必须是 array`)
  if (isChat && auth.length === 0) fail(`${at}: chat 域厂商至少要有一种登录方式`)

  const seenAuthIds = new Set()
  for (const [optionIndex, option] of auth.entries()) {
    const oat = `${at}.auth[${option?.id ?? optionIndex}]`
    if (
      !requireExactObject(
        option,
        ['id', 'credential_kind', 'transport_profile', 'api_formats', 'default_base_url'],
        oat,
      )
    ) {
      continue
    }

    if (!option.id) fail(`${oat}: 缺 id`)
    else if (seenAuthIds.has(option.id)) fail(`${oat}: auth id 在同一厂商下重复`)
    else seenAuthIds.add(option.id)

    const { credential_kind: cred, transport_profile: transport } = option
    if (!CREDENTIAL_KINDS.includes(cred)) fail(`${oat}: credential_kind '${cred}' 不认识`)
    if (!TRANSPORT_PROFILES.includes(transport)) fail(`${oat}: transport_profile '${transport}' 不认识`)

    if (CREDENTIALS_BY_TRANSPORT[transport] && !CREDENTIALS_BY_TRANSPORT[transport].includes(cred)) {
      fail(`${oat}: transport '${transport}' 不接受 credential_kind '${cred}'`)
    }

    const formats = Array.isArray(option.api_formats) ? option.api_formats : []
    if (!Array.isArray(option.api_formats)) fail(`${oat}.api_formats: 必须是 array`)
    if (formats.length === 0) fail(`${oat}: 至少要声明一种 api_format`)
    for (const f of formats) {
      if (!API_FORMATS.includes(f)) fail(`${oat}: api_format '${f}' 不是数据库认的取值`)
    }

    const urls =
      option.default_base_url !== null &&
      typeof option.default_base_url === 'object' &&
      !Array.isArray(option.default_base_url)
        ? option.default_base_url
        : {}
    if (urls !== option.default_base_url) fail(`${oat}.default_base_url: 必须是 object`)
    for (const f of formats) {
      if (!urls[f]) fail(`${oat}: 声明了 ${f} 却没有预填地址`)
    }
    for (const key of Object.keys(urls)) {
      if (!formats.includes(key)) fail(`${oat}: 预填了 ${key} 的地址,但 api_formats 里没有它`)
    }
  }

  const configFields = Array.isArray(entry.config_fields) ? entry.config_fields : []
  if (!Array.isArray(entry.config_fields)) fail(`${at}.config_fields: 必须是 array`)
  const seenConfigKeys = new Set()
  for (const [idx, field] of configFields.entries()) {
    const fat = `${at}.config_fields[${field?.key ?? idx}]`
    if (
      !requireExactObject(
        field,
        [
          'key',
          'label',
          'kind',
          'required',
          'secret',
          'default_value',
          'placeholder',
          'options',
          'visible_when_protocol',
          'visible_when_auth',
        ],
        fat,
      )
    ) {
      continue
    }
    if (!field.key) fail(`${fat}: 缺 key`)
    else if (seenConfigKeys.has(field.key)) fail(`${fat}: config_fields key 重复`)
    else seenConfigKeys.add(field.key)
    if (!CONFIG_FIELD_KINDS.includes(field.kind)) fail(`${fat}: 未知 kind '${field.kind}'`)
    if (typeof field.required !== 'boolean') fail(`${fat}: required 必须是 boolean`)
    if (typeof field.secret !== 'boolean') fail(`${fat}: secret 必须是 boolean`)
    if (field.kind === 'select' && (!Array.isArray(field.options) || field.options.length === 0)) {
      fail(`${fat}: select 类型字段必须提供非空 options`)
    }
  }

  const seenModelIds = new Set()
  const models = Array.isArray(entry.models) ? entry.models : []
  if (!Array.isArray(entry.models)) fail(`${at}.models: 必须是 array`)
  for (const [groupIndex, group] of models.entries()) {
    if (!requireExactObject(group, ['family', 'ids'], `${at}.models[${groupIndex}]`)) continue
    if (!group.family) fail(`${at}: 模型分组缺 family`)
    const ids = Array.isArray(group.ids) ? group.ids : []
    if (!Array.isArray(group.ids)) fail(`${at}.models[${groupIndex}].ids: 必须是 array`)
    for (const id of ids) {
      if (seenModelIds.has(id)) fail(`${at}: 模型 id '${id}' 在多个分组里出现`)
      seenModelIds.add(id)
    }
  }
}

if (problems.length > 0) {
  console.error(`✗ vendors/*/manifest.json 与代码对不上（${problems.length} 处）：\n`)
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}

console.log(
  `✓ vendors/*/manifest.json：${manifestPaths.length} 家厂商（全能力域），全部与 registry / capabilities 对得上`,
)
