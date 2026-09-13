#!/usr/bin/env node
/**
 * 核对 provider_catalog.json 和 Rust 那边真正认的东西对不对得上。
 *
 * 这份目录是**展示层**：厂商叫什么、图标是哪个、去哪拿密钥、新建时预填什么。
 * 它有意不决定行为——`registry::create_provider`、`capabilities::resolve`、
 * `balance::supports_balance` 仍然是权威。但正因为它只是数据，一旦和权威那边
 * 对不上，它会以一副很有把握的样子出错：目录里写着某家走 responses，实际
 * adapter 根本不认这个 provider_type，用户建出来的行发不出请求。
 *
 * **要验的是分层，不是"每个 catalog id 都有 Rust 分支"**。后者会重新制造
 * "一家兼容厂商一个 adapter"的耦合，而 catalog_id 与 provider_type 分开正是
 * 为了消灭它:硅基流动和 OpenAI 都是 provider_type=openai,只是身份不同。
 * 所以验的是 entry 声明的 provider_type 能被 registry 接受,而不是 id 本身。
 *
 * 逐个 auth option 验完整组合,不是只验 entry 一层——端点和方言随登录方式走,
 * 那才是组合合法与否的粒度。
 *
 *   node scripts/check-provider-catalog.mjs            核对工作树
 *   node scripts/check-provider-catalog.mjs --staged   核对暂存区(pre-commit 用这个)
 *
 * --staged 的理由和 check-db-schema.mjs 一样:只暂存了目录、把 registry 的改动
 * 留在工作区没暂存,读工作树会通过,而提交进去的两半对不上。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stagedSnapshot } from './staged-snapshot.mjs'

const SELF = fileURLToPath(import.meta.url)
const ROOT = join(dirname(SELF), '..')
const STAGED = process.argv.includes('--staged')
// 目录和 registry 都在 meridian-core 子模块里,「暂存」在那边指外层将要指向的
// commit——见 staged-snapshot.mjs。
const snapshot = STAGED ? stagedSnapshot(ROOT) : null

const CORE = 'src-tauri/crates/core/src'
const CATALOG_REL = `${CORE}/provider/provider_catalog.json`
const REGISTRY_REL = `${CORE}/provider/registry.rs`
const CAPABILITIES_REL = `${CORE}/provider/capabilities.rs`
const MODEL_CATALOG_REL = `${CORE}/provider/model_catalog.json`
const MIGRATIONS_REL = 'src-tauri/crates/core/migrations'

/** 数据库里 api_format 列的合法取值。迁移 10 建的列,NOT NULL DEFAULT 'chat_completions'。 */
const API_FORMATS = ['chat_completions', 'responses', 'gemma_tool', 'gemini_generate_content', 'litert_lm']

/**
 * transport_profile 的合法取值。
 *
 * `standard` 是今天所有 provider 走的路。`chatgpt_codex` 由 PR2b 引入,现在先
 * 认它,好让目录能提前描述它——但只要还没有 auth option 用它,这个名字就只是
 * 一个保留字。
 */
const TRANSPORT_PROFILES = ['standard', 'chatgpt_codex', 'local_native']

/** credential_kind 的合法取值。后两个由 PR2b 落地,理由同上。 */
const CREDENTIAL_KINDS = ['api_key', 'codex_cli', 'chatgpt_oauth', 'none']

/**
 * transport_profile 与 credential_kind 的合法搭配。
 *
 * 一个 transport 可以被多个 credential kind 共用——这正是三层分层在数据里的
 * 样子:两种 ChatGPT 登录方式拿到的是同一种 token、走同一条 wire,不该产生两个
 * adapter。反过来不成立:codex_cli 拿到的是 ChatGPT 的 token,喂给标准 OpenAI
 * 端点没有意义。
 */
const CREDENTIALS_BY_TRANSPORT = {
  standard: ['api_key'],
  chatgpt_codex: ['codex_cli', 'chatgpt_oauth'],
  local_native: ['none'],
}

