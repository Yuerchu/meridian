/** Small, dependency-free syntax helpers used by the model contract guard. */
import { blank, functions, lineOf, matching, useAliases } from './transaction-graph-lib.mjs'

function blockAfter(source, declaration) {
  const match = declaration.exec(source)
  if (!match) return null
  const open = source.indexOf('{', match.index + match[0].length - 1)
  if (open < 0) return null

  let depth = 0
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote != null) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    const singleQuoteClosesOnLine =
      char === "'" && source.slice(index + 1, source.indexOf('\n', index + 1)).includes("'")
    if (char === '"' || char === '`' || singleQuoteClosesOnLine) {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  return null
}

export function rustStructBody(source, name) {
  return blockAfter(source, new RegExp(`^[ \\t]*(?:pub(?:\\([^)]*\\))?\\s+)?struct\\s+${name}\\b[^\\{]*\\{`, 'm'))
}

export function rustStructFields(source, name) {
  const body = rustStructBody(source, name)
  if (body == null) return null
  const fields = new Map()
  for (const match of body.matchAll(/^\s*(?:#\[[^\r\n]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(\w+)\s*:\s*(.+),\s*$/gm)) {
    fields.set(match[1], match[2].replace(/\s+/g, ' ').trim())
  }
  return fields
}

export function typescriptInterfaceBody(source, name) {
  return blockAfter(source, new RegExp(`export\\s+interface\\s+${name}\\b[^\\{]*\\{`, 'm'))
}

export function typescriptInterfaceFields(source, name) {
  const declarations = typescriptInterfaceFieldDeclarations(source, name)
  if (declarations == null) return null
  return new Map([...declarations].map(([field, declaration]) => [field, declaration.type]))
}

export function typescriptInterfaceFieldDeclarations(source, name) {
  const body = typescriptInterfaceBody(source, name)
  if (body == null) return null
  const fields = new Map()
  for (const match of body.matchAll(/^\s*(?:readonly\s+)?(\w+)(\?)?\s*:\s*([^;\r\n]+);?\s*$/gm)) {
    fields.set(match[1], {
      optional: match[2] === '?',
      type: match[3].replace(/\s+/g, ' ').trim(),
    })
  }
  return fields
}

export function rustStructDeclarations(source) {
  const declarations = []
  const pattern = /^[ \t]*((?:#\[[^\]]*\][ \t]*(?:\r?\n[ \t]*)?)*)(pub(?:\([^)]*\))?\s+)?struct\s+(\w+)\b/gm
  for (const match of source.matchAll(pattern)) {
    declarations.push({ attributes: match[1], isPublic: match[2] != null, name: match[3] })
  }
  return declarations
}

function splitTopLevelParameters(source) {
  const parameters = []
  let start = 0
  let angle = 0
  let paren = 0
  let bracket = 0
  let brace = 0
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '<') angle += 1
    else if (char === '>') angle = Math.max(0, angle - 1)
    else if (char === '(') paren += 1
    else if (char === ')') paren = Math.max(0, paren - 1)
    else if (char === '[') bracket += 1
    else if (char === ']') bracket = Math.max(0, bracket - 1)
    else if (char === '{') brace += 1
    else if (char === '}') brace = Math.max(0, brace - 1)
    else if (char === ',' && angle === 0 && paren === 0 && bracket === 0 && brace === 0) {
      parameters.push(source.slice(start, index))
      start = index + 1
    }
  }
  parameters.push(source.slice(start))
  return parameters
}

export function rustTauriCommandDeclarations(source) {
  const declarations = []
  // Instrumentation attributes can be verbose (the chat command records a
  // dozen named fields) and sit between `tauri::command` and `fn`. Keep the
  // scan bounded, but large enough that a legitimate annotated command is not
  // silently absent from every contract rule.
  const pattern = /#\[tauri::command\][\s\S]{0,2000}?\b(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([\s\S]*?)\)\s*->/g
  for (const match of source.matchAll(pattern)) {
    const parameters = []
    for (const raw of splitTopLevelParameters(match[2])) {
      const parameter = raw.trim().match(/^(\w+)\s*:\s*([\s\S]+)$/)
      if (parameter) parameters.push({ name: parameter[1], type: parameter[2].replace(/\s+/g, ' ').trim() })
    }
    declarations.push({ name: match[1], parameters })
  }
  return declarations
}

/**
 * A duration or a tally, which is never an amount of money however the rest of
 * the name reads. `balance_interval_minutes` is how often to ask an upstream
 * for a balance; `baseline_windows` is a count of time windows. Without this
 * the money rule forces those to be renamed away from the word the domain
 * actually uses, which costs clarity to satisfy a heuristic.
 */
const UNIT_SUFFIX = /_(?:ms|secs|seconds|minutes|hours|days|tokens|count|windows|messages)$/

export function isMoneyLeafField(name) {
  if (name === 'balance') return false // provider catalog capability, not an amount
  // A flag is not an amount. `balance_watch_enabled` says whether to look, and
  // the value it eventually reports is a separate Decimal field.
  if (isBooleanField(name)) return false
  if (UNIT_SUFFIX.test(name)) return false
  return /(?:^|_)(?:price|cost|balance|amount)(?:_|$)/.test(name)
}

export function isBooleanField(name) {
  return (
    /^(?:is|has|can|supports)_/.test(name) ||
    /_enabled$/.test(name) ||
    ['accept_edits', 'fast_mode', 'opted_out', 'retry_without_sandbox', 'truncated'].includes(name)
  )
}

/**
 * Find JSON decoding chains that reinterpret malformed first-party input as an
 * empty/default value. Deliberate optional probes that merely return `None`
 * are not matched.
 */
export function forbiddenJsonFallbacks(source) {
  const findings = []
  const emptyValue = String.raw`(?:(?:serde_json::)?json!\s*\(\s*[\{\[]\s*[\}\]]\s*\)|(?:Vec|HashMap|BTreeMap|String)::new\s*\(\s*\)|(?:Default|Option)::default\s*\(\s*\)|(?:serde_json::)?Value::Null)`
  const patterns = [
    /serde_json::from_(?:str|slice|value)\s*(?:::<[^;\r\n]+?>)?\s*\([^()\r\n]*\)\s*\.unwrap_or_default\s*\(\s*\)/g,
    /serde_json::from_(?:str|slice|value)\s*(?:::<[^;\r\n]+?>)?\s*\([^()\r\n]*\)\s*\.ok\s*\(\s*\)[^;]{0,500}?\.unwrap_or_default\s*\(\s*\)/g,
    new RegExp(
      String.raw`serde_json::from_(?:str|slice|value)\s*(?:::<[^;\r\n]+?>)?\s*\([^()\r\n]*\)\s*\.unwrap_or\s*\(\s*${emptyValue}\s*\)`,
      'g',
    ),
    new RegExp(
      String.raw`serde_json::from_(?:str|slice|value)\s*(?:::<[^;\r\n]+?>)?\s*\([^()\r\n]*\)\s*\.unwrap_or_else\s*\(\s*\|_\|\s*${emptyValue}\s*\)`,
      'g',
    ),
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      findings.push({
        index: match.index,
        line: source.slice(0, match.index).split(/\r?\n/).length,
        text: match[0],
      })
    }
  }
  return findings.sort((left, right) => left.index - right.index)
}

// ── SeaORM 一侧 ────────────────────────────────────────────────────────────────
//
// 下面这些与事务调用图共用同一套近似解析（抹掉注释与字符串、函数切分、`use` 展开），
// 所以 SQL 字符串里的 `Statement` 字样和文档注释里的示例都骗不到它们。

/**
 * `schema.snapshot.sql` 里 `CREATE TABLE "table" ( … )` 的括号内文本。
 *
 * 表由 sea-query 渲染在一行上，但 CHECK 子句保留原文、会跨行，所以不能按行取；
 * 括号配对要跳过引号里的内容——金额格式的 CHECK 里有 `'*[^0-9.]*'` 这样的字面量。
 */
export function sqlCreateTableBody(sql, table) {
  const match = new RegExp(`CREATE TABLE "${table}"\\s*\\(`).exec(sql)
  if (!match) return null
  const open = match.index + match[0].length - 1
  let depth = 0
  let quote = null
  for (let index = open; index < sql.length; index += 1) {
    const char = sql[index]
    if (quote != null) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return sql.slice(open + 1, index)
    }
  }
  return null
}

