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
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SELF = fileURLToPath(import.meta.url)
const ROOT = join(dirname(SELF), '..')
const STAGED = process.argv.includes('--staged')

const CORE = 'src-tauri/crates/core/src'
const CATALOG_REL = `${CORE}/provider/provider_catalog.json`
const REGISTRY_REL = `${CORE}/provider/registry.rs`
const CAPABILITIES_REL = `${CORE}/provider/capabilities.rs`
const MODEL_CATALOG_REL = `${CORE}/provider/model_catalog.json`
const MIGRATIONS_REL = 'src-tauri/crates/core/migrations'

/** 数据库里 api_format 列的合法取值。迁移 10 建的列,NOT NULL DEFAULT 'chat_completions'。 */
const API_FORMATS = ['chat_completions', 'responses', 'gemma_tool', 'gemini_generate_content']

/**
 * transport_profile 的合法取值。
 *
 * `standard` 是今天所有 provider 走的路。`chatgpt_codex` 由 PR2b 引入,现在先
 * 认它,好让目录能提前描述它——但只要还没有 auth option 用它,这个名字就只是
 * 一个保留字。
 */
const TRANSPORT_PROFILES = ['standard', 'chatgpt_codex']

/** credential_kind 的合法取值。后两个由 PR2b 落地,理由同上。 */
const CREDENTIAL_KINDS = ['api_key', 'codex_cli', 'chatgpt_oauth']

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
}

function read(rel) {
  if (!STAGED) return readFileSync(join(ROOT, rel), 'utf8')
  try {
    return execFileSync('git', ['show', `:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 << 20 })
  } catch {
    // 暂存区里没有 = 这次提交没动它,回落到工作树。
    return readFileSync(join(ROOT, rel), 'utf8')
  }
}

const problems = []
const fail = (msg) => problems.push(msg)

// ── 目录本身 ────────────────────────────────────────────────────
let catalog
try {
  catalog = JSON.parse(read(CATALOG_REL))
} catch (e) {
  console.error(`✗ ${CATALOG_REL} 解析失败：${e.message}`)
  process.exit(1)
}

const entries = catalog.providers ?? []
if (entries.length === 0) fail('目录是空的')

// ── registry 接受哪些 provider_type ────────────────────────────
//
// 从 create_provider 的 match 臂里抠字符串字面量。这里只需要"它认得这个词",
// 所以宽松地扫 `"xxx" =>` 就够;真要精确解析 Rust 得上语法树,而这个校验的
// 失败模式是"目录写了个 registry 没听过的 type",宽松扫描完全够用。
const registrySrc = read(REGISTRY_REL)
const createFn = registrySrc.slice(registrySrc.indexOf('pub fn create_provider'))
const KNOWN_TYPES = new Set([...createFn.matchAll(/"([a-z0-9_]+)"\s*=>/g)].map((m) => m[1]))
if (KNOWN_TYPES.size === 0) fail(`没能从 ${REGISTRY_REL} 里认出任何 provider_type,校验器需要更新`)

// **没有明确分支不是错误。** `create_provider` 有 `_ =>` 兜底臂,落进去的是
// OpenAI 兼容适配器——而 openai 自己就没有专门分支,它正是那条兜底路径的原型。
// 一堆 OpenAI 兼容厂商共用它,恰恰是 catalog_id 与 provider_type 分开要达成的
// 效果。所以判据是"这个词至少被某一边认识",两边都不认识的才是拼错。
const HAS_FALLBACK_ARM = /_\s*=>/.test(createFn)

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
for (const entry of entries) {
  const at = `providers[${entry.id ?? '<无 id>'}]`

  if (!entry.id) fail(`${at}: 缺 id`)
  else if (seenIds.has(entry.id)) fail(`${at}: catalog id 重复`)
  else seenIds.add(entry.id)

  for (const field of ['provider_type', 'name', 'icon']) {
    if (!entry[field]) fail(`${at}: 缺 ${field}`)
  }

  // 注意验的是 provider_type,不是 entry.id——多家厂商共用一个 adapter 正是目录
  // 存在的意义。而 provider_type 本身也不要求有专门分支:没有分支就走兜底的
  // OpenAI 兼容适配器,openai 自己就是这么走的。所以只有"两边都不认识"才判错。
  const type = entry.provider_type
  if (type && !KNOWN_TYPES.has(type) && !NAMESPACES.has(type)) {
    const hint = HAS_FALLBACK_ARM ? '(它会落到兜底的 OpenAI 兼容适配器,多半是拼错了)' : ''
    fail(`${at}: create_provider 和 capabilities 都不认识 provider_type '${type}' ${hint}`)
  }

  const auth = entry.auth ?? []
  if (auth.length === 0) fail(`${at}: 至少要有一种登录方式`)

  const seenAuthIds = new Set()
  for (const option of auth) {
    const oat = `${at}.auth[${option.id ?? '<无 id>'}]`

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

    const formats = option.api_formats ?? []
    if (formats.length === 0) fail(`${oat}: 至少要声明一种 api_format`)
    for (const f of formats) {
      if (!API_FORMATS.includes(f)) fail(`${oat}: api_format '${f}' 不是数据库认的取值`)
    }

    // 预填地址必须能被声明过的方言取到,反过来也不许有多余的 key——多出来的那个
    // 永远不会被读到,是笔悄悄失效的配置。
    const urls = option.default_base_url ?? {}
    for (const f of formats) {
      if (!urls[f]) fail(`${oat}: 声明了 ${f} 却没有预填地址`)
    }
    for (const key of Object.keys(urls)) {
      if (!formats.includes(key)) fail(`${oat}: 预填了 ${key} 的地址,但 api_formats 里没有它`)
    }
  }

  // 预置模型列表:分组显式写死,id 精确。空列表是常态(有 /models 的厂商都靠拉取)。
  const seenModelIds = new Set()
  for (const group of entry.models ?? []) {
    if (!group.family) fail(`${at}: 模型分组缺 family`)
    for (const id of group.ids ?? []) {
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
