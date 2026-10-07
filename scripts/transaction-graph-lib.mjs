/**
 * 事务调用图的解析部分：把 Rust 源码切成函数、`use` 别名和事务根。
 *
 * 不是 Rust 解析器，是够用的近似：先把注释、字符串、字符字面量抹成空格（保持
 * 偏移不变），之后的括号匹配和正则就不会被 SQL 字符串里的 `{`、`(` 骗到。
 * 它答的问题只有一个——某个事务闭包里传递调用到了哪些函数——所以只认自由函数
 * 调用（`a::b::f(`、`f(`）；方法调用 `.f(` 只在识别事务入口时用到。
 */

/** 抹掉注释、字符串、字符字面量；生命周期 `'a` 保留。返回等长字符串。 */
export function blank(source) {
  const out = source.split('')
  const n = source.length
  const wipe = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  while (i < n) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      let j = i
      while (j < n && source[j] !== '\n') j++
      wipe(i, j)
      i = j
    } else if (c === '/' && next === '*') {
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (source[j] === '/' && source[j + 1] === '*') {
          depth++
          j += 2
        } else if (source[j] === '*' && source[j + 1] === '/') {
          depth--
          j += 2
        } else j++
      }
      wipe(i, j)
      i = j
    } else if ((c === 'r' || (c === 'b' && next === 'r')) && /^b?r#*"/.test(source.slice(i, i + 40))) {
      const head = /^b?r(#*)"/.exec(source.slice(i, i + 40))
      const close = `"${head[1]}`
      const end = source.indexOf(close, i + head[0].length)
      const j = end < 0 ? n : end + close.length
      wipe(i, j)
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < n && source[j] !== '"') j += source[j] === '\\' ? 2 : 1
      wipe(i, j + 1)
      i = j + 1
    } else if (c === "'") {
      // 字符字面量：'x'、'\n'、'\u{..}'；否则是生命周期，原样保留。
      const m = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/.exec(source.slice(i, i + 12))
      if (m) {
        wipe(i, i + m[0].length)
        i += m[0].length
      } else i++
    } else i++
  }
  return out.join('')
}

/** 从 `open`（必须是 `(`、`{`、`[`）找到配对的闭合位置。 */
export function matching(text, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' }
  const want = pairs[text[open]]
  if (!want) throw new Error(`matching: not an opener at ${open}`)
  const stack = []
  for (let k = open; k < text.length; k++) {
    const ch = text[k]
    if (pairs[ch]) stack.push(pairs[ch])
    else if (ch === ')' || ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1
      if (stack.length === 0) return k
    }
  }
  return -1
}

export function lineOf(text, offset) {
  let line = 1
  for (let k = 0; k < offset && k < text.length; k++) if (text[k] === '\n') line++
  return line
}

/** `#[cfg(test)]` 模块的区间；里面的函数标成测试代码。 */
function testRanges(text) {
  const ranges = []
  const re = /#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/g
  let m
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1
    const close = matching(text, open)
    if (close > 0) ranges.push([open, close])
  }
  return ranges
}

/**
 * 文件里的全部 `fn`：名字、参数文本、函数体区间、是否在测试模块里。
 * 嵌套函数也会各自出现一次；外层函数体区间包含内层，这对"区间内调用"无害。
 */