/** 表体里某列的 DEFAULT 字面量（去掉引号）；没有 DEFAULT 或没有这列时为 null。 */
export function sqlColumnDefault(tableBody, column) {
  const match = new RegExp(`"${column}"\\s+\\w+(?:\\s+NOT NULL)?\\s+DEFAULT\\s+(?:'([^']*)'|([^\\s,]+))`).exec(
    tableBody,
  )
  if (!match) return null
  return match[1] ?? match[2]
}

/**
 * 金额列的 canonical TEXT CHECK（迁移 49 引入、基线原样保留）：列声明为 text，且有
 * `CHECK (col IS NULL OR col = '0' OR (typeof(col) = 'text' AND …))`。显式检查
 * storage class，是因为 SQLite 的 TEXT 亲和不拒绝数字：没有 typeof 那一句，`0.5`
 * 这样的 REAL 也进得去，之后读出来的就是二进制浮点。
 */
export function hasCanonicalDecimalCheck(tableBody, column) {
  const declared = new RegExp(`"${column}"\\s+text\\b`).test(tableBody)
  const check = new RegExp(
    `CHECK\\s*\\(\\s*${column}\\s+IS\\s+NULL\\s+OR\\s+${column}\\s*=\\s*'0'\\s+OR\\s*\\(\\s*typeof\\(${column}\\)\\s*=\\s*'text'\\s+AND`,
  )
  return declared && check.test(tableBody)
}