function read(rel) {
  if (!STAGED) return readFileSync(join(ROOT, rel), 'utf8')
  // 暂存区里没有 = 这次提交没动它,回落到工作树。
  return snapshot.read(rel) ?? readFileSync(join(ROOT, rel), 'utf8')
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

// ── 目录本身 ────────────────────────────────────────────────────
let catalog
try {
  catalog = JSON.parse(read(CATALOG_REL))
} catch (e) {
  console.error(`✗ ${CATALOG_REL} 解析失败：${e.message}`)
  process.exit(1)
}

requireExactObject(catalog, ['version', '_comment', 'providers'], 'catalog')
if (catalog.version !== 1) fail(`catalog.version 必须是 1，当前为 ${JSON.stringify(catalog.version)}`)
if (!Array.isArray(catalog._comment) || catalog._comment.some((line) => typeof line !== 'string')) {
  fail('catalog._comment 必须是 string[]')
}
const entries = Array.isArray(catalog.providers) ? catalog.providers : []
if (!Array.isArray(catalog.providers)) fail('catalog.providers 必须是 array')
if (entries.length === 0) fail('目录是空的')

// ── registry 接受哪些 provider_type ────────────────────────────
//
// `ProviderType` 已经是闭合枚举；目录必须与它对账，不能再靠
// `create_provider` 的字符串分支或兜底臂猜测。枚举当前只有无载荷单元变体，
// `strum(serialize_all = "snake_case")` 决定持久化/IPC 拼写。
const registrySrc = read(REGISTRY_REL)
const providerTypeBody = registrySrc.match(/pub enum ProviderType\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const rustVariantToSnake = (variant) =>
  variant
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
const KNOWN_TYPES = new Set(
  [...providerTypeBody.matchAll(/^\s*([A-Z][A-Za-z0-9]*)\s*,\s*$/gm)].map((match) => rustVariantToSnake(match[1])),
)
if (KNOWN_TYPES.size === 0) fail(`没能从 ${REGISTRY_REL} 里认出任何 provider_type,校验器需要更新`)

// `create_provider` 对这个枚举做穷尽匹配；未知 provider_type 在 parse 时即失败。
// 多家兼容厂商仍可共享 `ProviderType::Openai`，共享的是已声明的类型，不是未知值兜底。

// ── capabilities 认哪些 catalog namespace ──────────────────────
const capsSrc = read(CAPABILITIES_REL)
const resolveFn = capsSrc.slice(capsSrc.indexOf('pub fn resolve'))
const NAMESPACES = new Set([...resolveFn.matchAll(/"([a-z0-9_]+)"\s*\)/g)].map((m) => m[1]))
const modelCatalog = JSON.parse(read(MODEL_CATALOG_REL))
for (const m of modelCatalog.models ?? []) NAMESPACES.add(m.provider)

// ── api_format 列的合法取值,和迁移对账 ────────────────────────
//
// 迁移里那句 DEFAULT 是这一列语义的唯一出处。上面 API_FORMATS 是手写的常量,
// 这里确认它至少包含迁移声明的默认值——默认值要是变了而常量没跟上,后面所有
// 校验都建立在一个过时的集合上。
const migrationDefault = (() => {
  const sql = read(`${MIGRATIONS_REL}/00000000000010_provider_api_format/up.sql`)
  return sql.match(/DEFAULT\s+'([a-z_]+)'/)?.[1]
})()
if (migrationDefault && !API_FORMATS.includes(migrationDefault)) {
  fail(`迁移 10 的 api_format 默认值是 '${migrationDefault}',不在校验器的 API_FORMATS 里`)
}

// ── 逐条 entry ─────────────────────────────────────────────────
const seenIds = new Set()
for (const [entryIndex, entry] of entries.entries()) {
  const at = `providers[${entry?.id ?? entryIndex}]`
  if (
    !requireExactObject(entry, ['id', 'provider_type', 'name', 'icon', 'balance', 'websites', 'auth', 'models'], at)
  ) {
    continue
  }

  if (!entry.id) fail(`${at}: 缺 id`)
  else if (seenIds.has(entry.id)) fail(`${at}: catalog id 重复`)
  else seenIds.add(entry.id)

  for (const field of ['provider_type', 'name', 'icon']) {
    if (!entry[field]) fail(`${at}: 缺 ${field}`)
  }
  if (typeof entry.balance !== 'boolean') fail(`${at}: balance 必须是 boolean`)

  if (requireExactObject(entry.websites, ['official', 'api_key', 'docs', 'models'], `${at}.websites`)) {
    for (const field of ['official', 'api_key', 'docs', 'models']) {
      if (entry.websites[field] !== null && typeof entry.websites[field] !== 'string') {
        fail(`${at}.websites.${field}: 必须是 string | null`)
      }
    }
  }

  // 注意验的是 provider_type,不是 entry.id——多家厂商共用一个 adapter 正是目录
  // 存在的意义。provider_type 本身必须是闭合枚举中的一个值；capabilities 的
  // namespace 不能替一个拼错的运行时类型开后门。
  const type = entry.provider_type
  if (type && !KNOWN_TYPES.has(type)) {
    fail(`${at}: ProviderType 不认识 provider_type '${type}'`)
  } else if (type && !NAMESPACES.has(type)) {
    fail(`${at}: capabilities 没有 provider_type '${type}' 的 namespace`)
  }

  const auth = Array.isArray(entry.auth) ? entry.auth : []
  if (!Array.isArray(entry.auth)) fail(`${at}.auth: 必须是 array`)
  if (auth.length === 0) fail(`${at}: 至少要有一种登录方式`)

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

    // 组合合法性:一个 transport 可以被多个 credential kind 共用,反之不然。
    if (CREDENTIALS_BY_TRANSPORT[transport] && !CREDENTIALS_BY_TRANSPORT[transport].includes(cred)) {
      fail(`${oat}: transport '${transport}' 不接受 credential_kind '${cred}'`)
    }

    const formats = Array.isArray(option.api_formats) ? option.api_formats : []
    if (!Array.isArray(option.api_formats)) fail(`${oat}.api_formats: 必须是 array`)
    if (formats.length === 0) fail(`${oat}: 至少要声明一种 api_format`)
    for (const f of formats) {
      if (!API_FORMATS.includes(f)) fail(`${oat}: api_format '${f}' 不是数据库认的取值`)
    }

    // 预填地址必须能被声明过的方言取到,反过来也不许有多余的 key——多出来的那个
    // 永远不会被读到,是笔悄悄失效的配置。
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

  // 预置模型列表:分组显式写死,id 精确。空列表是常态(有 /models 的厂商都靠拉取)。
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

// ── 收尾 ───────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error(`✗ provider_catalog.json 与代码对不上（${problems.length} 处）：\n`)
  for (const p of problems) console.error(`  · ${p}`)
  console.error(
    `\n  目录只描述展示与预填,不决定行为;真正的权威是 create_provider /\n` +
      `  capabilities::resolve / supports_balance。一份和它们对不上的目录,\n` +
      `  会以很有把握的样子出错。`,
  )
  process.exit(1)
}

console.log(`✓ provider_catalog.json：${entries.length} 家厂商，全部与 registry / capabilities 对得上`)