export function functions(text) {
  const tests = testRanges(text)
  const found = []
  const re = /\bfn\s+(\w+)\s*(?:<[^{;]*?>)?\s*\(/g
  let m
  while ((m = re.exec(text))) {
    const paramsOpen = m.index + m[0].length - 1
    const paramsClose = matching(text, paramsOpen)
    if (paramsClose < 0) continue
    let k = paramsClose + 1
    // 跳过返回类型和 where 子句，直到函数体的 `{` 或声明结尾的 `;`。
    let depth = 0
    while (k < text.length) {
      const ch = text[k]
      if (ch === '<') depth++
      else if (ch === '>' && text[k - 1] !== '-') depth--
      else if (depth <= 0 && (ch === '{' || ch === ';')) break
      k++
    }
    if (text[k] !== '{') continue
    const bodyClose = matching(text, k)
    if (bodyClose < 0) continue
    // 函数自己的属性：上一个 `;`、`{`、`}` 之后到 `fn` 之间的那一段。
    const lead = text.slice(Math.max(0, m.index - 400), m.index)
    const attrs = lead.slice(Math.max(lead.lastIndexOf(';'), lead.lastIndexOf('{'), lead.lastIndexOf('}')) + 1)
    const gated = /#\[\s*(?:cfg\s*\(\s*test\s*\)|test|tokio::test\b[^\]]*)\s*\]/.test(attrs)
    found.push({
      name: m[1],
      at: m.index,
      params: text.slice(paramsOpen + 1, paramsClose),
      signature: text.slice(m.index, k),
      body: [k, bodyClose],
      test: gated || tests.some(([a, b]) => m.index > a && m.index < b),
    })
  }
  return found
}

/**
 * `use` 带进来的名字 → 完整路径（`a::b::c`）。处理 `use p::q;`、`use p::q as r;`、
 * `use p::{q, r as s, t::{u}};`、`use p::q::{self}`。通配 `*` 忽略。
 */
export function useAliases(text) {
  const aliases = new Map()
  const re = /\buse\s+([^;]+);/g
  let m
  while ((m = re.exec(text))) expandUse(normalizeUse(m[1]), '', aliases)
  return aliases
}

/**
 * 按作用域查 `use` 别名：一条 `use` 只在包住它的那对花括号里生效（模块、函数、
 * 块都是），文件顶层的对整个文件生效。同名时取离调用点最近的那一层——
 * `#[cfg(test)] mod tests { use x as ops; }` 不会改写生产代码里的 `ops`。
 */
export function aliasScopes(text) {
  const blocks = []
  const stack = []
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '{') stack.push(k)
    else if (text[k] === '}' && stack.length) blocks.push([stack.pop(), k])
  }
  const enclosing = (at) => {
    let best = [0, text.length]
    for (const b of blocks) if (b[0] < at && at < b[1] && b[0] >= best[0]) best = b
    return best
  }
  const entries = []
  const re = /\buse\s+([^;]+);/g
  let m
  while ((m = re.exec(text))) {
    const local = new Map()
    expandUse(normalizeUse(m[1]), '', local)
    const scope = enclosing(m.index)
    for (const [name, path] of local) entries.push({ name, path, scope })
  }
  return {
    get(name, at) {
      let best = null
      for (const e of entries) {
        if (e.name !== name || at < e.scope[0] || at > e.scope[1]) continue
        if (!best || e.scope[0] >= best.scope[0]) best = e
      }
      return best ? best.path : undefined
    },
  }
}

/** 空白只在 `::`、花括号和逗号两侧去掉；`as` 两侧的空格要留着，那是它作为
 * 关键字的唯一标志——全删掉的话 `ops::assistant` 里的 "as" 会被当成别名。 */
function normalizeUse(tree) {
  return tree
    .replace(/\s+/g, ' ')
    .replace(/\s*(::|\{|\}|,)\s*/g, '$1')
    .trim()
}

function expandUse(tree, prefix, aliases) {
  const brace = tree.indexOf('{')
  if (brace < 0) {
    const [path, alias] = tree.trim().split(/\s+as\s+/)
    const full = joinPath(prefix, path)
    if (full.endsWith('*')) return
    if (full.endsWith('::self')) {
      const base = full.slice(0, -'::self'.length)
      aliases.set(alias || base.split('::').pop(), base)
      return
    }
    aliases.set(alias || full.split('::').pop(), full)
    return
  }
  const head = tree.slice(0, brace).replace(/::$/, '')
  const inner = tree.slice(brace + 1, tree.lastIndexOf('}'))
  for (const part of splitTop(inner)) if (part) expandUse(part, joinPath(prefix, head), aliases)
}

function joinPath(a, b) {
  if (!a) return b
  if (!b) return a
  return `${a}::${b}`
}