/**
 * 把测试代码抹成空白，偏移不变：`#[cfg(test)] mod x { … }` 整块，以及 `#[cfg(test)]`、
 * `#[test]`、`#[tokio::test]` 标的函数。注释和字符串也一并抹掉（见 blank）。
 * 之后的正则看到的就只有生产代码。
 */
export function rustProductionText(source) {
  const text = blank(source)
  const out = text.split('')
  const wipe = (from, to) => {
    for (let index = from; index < to; index += 1) if (out[index] !== '\n') out[index] = ' '
  }
  const modules = /#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/g
  let match
  while ((match = modules.exec(text))) {
    const open = match.index + match[0].length - 1
    const close = matching(text, open)
    if (close > 0) wipe(match.index, close + 1)
  }
  for (const fn of functions(text)) if (fn.test) wipe(fn.at, fn.body[1] + 1)
  return out.join('')
}

/**
 * 整个文件都是测试代码的那些：`tests.rs`、`*_tests.rs`，以及被某处 `#[cfg(test)] mod x;`
 * 声明进来的文件（`db/sea/poc.rs` 就是这样进来的）。声明在 `mod.rs`/`lib.rs` 里时子文件
 * 与它同目录，声明在 `foo.rs` 里时在 `foo/` 下。
 */
export function rustTestOnlyFiles(paths, readSource) {
  const files = new Set()
  for (const path of paths) {
    const base = path.slice(path.lastIndexOf('/') + 1)
    if (base === 'tests.rs' || base.endsWith('_tests.rs')) files.add(path)
    const source = readSource(path)
    if (source == null) continue
    const dir = path.slice(0, path.lastIndexOf('/'))
    const childDir = ['mod.rs', 'lib.rs', 'main.rs'].includes(base) ? dir : `${dir}/${base.slice(0, -3)}`
    for (const match of blank(source).matchAll(/#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g)) {
      files.add(`${childDir}/${match[1]}.rs`)
      files.add(`${childDir}/${match[1]}/mod.rs`)
    }
  }
  return files
}

const ENTITY_ITEM = /(?:^|::)entity::(?:\w+::)*(Model|ActiveModel|Entity|Column)$/

/**
 * 实体的 `Model` / `ActiveModel` / `Entity` / `Column` 被裸导入进来的 `use`。实体只在
 * `db/entity/` 下声明（另一条规则钉住），所以它们的路径一定经过 `entity::` 这一段——
 * `introspect::Column` 那种同名的别物就不会误报。`use entity::conversation;` 之后写
 * `conversation::Entity` 是允许的写法：实体名在每个用处都看得见。
 */
export function bareEntityImports(productionText) {
  const findings = []
  for (const [name, path] of useAliases(productionText)) {
    const item = ENTITY_ITEM.exec(path)?.[1]
    if (item) findings.push({ name, path, item })
  }
  return findings
}

/** `type X = …::Model;` 这类给实体起的别名：实体类型不离开 db/entity，经 sea/ops 的函数签名暴露。 */
export function entityTypeAliases(productionText) {
  return [
    ...productionText.matchAll(
      /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=\s*((?:\w+::)+(?:Model|ActiveModel|Entity))\s*;/gm,
    ),
  ].map((match) => ({ name: match[1], target: match[2], line: lineOf(productionText, match.index) }))
}

const DECIMAL_TYPE = /^(?:Option<)?(?:[\w:]+::)?Decimal>?$/
const SQL_BOOL_TYPE = /^(?:Option<)?(?:[\w:]+::)?SqlBool>?$/
const EPOCH_MS_TYPE = /^(?:Option<)?(?:[\w:]+::)?EpochMs>?$/

/**
 * `db/entity/` 下一个文件里的实体规则。
 *
 * - `Model` / `ActiveModel` 不派生 Serialize / Deserialize：实体不是 wire 契约，出去要经 InfoResponse。
 * - `DerivePartialModel` 的结构体以 Projection 结尾，一眼能看出它只是列的子集。
 * - 列类型：金额列 Decimal、0/1 标志列 SqlBool、`*_at` 列 EpochMs，别处不得出现 bool——
 *   sqlx 把任何非零整数读成 true，SqlBool 存在的理由就是在边界上拒绝 2。
 */
export function seaEntityProblems(source) {
  const text = rustProductionText(source)
  const problems = []
  for (const { attributes, name } of rustStructDeclarations(text)) {
    if ((name === 'Model' || name === 'ActiveModel') && /\b(?:Serialize|Deserialize)\b/.test(attributes)) {
      problems.push(`${name} 不得派生 Serialize / Deserialize：实体不是 wire 契约，经 InfoResponse 出去`)
    }
    if (/\bDerivePartialModel\b/.test(attributes) && !name.endsWith('Projection')) {
      problems.push(`${name} 派生了 DerivePartialModel，名字必须以 Projection 结尾`)
    }
    if (!/\bDeriveEntityModel\b/.test(attributes)) continue
    for (const [field, type] of rustStructFields(text, name) ?? []) {
      if (isMoneyLeafField(field)) {
        if (!DECIMAL_TYPE.test(type)) {
          problems.push(`${name}.${field} 是金额列，必须是 Decimal / Option<Decimal>，当前为 ${type}`)
        }
      } else if (isBooleanField(field)) {
        if (!SQL_BOOL_TYPE.test(type)) {
          problems.push(`${name}.${field} 是 0/1 标志列，必须是 SqlBool / Option<SqlBool>，当前为 ${type}`)
        }
      } else if (field.endsWith('_at')) {
        if (!EPOCH_MS_TYPE.test(type)) {
          problems.push(`${name}.${field} 是时间列，必须是 EpochMs / Option<EpochMs>，当前为 ${type}`)
        }
      } else if (/\bbool\b/.test(type)) {
        problems.push(`${name}.${field} 不得用 bool：sqlx 把任何非零整数读成 true，用 SqlBool`)
      }
    }
  }
  return problems
}

/**
 * `SqlBool::from_stored` 必须恰好是 `0 =>`、`1 =>`、`_ => None` 三个分支——这是 SeaORM 侧
 * 与 `decode_sqlite_bool` 对应的那一道严格 0/1 转换。
 */
export function sqlBoolProblems(source) {
  const problems = []
  if (!/pub struct SqlBool\(bool\);/.test(source)) {
    problems.push('缺少 SeaORM 侧的严格 0/1 标志类型 pub struct SqlBool(bool)')
  }
  if (!/pub type EpochMs = i64;/.test(source)) problems.push('缺少 pub type EpochMs = i64')
  const body = source.match(/fn from_stored\(raw: i32\) -> Option<Self>\s*\{([\s\S]*?)\n\s*\}/)?.[1]
  if (body == null) {
    problems.push('SqlBool 缺少 fn from_stored(raw: i32) -> Option<Self>')
    return problems
  }
  const arms = [...body.matchAll(/^\s*(\S+)\s*=>\s*([^,\r\n]+),?\s*$/gm)].map((match) => [match[1], match[2].trim()])
  const expected = [
    ['0', 'Some(Self::FALSE)'],
    ['1', 'Some(Self::TRUE)'],
    ['_', 'None'],
  ]
  if (JSON.stringify(arms) !== JSON.stringify(expected)) {
    const actual = arms.map((arm) => arm.join(' => ')).join('；') || '（没认出分支）'
    problems.push(
      `SqlBool::from_stored 必须恰好是 0 => Some(Self::FALSE)、1 => Some(Self::TRUE)、_ => None，当前为 ${actual}`,
    )
  }
  return problems
}
