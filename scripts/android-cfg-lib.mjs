/**
 * 壳层引用了 Android 上不存在的 core 条目，却没有相应的 cfg ——
 * 桌面编译永远编不到那几行，所以本地全绿，只有 CI 的 Check (android-aarch64) 会红。
 * 同一类事故出过三次：`meridian_core::sandbox`（068a93a）、`meridian_core::onebot`
 * （6707c62）、`services.acp`（cbc60c2）。这里把它前移成一个只读文本的检查。
 *
 * 两侧都从源码推导，不维护名单：
 * - core 侧：带「在 Android 上为假」的 cfg 的 `pub mod` / 模块级 `pub fn`，以及
 *   struct 的 `pub` 字段（`Services` 的按 `services.x` 认，其余只认带下划线的名字）。
 * - 壳层侧：每处引用必须落在某个 cfg 为假的作用域里——属性所修饰的条目或语句、
 *   `#![cfg]` 的整个文件、或被 cfg 掉的 `mod` 声明所引入的文件。
 *
 * 「在 Android 上为假」由一个小求值器算：`not(target_os = "android")`、`desktop`、
 * `windows`、`test` 都为假；`unix` 在 Android 上为真，不算拦住；`feature = …` 之类
 * 不知道的值是「未知」，也不算拦住。
 *
 * 这是文本层面的近似，不是编译器：宏里拼出来的路径、`pub use` 再导出、经别名导入
 * 的引用都看不到。漏报交给 CI 的 Android 编译兜底；这里要做到的是不误报、并且
 * 拦住出过的那三种写法。
 */

/** 把注释、字符串和字符字面量换成等长空白，偏移与换行保持不变。 */
export function stripRust(src) {
  let out = ''
  let i = 0
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  while (i < src.length) {
    const rest = src.slice(i)
    let m
    if (rest.startsWith('//')) {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      out += blank(src.slice(i, stop))
      i = stop
    } else if (rest.startsWith('/*')) {
      let depth = 0
      let j = i
      while (j < src.length) {
        if (src.startsWith('/*', j)) {
          depth++
          j += 2
        } else if (src.startsWith('*/', j)) {
          depth--
          j += 2
          if (depth === 0) break
        } else j++
      }
      out += blank(src.slice(i, j))
      i = j
    } else if ((m = /^b?r(#*)"/.exec(rest))) {
      const close = '"' + m[1]
      const end = src.indexOf(close, i + m[0].length)
      const stop = end === -1 ? src.length : end + close.length
      out += blank(src.slice(i, stop))
      i = stop
    } else if ((m = /^b?"(?:\\[\s\S]|[^\\"])*"/.exec(rest))) {
      out += blank(m[0])
      i += m[0].length
    } else if ((m = /^b?'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'\n])'/.exec(rest))) {
      out += blank(m[0])
      i += m[0].length
    } else {
      out += src[i]
      i++
    }
  }
  return out
}

/** cfg 谓词 → 语法树。 */
export function parseCfg(text) {
  const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]*|"[^"]*"|[(),=]/g) ?? []
  let p = 0
  const expr = () => {
    const name = tokens[p++]
    if (tokens[p] === '(') {
      p++
      const args = []
      while (tokens[p] !== ')') {
        args.push(expr())
        if (tokens[p] === ',') p++
      }
      p++
      return { op: name, args }
    }
    if (tokens[p] === '=') {
      p++
      return { key: name, value: tokens[p++].slice(1, -1) }
    }
    return { flag: name }
  }
  return expr()
}

const ANDROID_KEYS = { target_os: 'android', target_family: 'unix' }
const ANDROID_FLAGS = { unix: true, windows: false, desktop: false, mobile: true, test: false }

/** 这个谓词在 Android 构建里取什么值：true / false / null（不知道）。 */
export function evalOnAndroid(node) {
  if (node.op === 'all' || node.op === 'any') {
    const values = node.args.map(evalOnAndroid)
    const decisive = node.op === 'all' ? false : true
    if (values.includes(decisive)) return decisive
    return values.every((v) => v === !decisive) ? !decisive : null
  }
  if (node.op === 'not') {
    const v = evalOnAndroid(node.args[0])
    return v === null ? null : !v
  }
  if (node.key) return node.key in ANDROID_KEYS ? ANDROID_KEYS[node.key] === node.value : null
  return node.flag in ANDROID_FLAGS ? ANDROID_FLAGS[node.flag] : null
}

const OPEN = { '(': ')', '[': ']', '{': '}' }
const CLOSE = new Set([')', ']', '}'])

/** 从 `start` 起跳过一个平衡的 `#[...]`，返回其后位置；不是属性则原样返回。 */
function skipAttribute(s, start) {
  if (!s.startsWith('#[', start)) return start
  let depth = 0
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '[') depth++
    else if (s[i] === ']' && --depth === 0) return i + 1
  }
  return s.length
}

/**
 * 属性所修饰的那个条目或语句的范围：到深度 0 的 `;` / `,` 为止，或到第一个
 * 深度 0 的块闭合为止（后面紧跟 `else` 则继续，跟着 `;` / `,` 则一并包含），
 * 或到一个让深度变负的闭括号之前（结构体字面量的最后一个字段）。
 */