function splitTop(s) {
  const parts = []
  let depth = 0
  let start = 0
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '{') depth++
    else if (s[k] === '}') depth--
    else if (s[k] === ',' && depth === 0) {
      parts.push(s.slice(start, k))
      start = k + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

/**
 * 事务根：Diesel 的 `.transaction(` / `.immediate_transaction(`，SeaORM 能力类型的
 * `.write(async` / `.read(async` / `.nested(async`。返回闭包所在的实参区间。
 */
export function transactionRoots(text) {
  const roots = []
  const re = /\.\s*(immediate_transaction|transaction|write|read|nested)\s*(?:::<[^>]*>)?\s*\(/g
  let m
  while ((m = re.exec(text))) {
    const method = m[1]
    const open = m.index + m[0].length - 1
    const close = matching(text, open)
    if (close < 0) continue
    const args = text.slice(open + 1, close)
    const sea = method === 'write' || method === 'read' || method === 'nested'
    // `.write(`/`.read(` 只在实参是 async 闭包时算（排除 io::Write、RwLock::read 等）。
    // 这也意味着 `db.write(op)` 这种具名闭包看不见——见脚本头注释的盲区清单。
    if (sea && !/^\s*async\s*(move\s*)?\|/.test(args)) continue
    // Diesel 的事务方法总要一个闭包；空实参是别的同名方法。实参不是闭包字面量
    // （`let op = |c| …; conn.transaction(op)`、传函数项）时跟不进去，标成 opaque，
    // 由 R0 拒绝，而不是当它不存在。
    if (!sea && !args.trim()) continue
    const opaque = !sea && !/^\s*(?:move\s+)?\|/.test(args)
    const closure = /^\s*(?:async\s+)?(?:move\s+)?\|([^|]*)\|/.exec(args)
    roots.push({
      kind: sea ? `sea-${method}` : method === 'immediate_transaction' ? 'diesel-immediate' : 'diesel-deferred',
      receiver: normalizeReceiver(receiverBefore(text, m.index)),
      params: closure
        ? closure[1].split(',').map((p) =>
            p
              .split(':')[0]
              .trim()
              .replace(/^mut\s+/, ''),
          )
        : [],
      at: m.index + m[0].indexOf(method),
      opaque,
      region: [open + 1, close],
      body: [open + 1 + (closure ? closure.index + closure[0].length : 0), close],
    })
  }
  return roots
}

/** `.method(` 前面的整个接收者表达式：标识符、`.`/`::` 路径、成对括号、前缀 `&`。 */
export function receiverBefore(text, dot) {
  let k = dot - 1
  while (k >= 0 && /\s/.test(text[k])) k--
  const end = k + 1
  for (;;) {
    if (text[k] === ')') {
      let depth = 0
      for (; k >= 0; k--) {
        if (text[k] === ')') depth++
        else if (text[k] === '(' && --depth === 0) break
      }
      k--
    }
    while (k >= 0 && /\w/.test(text[k])) k--
    if (text[k] === '.') k--
    else if (text[k] === ':' && text[k - 1] === ':') k -= 2
    else break
    // rustfmt breaks a long chain before each `.`: `services\n    .sea\n    .write(`.
    while (k >= 0 && /\s/.test(text[k])) k--
  }
  while (k >= 0 && text[k] === '&') k--
  return text.slice(k + 1, end).trim()
}

/**
 * 同一个句柄的不同写法归一：`(&db)`、`&db`、`db.clone()` 都是 `db`。
 * 以调用结尾（`get_db()`、`self.db()`）的接收者每次求值可能是另一个值，静态上
 * 认不出是哪个池，返回 null，由调用方报"R2 无法检查"。
 */
export function normalizeReceiver(expr) {
  let e = expr
  for (let changed = true; changed;) {
    const before = e
    e = e.replace(/^&\s*(?:mut\s+)?/, '').trim()
    if (e.startsWith('(') && matchingParen(e) === e.length - 1) e = e.slice(1, -1).trim()
    e = e.replace(/\.\s*clone\s*\(\s*\)$/, '').trim()
    e = e.replace(/\s*(\.|::)\s*/g, '$1')
    changed = e !== before
  }
  if (!e || e.endsWith(')')) return null
  return e
}

function matchingParen(e) {
  let depth = 0
  for (let k = 0; k < e.length; k++) {
    if (e[k] === '(') depth++
    else if (e[k] === ')' && --depth === 0) return k
  }
  return -1
}

/**
 * 区间里的自由函数调用：`a::b::f(` 与 `f(`。跳过方法调用、宏（`f!(`）、
 * 定义（`fn f(`）、元组结构体/枚举构造（首字母大写）和关键字。
 */
export function callsIn(text, [from, to]) {
  const region = text.slice(from, to)
  const calls = []
  const re = /(?<![.\w:])((?:[A-Za-z_]\w*::)*)([a-z_]\w*)\s*(?:::<[^>]*>)?\s*\(/g
  const keywords = new Set(['if', 'while', 'for', 'match', 'loop', 'return', 'fn', 'move', 'in', 'as', 'let', 'mut'])
  let m
  while ((m = re.exec(region))) {
    const name = m[2]
    if (keywords.has(name)) continue
    const before = region.slice(Math.max(0, m.index - 3), m.index)
    if (/fn\s*$/.test(before)) continue
    calls.push({ path: m[1].replace(/::$/, ''), name, at: from + m.index })
  }
  return calls
}