export function scopeAfter(s, attrEnd) {
  let i = attrEnd
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++
    const next = skipAttribute(s, i)
    if (next === i) break
    i = next
  }
  // A comma ends a field or an argument, never an item or a statement — and
  // inside those it is mostly a generic's (`Result<T, E>`), which this scan
  // cannot tell from a comparison, so it is not counted as a bracket.
  const commaEnds = !STATEMENT_START.test(s.slice(i, i + 40))
  let depth = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (OPEN[c]) depth++
    else if (CLOSE.has(c)) {
      if (depth === 0) return i
      depth--
      if (depth === 0 && c === '}') {
        let j = i + 1
        while (j < s.length && /\s/.test(s[j])) j++
        if (s.startsWith('else', j) && !/\w/.test(s[j + 4] ?? '')) {
          i = j + 3
          continue
        }
        if (s[j] === ';' || s[j] === ',') return j + 1
        if (s[j] === '.' || s[j] === '?') continue
        return i + 1
      }
    } else if (depth === 0 && (c === ';' || (c === ',' && commaEnds))) return i + 1
  }
  return s.length
}

const STATEMENT_START =
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async|unsafe|const|static|extern|fn|impl|struct|enum|union|trait|type|mod|use|let|if|match|for|while|loop|macro_rules)\b/

/** cfg 的谓词，读原文——剥离会把 `"android"` 这种字符串值也抹掉。 */
function predicateAt(src, from, to) {
  const ast = parseCfg(src.slice(from, to))
  return ast.op === 'cfg' && ast.args.length === 1 ? evalOnAndroid(ast.args[0]) : null
}

/**
 * 所有「在 Android 上为假」的外层 cfg 及其作用域。位置在剥离后的文本里找（注释
 * 里的 `#[cfg]` 不算），谓词按同一偏移从原文读。
 */
export function gatedScopes(stripped, src) {
  const scopes = []
  const re = /#\[\s*cfg\s*\(/g
  let m
  while ((m = re.exec(stripped))) {
    const end = skipAttribute(stripped, m.index)
    if (predicateAt(src, m.index + 2, end - 1) !== false) continue
    scopes.push({ attr: m.index, start: end, end: scopeAfter(stripped, end) })
  }
  return scopes
}

/** 整个文件被 `#![cfg(...)]` 拿掉了吗。 */
export function fileGatedOnAndroid(stripped, src) {
  const re = /#!\[\s*cfg\s*\(/g
  let m
  while ((m = re.exec(stripped))) {
    let depth = 0
    let i = m.index + 2
    for (; i < stripped.length; i++) {
      if (stripped[i] === '[') depth++
      else if (stripped[i] === ']' && --depth === 0) break
    }
    if (predicateAt(src, m.index + 3, i) === false) return true
  }
  return false
}

/** 偏移处的花括号深度。 */
export function braceDepthAt(stripped, offset) {
  let depth = 0
  for (let i = 0; i < offset; i++) {
    if (stripped[i] === '{') depth++
    else if (stripped[i] === '}') depth--
  }
  return depth
}

export function lineOf(text, offset) {
  let line = 1
  for (let i = 0; i < offset; i++) if (text[i] === '\n') line++
  return line
}

/** `agent/mod.rs` → ['agent']，`agent/turn.rs` → ['agent', 'turn']，`lib.rs` → []。 */
export function modulePath(relPath) {
  const parts = relPath.replace(/\\/g, '/').replace(/\.rs$/, '').split('/')
  const last = parts.at(-1)
  if (last === 'lib' || last === 'main' || last === 'mod') parts.pop()
  return parts
}

/**
 * core 里在 Android 上不存在的东西。`files` 是相对 `core/src` 的路径 → 源码。
 * 返回 `{ paths: string[][], servicesFields: string[], fields: string[], unchecked: string[] }`。
 */
export function collectAndroidAbsent(files) {
  const paths = []
  const servicesFields = []
  const fields = []
  const unchecked = []
  for (const [rel, src] of Object.entries(files)) {
    const stripped = stripRust(src)
    const mod = modulePath(rel)
    if (fileGatedOnAndroid(stripped, src)) {
      paths.push(mod)
      continue
    }
    const scopes = gatedScopes(stripped, src)
    // A name is absent only if *every* module-level definition of it is gated
    // off: an Android twin under its own cfg means the path still resolves.
    const definitions = new Map()
    const defRe = /\bpub(?:\([^)]*\))?\s+(?:mod|(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn)\s+(\w+)/g
    let d
    while ((d = defRe.exec(stripped))) {
      if (braceDepthAt(stripped, d.index) !== 0) continue
      const gated = scopes.some((s) => d.index >= s.start && d.index < s.end)
      const prev = definitions.get(d[1])
      definitions.set(d[1], (prev ?? true) && gated)
    }
    for (const [name, allGated] of definitions) if (allGated) paths.push([...mod, name])
    for (const scope of scopes) {
      const item = stripped.slice(scope.start, scope.end)
      const depth = braceDepthAt(stripped, scope.attr)
      let m
      if (depth === 1 && (m = /^\s*pub\s+(\w+)\s*:/.exec(item))) {
        const owner = /pub\s+struct\s+(\w+)\s*(?:<[^{]*>)?\s*\{[^{}]*$/.exec(stripped.slice(0, scope.attr))
        // `Services` derefs to `ServicesInner`, where the fields are declared.
        if (/^Services(Inner)?$/.test(owner?.[1] ?? '')) servicesFields.push(m[1])
        else if (m[1].includes('_')) fields.push(m[1])
        else unchecked.push(`${owner?.[1] ?? '?'}.${m[1]}`)
      }
    }
  }
  return { paths, servicesFields, fields, unchecked }
}

/** 壳层里被 cfg 掉的 `mod x;` 声明所引入的文件 / 目录前缀（相对 `src`）。 */
export function gatedModulePrefixes(files) {
  const prefixes = []
  for (const [rel, src] of Object.entries(files)) {
    const stripped = stripRust(src)
    const norm = rel.replace(/\\/g, '/')
    const base = norm.replace(/[^/]+$/, '')
    const stem = norm.replace(/\.rs$/, '')
    const owner = /(^|\/)(lib|main|mod)\.rs$/.test(norm) ? base : `${stem}/`
    for (const scope of gatedScopes(stripped, src)) {
      const m = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/.exec(stripped.slice(scope.start, scope.end))
      if (m) prefixes.push(`${owner}${m[1]}.rs`, `${owner}${m[1]}/`)
    }
  }
  return prefixes
}

/** 展开一条 `use` 的路径树：`a::{b, c::{d, e}}` → [[a,b],[a,c,d],[a,c,e]]。 */
export function expandUse(tree) {
  const text = tree.replace(/\s+/g, '')
  const parse = (s, prefix) => {
    const brace = s.indexOf('{')
    if (brace === -1) return [[...prefix, ...s.split('::').filter(Boolean)].map((x) => x.replace(/as\w+$/, ''))]
    const head = s.slice(0, brace).split('::').filter(Boolean)
    const body = s.slice(brace + 1, s.lastIndexOf('}'))
    const items = []
    let depth = 0
    let from = 0
    for (let i = 0; i <= body.length; i++) {
      if (body[i] === '{') depth++
      else if (body[i] === '}') depth--
      else if ((body[i] === ',' || i === body.length) && depth === 0) {
        if (i > from) items.push(body.slice(from, i))
        from = i + 1
      }
    }
    return items.flatMap((item) => parse(item, [...prefix, ...head]))
  }
  return parse(text, [])
}

const startsWith = (path, prefix) => prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg)

/**
 * 壳层里没有 cfg 拦着的引用。`files` 是相对 `src-tauri/src` 的路径 → 源码。
 * 返回 `{ file, line, what }` 的列表。
 */
export function findViolations(files, absent) {
  const prefixes = gatedModulePrefixes(files)
  const out = []
  for (const [rel, src] of Object.entries(files)) {
    const norm = rel.replace(/\\/g, '/')
    if (prefixes.some((p) => (p.endsWith('/') ? norm.startsWith(p) : norm === p))) continue
    const stripped = stripRust(src)
    if (fileGatedOnAndroid(stripped, src)) continue
    const scopes = gatedScopes(stripped, src)
    const covered = (at) => scopes.some((s) => at >= s.attr && at < s.end)
    const report = (at, what) => {
      if (!covered(at)) out.push({ file: norm, line: lineOf(stripped, at), what })
    }
    const seen = new Set()
    const usesRe = /\buse\s+(meridian_core\s*::[^;]*);/g
    let m
    while ((m = usesRe.exec(stripped))) {
      for (const path of expandUse(m[1])) {
        const hit = absent.paths.find((p) => startsWith(path.slice(1), p))
        if (hit) {
          seen.add(m.index)
          report(m.index, `meridian_core::${hit.join('::')}`)
        }
      }
    }
    const pathRe = /\bmeridian_core((?:\s*::\s*\w+)+)/g
    while ((m = pathRe.exec(stripped))) {
      if ([...seen].some((u) => m.index > u && m.index < stripped.indexOf(';', u))) continue
      const path = m[1]
        .split('::')
        .map((s) => s.trim())
        .filter(Boolean)
      const hit = absent.paths.find((p) => startsWith(path, p))
      if (hit) report(m.index, `meridian_core::${hit.join('::')}`)
    }
    for (const field of absent.servicesFields) {
      const re = new RegExp(`\\bservices\\s*(?:\\(\\s*\\))?\\s*\\.\\s*${field}\\b`, 'g')
      while ((m = re.exec(stripped))) report(m.index, `services.${field}`)
    }
    for (const field of absent.fields) {
      const re = new RegExp(`(?<![:\\w])${field}\\b`, 'g')
      while ((m = re.exec(stripped))) report(m.index, field)
    }
  }
  return out
}
