/**
 * Exhaustive Rust <-> TypeScript IPC wire-contract parity checker.
 *
 * Walks every command in `src/api.ts` against `src-tauri/src/command_table.rs`,
 * then recursively verifies every reachable Request/Response struct and enum
 * (unit enums, internally-tagged enums, inline object types, flattened structs,
 * `RequiredNullable<T>`, `Option<T>`, `OverrideField<T>`) against `src/types.ts`.
 *
 * Designed to prevent regressions like `ServiceKey` (`'FISH_AUDIO'` in TS vs
 * `#[serde(rename_all = "snake_case")]` `'fish_audio'` in Rust) from ever
 * reaching production again.
 */

const RUST_PRIMITIVES = new Set([
  '()',
  'String',
  'str',
  'bool',
  'u8',
  'u16',
  'u32',
  'u64',
  'u128',
  'usize',
  'i8',
  'i16',
  'i32',
  'i64',
  'i128',
  'isize',
  'f32',
  'f64',
  'Value',
  'Decimal',
])

// Backend-only preference keys that Rust accepts/persists internally without
// exposing a UI control in `src/types.ts` yet. Every key TS *does* declare must
// exist in Rust.
const BACKEND_ONLY_PREFERENCE_KEYS = new Set(['google.compat_thinking_mode', 'google.include_thoughts_when_off'])

function toCase(name, mode) {
  if (!mode) return name
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .split('_')
  if (mode === 'snake_case') return words.map((w) => w.toLowerCase()).join('_')
  if (mode === 'SCREAMING_SNAKE_CASE') return words.map((w) => w.toUpperCase()).join('_')
  if (mode === 'kebab-case') return words.map((w) => w.toLowerCase()).join('-')
  if (mode === 'lowercase') return name.toLowerCase()
  if (mode === 'camelCase') return name[0].toLowerCase() + name.slice(1)
  return name
}

function stripComments(src) {
  let out = ''
  let i = 0
  let inStr = null
  while (i < src.length) {
    if (!inStr && src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (!inStr && src[i] === '/' && src[i + 1] === '*') {
      let depth = 1
      i += 2
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') {
          depth++
          i += 2
        } else if (src[i] === '*' && src[i + 1] === '/') {
          depth--
          i += 2
        } else {
          i++
        }
      }
      continue
    }
    if (!inStr && (src[i] === '"' || src[i] === "'")) {
      inStr = src[i]
      out += src[i++]
      continue
    }
    if (inStr) {
      if (src[i] === '\\') {
        out += src[i++]
        if (i < src.length) out += src[i++]
        continue
      }
      if (src[i] === inStr) inStr = null
      out += src[i++]
      continue
    }
    out += src[i++]
  }
  return out
}

function stripRustComments(src) {
  let out = ''
  let i = 0
  let inStr = false
  while (i < src.length) {
    if (!inStr && src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (!inStr && src[i] === '/' && src[i + 1] === '*') {
      let depth = 1
      i += 2
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') {
          depth++
          i += 2
        } else if (src[i] === '*' && src[i + 1] === '/') {
          depth--
          i += 2
        } else {
          i++
        }
      }
      continue
    }
    if (!inStr && src[i] === '"') {
      inStr = true
      out += src[i++]
      continue
    }
    if (inStr) {
      if (src[i] === '\\') {
        out += src[i++]
        if (i < src.length) out += src[i++]
        continue
      }
      if (src[i] === '"') inStr = false
      out += src[i++]
      continue
    }
    out += src[i++]
  }
  return out
}

function extractMatching(src, openIdx, openCh, closeCh, { rustLifetimes = false } = {}) {
  let depth = 0
  let inStr = null
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'") {
      if (rustLifetimes && ch === "'" && /[a-zA-Z_]/.test(src[i + 1] ?? '') && src[i + 2] !== "'") {
        continue
      }
      inStr = ch
      continue
    }
    if (ch === openCh) depth++
    else if (ch === closeCh) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function splitTopLevel(body, sep, { rustLifetimes = false } = {}) {
  const parts = []
  let cur = ''
  let depth = 0
  let inStr = null
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inStr) {
      cur += ch
      if (ch === '\\' && i + 1 < body.length) cur += body[++i]
      else if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'") {
      if (!(rustLifetimes && ch === "'" && /[a-zA-Z_]/.test(body[i + 1] ?? '') && body[i + 2] !== "'")) {
        inStr = ch
      }
      cur += ch
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth++
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') depth--
    if (ch === sep && depth === 0) {
      if (cur.trim()) parts.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

function parseTsObjectFields(body) {
  const fields = new Map()
  let depth = 0
  let cur = ''
  const entries = []
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth++
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') depth--
    if ((ch === '\n' || ch === ';') && depth === 0) {
      if (cur.trim()) entries.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) entries.push(cur.trim())
  for (const entry of entries) {
    const fm = entry.match(/^(?:readonly\s+)?(?:'([^']+)'|"([^"]+)"|(\w+))(\?)?\s*:\s*([\s\S]+?);?$/)
    if (fm) {
      const key = fm[1] ?? fm[2] ?? fm[3]
      const rawType = fm[5].trim()
      // Keep newlines inside inline object types so nested parseTsObjectFields can split fields
      const type = rawType.includes('{') ? rawType : rawType.replace(/\s+/g, ' ').trim()
      fields.set(key, { optional: fm[4] === '?', type })
    }
  }
  return fields
}

function parseRustSources(rustEntries) {
  const rustStructs = new Map()
  const rustEnums = new Map()
  const rustAliases = new Map()
  const rustCmdReturns = new Map()

  for (const { file, source } of rustEntries) {
    if (source == null) continue
    const prod = source.split(/#\[cfg\(test\)\]/)[0]
    const src = stripRustComments(prod)
    const isShell = file.startsWith('src-tauri/src/')

    for (const m of src.matchAll(/\bpub\s+type\s+(\w+)\s*=\s*([^;]+);/g)) {
      if (!rustAliases.has(m[1]) || isShell) {
        rustAliases.set(m[1], m[2].trim())
      }
    }

    if (isShell) {
      for (const m of src.matchAll(
        /#\[tauri::command[^\]]*\][^;{}]{0,800}?\bpub\s+(?:async\s+)?fn\s+(\w+)\s*\([^)]*\)\s*->\s*Result<([\s\S]*?),\s*String>\s*\{/g,
      )) {
        rustCmdReturns.set(m[1], m[2].replace(/\s+/g, ' ').trim())
      }
    }

    const declRe = /((?:#\[(?:[^[\]]|\[[^\]]*\])*\]\s*)*)\bpub\s+(struct|enum)\s+(\w+)(?:<[^>]*>)?\s*\{/g
    for (const m of src.matchAll(declRe)) {
      const attrs = m[1]
      const kind = m[2]
      const name = m[3]
      const openIdx = m.index + m[0].length - 1
      const closeIdx = extractMatching(src, openIdx, '{', '}', { rustLifetimes: true })
      if (closeIdx < 0) continue
      const body = src.slice(openIdx + 1, closeIdx)

      if (kind === 'struct') {
        const renameAll = attrs.match(/rename_all\s*=\s*"([^"]+)"/)?.[1] ?? null
        const fields = new Map()
        for (const item of splitTopLevel(body, ',', { rustLifetimes: true })) {
          const fm = item.match(/^((?:#\[(?:[^[\]]|\[[^\]]*\])*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?(\w+)\s*:\s*([\s\S]+)$/)
          if (!fm) continue
          const [, fAttrs, rustName, fTypeRaw] = fm
          const fType = fTypeRaw.replace(/\s+/g, ' ').trim()
          if (/#\[serde\([^\]]*\bskip\b/.test(fAttrs)) continue
          const flatten = /#\[serde\([^\]]*\bflatten\b/.test(fAttrs)
          const rename = fAttrs.match(/#\[serde\([^\]]*\brename\s*=\s*"([^"]+)"/)?.[1] ?? null
          const hasDefault = /#\[serde\([^\]]*\bdefault\b/.test(fAttrs)
          const hasReqNull = /deserialize_required_nullable/.test(fAttrs) || /^RequiredNullable</.test(fType)
          const isOverride = /^OverrideField</.test(fType)
          const isOptOpt = /^Option<\s*Option</.test(fType) || /^OverrideField<\s*Option</.test(fType)
          const isOpt = /^Option</.test(fType) || isOverride
          const wireKey = rename ?? toCase(rustName, renameAll)
          const optionalInRequest = !hasReqNull && (isOpt || hasDefault)
          const nullable = hasReqNull || isOptOpt || isOpt
          fields.set(wireKey, {
            rustName,
            type: fType,
            optionalInRequest,
            nullable,
            flatten,
            hasReqNull,
            isOptOpt,
            isOverride,
          })
        }
        if (!rustStructs.has(name) || isShell) {
          rustStructs.set(name, { file, attrs, fields })
        }
      } else {
        const renameAll = attrs.match(/rename_all\s*=\s*"([^"]+)"/)?.[1] ?? null
        const tag = attrs.match(/#\[serde\([^\]]*\btag\s*=\s*"([^"]+)"/)?.[1] ?? null
        const content = attrs.match(/#\[serde\([^\]]*\bcontent\s*=\s*"([^"]+)"/)?.[1] ?? null
        const untagged = /#\[serde\([^\]]*\buntagged\b/.test(attrs)
        const variants = []
        for (const item of splitTopLevel(body, ',', { rustLifetimes: true })) {
          const vm = item.match(/^((?:#\[(?:[^[\]]|\[[^\]]*\])*\]\s*)*)([A-Z]\w*)\s*([\s\S]*)$/)
          if (!vm) continue
          const [, vAttrs, vName, rest] = vm
          const rename = vAttrs.match(/#\[serde\([^\]]*\brename\s*=\s*"([^"]+)"/)?.[1] ?? null
          const wireName = rename ?? toCase(vName, renameAll)
          let shape = 'unit'
          let vFields = null
          if (rest.startsWith('{')) {
            shape = 'struct'
            vFields = new Map()
            const inner = rest.slice(1, rest.lastIndexOf('}'))
            for (const fi of splitTopLevel(inner, ',', { rustLifetimes: true })) {
              const fm = fi.match(/^((?:#\[(?:[^[\]]|\[[^\]]*\])*\]\s*)*)(\w+)\s*:\s*([\s\S]+)$/)
              if (!fm) continue
              const [, fAttrs, rustName, fTypeRaw] = fm
              const fType = fTypeRaw.replace(/\s+/g, ' ').trim()
              const fRename = fAttrs.match(/#\[serde\([^\]]*\brename\s*=\s*"([^"]+)"/)?.[1] ?? null
              const hasReqNull = /deserialize_required_nullable/.test(fAttrs) || /^RequiredNullable</.test(fType)
              const hasDefault = /#\[serde\([^\]]*\bdefault\b/.test(fAttrs)
              const isOpt = /^Option</.test(fType)
              vFields.set(fRename ?? rustName, {
                rustName,
                type: fType,
                optionalInRequest: !hasReqNull && (isOpt || hasDefault),
                nullable: hasReqNull || isOpt,
              })
            }
          } else if (rest.startsWith('(')) {
            shape = 'tuple'
          }
          variants.push({ vName, wireName, shape, vFields })
        }
        if (!rustEnums.has(name) || isShell) {
          rustEnums.set(name, { file, attrs, tag, content, untagged, renameAll, variants })
        }
      }
    }
  }

  return { rustStructs, rustEnums, rustAliases, rustCmdReturns }
}

function parseTsContracts(tsSource) {
  const tsClean = stripComments(tsSource.replace(/\r\n/g, '\n'))
  const tsInterfaces = new Map()

  for (const m of tsClean.matchAll(/export\s+interface\s+(\w+)(<[^>]*>)?(?:\s+extends\s+(\w+))?\s*\{/g)) {
    const name = m[1]
    const generics = m[2] ?? ''
    const ext = m[3] ?? null
    const openIdx = m.index + m[0].length - 1
    const closeIdx = extractMatching(tsClean, openIdx, '{', '}')
    if (closeIdx < 0) continue
    const typeParams = new Map()
    for (const gm of generics.matchAll(/(\w+)\s+extends\s+([\w|'\s]+)/g)) {
      typeParams.set(gm[1], gm[2].replace(/\s*=.*$/, '').trim())
    }
    const fields = parseTsObjectFields(tsClean.slice(openIdx + 1, closeIdx))
    for (const [k, f] of fields) {
      if (typeParams.has(f.type)) {
        fields.set(k, { ...f, type: typeParams.get(f.type) })
      }
    }
    tsInterfaces.set(name, { extends: ext, fields })
  }

  const tsTypes = new Map()
  const typeRe = /export\s+type\s+(\w+)(?:<[^>]*>)?\s*=\s*/g
  for (const m of tsClean.matchAll(typeRe)) {
    const name = m[1]
    const start = m.index + m[0].length
    let depth = 0
    let end = tsClean.length
    for (let j = start; j < tsClean.length; j++) {
      const ch = tsClean[j]
      if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth++
      else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') depth--
      if (depth === 0 && tsClean[j] === '\n' && /^[ \t]*export\s/.test(tsClean.slice(j + 1, j + 40))) {
        end = j
        break
      }
    }
    tsTypes.set(name, tsClean.slice(start, end).trim())
  }

  return { tsInterfaces, tsTypes }
}

function parseApiCommands(apiSource) {
  const src = stripComments(apiSource)
  const cmds = new Map()
  let idx = 0
  while (true) {
    const hit = src.indexOf('invoke<', idx)
    if (hit < 0) break
    const openAngle = hit + 'invoke'.length
    const closeAngle = extractMatching(src, openAngle, '<', '>')
    if (closeAngle < 0) {
      idx = hit + 7
      continue
    }
    const resTsType = src.slice(openAngle + 1, closeAngle).trim()
    const after = src.slice(closeAngle + 1)
    const callM = after.match(/^\(\s*'([a-z0-9_]+)'\s*(?:,\s*\{\s*request\s*\})?\s*\)/)
    if (!callM) {
      idx = closeAngle + 1
      continue
    }
    const cmd = callM[1]
    const hasRequestArg = /\{\s*request\s*\}/.test(callM[0])
    // Walk backward on the current method declaration to read `(request: FooRequest)`
    const prefix = src.slice(Math.max(0, hit - 240), hit)
    const methodMatches = [...prefix.matchAll(/(\w+)\s*:\s*(?:<[^>]+>)?\(([^)]*)\)\s*=>/g)]
    const methodM = methodMatches.at(-1)
    const reqTsType = methodM?.[2]?.match(/request\s*:\s*(\w+)/)?.[1] ?? null
    cmds.set(cmd, { method: methodM?.[1] ?? cmd, reqTsType, hasRequestArg, resTsType })
    idx = closeAngle + 1 + callM[0].length
  }
  return cmds
}

function resolveTsStringUnion(expr, tsTypes, tsInterfaces, seen = new Set()) {
  const s = expr.trim()
  if (seen.has(s)) return null
  seen.add(s)

  // `keyof SomeInterface`
  const keyofM = s.match(/^keyof\s+(\w+)$/)
  if (keyofM && tsInterfaces.has(keyofM[1])) {
    return [...tsInterfaces.get(keyofM[1]).fields.keys()]
  }

  // `Exclude<Base, Excluded>`
  const exclM = s.match(/^Exclude<([\s\S]+),\s*([\s\S]+)>$/)
  if (exclM) {
    const base = resolveTsStringUnion(exclM[1], tsTypes, tsInterfaces, new Set(seen))
    const drop = resolveTsStringUnion(exclM[2], tsTypes, tsInterfaces, new Set(seen))
    if (base && drop) return base.filter((v) => !drop.includes(v))
    return null
  }

  // Top-level union `A | B | 'lit'`
  const parts = splitTopLevel(s, '|')
  if (parts.length > 1) {
    const all = []
    for (const p of parts) {
      const resolved = resolveTsStringUnion(p, tsTypes, tsInterfaces, new Set(seen))
      if (!resolved) return null
      all.push(...resolved)
    }
    return all
  }

  // Single string literal `'foo'` or `"foo"`
  const litM = s.match(/^['"]([^'"]+)['"]$/)
  if (litM) return [litM[1]]

  // Named alias in tsTypes
  if (tsTypes.has(s)) {
    return resolveTsStringUnion(tsTypes.get(s), tsTypes, tsInterfaces, new Set(seen))
  }

  return null
}

function resolveTsTaggedVariants(expr, tagKey, tsTypes, tsInterfaces) {
  const s = expr.trim()

  // Mapped union `{ [K in PreferenceKey]: { key: K; value: PreferenceUpdateValueByKey[K] } }[PreferenceKey]`
  const mappedM = s.match(/\{\s*\[K\s+in\s+(\w+)\]\s*:\s*\{([^}]+)\}\s*\}\[\1\]/)
  if (mappedM) {
    const keys = resolveTsStringUnion(mappedM[1], tsTypes, tsInterfaces)
    const objFields = parseTsObjectFields(mappedM[2])
    if (keys) {
      const variants = new Map()
      for (const k of keys) {
        const f = new Map(objFields)
        f.delete(tagKey)
        variants.set(k, f)
      }
      return variants
    }
  }

  const parts = splitTopLevel(s, '|')
  const variants = new Map()
  for (const part of parts) {
    const trimmed = part.trim()
    let fields = null
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      fields = parseTsObjectFields(trimmed.slice(1, -1))
    } else if (tsInterfaces.has(trimmed)) {
      fields = new Map(tsInterfaces.get(trimmed).fields)
    } else if (tsTypes.has(trimmed)) {
      const sub = resolveTsTaggedVariants(tsTypes.get(trimmed), tagKey, tsTypes, tsInterfaces)
      if (sub) {
        for (const [k, v] of sub) variants.set(k, v)
        continue
      }
    }
    if (!fields) return null
    const tagField = fields.get(tagKey)
    const tagLit = tagField?.type.match(/^['"]([^'"]+)['"]$/)?.[1]
    if (!tagLit) return null
    fields.delete(tagKey)
    variants.set(tagLit, fields)
  }
  return variants.size > 0 ? variants : null
}

export function checkIpcWireParity({ readAt, filesUnder }) {
  const problems = []
  const add = (file, message) => problems.push(`${file}: ${message}`)

  const commandTableSource = readAt('src-tauri/src/command_table.rs')
  const apiSource = readAt('src/api.ts')
  const typesSource = readAt('src/types.ts')
  if (commandTableSource == null || apiSource == null || typesSource == null) {
    return { problems, stats: { commands: 0, structs: 0, enums: 0 } }
  }

  const rustFiles = [
    ...filesUnder('src-tauri/src', ['.rs']),
    ...filesUnder('src-tauri/crates/core/src', ['.rs']),
    ...filesUnder('src-tauri/crates/provider-sdk/src', ['.rs']),
    ...filesUnder('src-tauri/crates/providers/src', ['.rs']),
  ]
  const rustEntries = rustFiles.map((file) => ({ file, source: readAt(file) }))
  const { rustStructs, rustEnums, rustAliases, rustCmdReturns } = parseRustSources(rustEntries)
  const { tsInterfaces, tsTypes } = parseTsContracts(typesSource)

  // Parse command_table.rs
  const tableBody = commandTableSource.split('macro_rules! with_all_commands')[1]?.split('#[cfg(test)]')[0] ?? ''
  const rustCmds = new Map()
  for (const m of tableBody.matchAll(/(?:async|sync|local)\s+([\w:]+)\s*=>\s*([a-z0-9_]+)\s*\(([^)]*)\)/g)) {
    const [, mod, cmd, params] = m
    const reqType = params.trim().match(/::(\w+),?$/)?.[1] ?? null
    rustCmds.set(cmd, { mod, reqType })
  }

  const apiCmds = parseApiCommands(apiSource)

  for (const [cmd, ts] of apiCmds) {
    const r = rustCmds.get(cmd)
    if (!r) {
      add('src/api.ts', `调用的 IPC 命令 '${cmd}' 未注册在 src-tauri/src/command_table.rs`)
      continue
    }
    if (Boolean(r.reqType) !== Boolean(ts.hasRequestArg)) {
      add('src/api.ts', `命令 '${cmd}' 参数个数不一致：Rust ${r.reqType ?? '()'} vs TS ${ts.reqTsType ?? '()'}`)
    }
  }

  function expandRustFields(structName, seen = new Set()) {
    if (seen.has(structName)) return null
    seen.add(structName)
    const st = rustStructs.get(structName)
    if (!st) return null
    const out = new Map()
    for (const [k, info] of st.fields) {
      if (info.flatten) {
        const targetName = info.type.replace(/^[\w:]+::/, '').replace(/<.*>$/, '')
        const sub = expandRustFields(targetName, new Set(seen))
        if (sub) {
          for (const [sk, si] of sub) out.set(sk, si)
        }
      } else {
        out.set(k, info)
      }
    }
    return out
  }

  function resolveTsFields(typeExpr) {
    const trimmed = typeExpr.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return parseTsObjectFields(trimmed.slice(1, -1))
    }
    const iface = tsInterfaces.get(trimmed)
    if (!iface) return null
    const out = new Map()
    if (iface.extends) {
      const parent = resolveTsFields(iface.extends)
      if (parent) for (const [k, v] of parent) out.set(k, v)
    }
    for (const [k, v] of iface.fields) out.set(k, v)
    return out
  }

  function extractRustBaseType(t) {
    if (!t) return null
    let s = t.trim()
    if (rustAliases.has(s)) s = rustAliases.get(s)
    while (true) {
      const om = s.match(/^(?:Option|Vec|RequiredNullable|OverrideField|Box)<\s*([\s\S]+)\s*>$/)
      if (om) {
        s = om[1].trim()
        continue
      }
      const mm = s.match(/^(?:std::collections::)?(?:BTreeMap|HashMap)<\s*String\s*,\s*([\s\S]+)\s*>$/)
      if (mm) {
        s = mm[1].trim()
        continue
      }
      break
    }
    s = s.replace(/^[\w:]+::/, '')
    if (rustAliases.has(s)) return extractRustBaseType(rustAliases.get(s))
    return s
  }

  function extractTsBaseType(t) {
    if (!t) return null
    let s = t.trim()
    // Strip trailing `| null` / leading `null |`
    s = splitTopLevel(s, '|')
      .map((p) => p.trim())
      .filter((p) => p !== 'null' && p !== 'undefined')
      .join(' | ')
    if (s.endsWith('[]')) s = s.slice(0, -2).trim()
    const rm = s.match(/^Record<string,\s*([\s\S]+)>$/)
    if (rm) {
      s = rm[1].trim()
      if (s.endsWith('[]')) s = s.slice(0, -2).trim()
    }
    if (/^\w+<[^>]+>$/.test(s)) s = s.replace(/<.*>$/, '').trim()
    if (tsTypes.has(s)) {
      const body = tsTypes.get(s)
      const arrM = body.match(/^(\w+)\[\]$/)
      if (arrM) return arrM[1]
    }
    return s
  }

  const checkedStructs = new Set()
  const checkedEnums = new Set()
  const queue = []

  for (const [cmd, ts] of apiCmds) {
    const r = rustCmds.get(cmd)
    if (!r) continue
    if (r.reqType && ts.reqTsType) {
      queue.push({ rustName: r.reqType, tsExpr: ts.reqTsType, role: 'req', context: cmd })
    }
    const rRet = rustCmdReturns.get(cmd)
    if (rRet) {
      const rBase = extractRustBaseType(rRet)
      const tsBase = extractTsBaseType(ts.resTsType)
      if (rBase && tsBase && !RUST_PRIMITIVES.has(rBase)) {
        queue.push({ rustName: rBase, tsExpr: tsBase, role: 'res', context: cmd })
      }
    }
  }

  while (queue.length > 0) {
    const { rustName, tsExpr, role, context } = queue.shift()

    if (rustStructs.has(rustName)) {
      const key = `${rustName}:${tsExpr}:${role}`
      if (checkedStructs.has(key)) continue
      checkedStructs.add(key)

      const rFields = expandRustFields(rustName)
      const tFields = resolveTsFields(tsExpr)
      if (!tFields) {
        if (!tsTypes.has(tsExpr)) {
          add('src/types.ts', `缺少与 Rust 结构体 ${rustName} 对应的 TS 定义 ${tsExpr}（经由 ${context}）`)
        }
        continue
      }

      for (const [k, rf] of rFields) {
        if (!tFields.has(k)) {
          add('src/types.ts', `${tsExpr} 缺少 Rust ${rustName} 的 wire 字段 '${k}'（经由 ${context}）`)
          continue
        }
        const tf = tFields.get(k)
        if (role === 'req') {
          if (tf.optional && !rf.optionalInRequest) {
            add('src/types.ts', `${tsExpr}.${k} 在 TS 中是可选字段，但 Rust ${rustName}.${rf.rustName} 为必填`)
          }
          if (rf.hasReqNull && !/\bnull\b/.test(tf.type) && tf.type !== 'unknown') {
            add('src/types.ts', `${tsExpr}.${k} 对应 Rust RequiredNullable，TS 类型必须允许 null`)
          }
          if (!rf.nullable && /\bnull\b/.test(tf.type)) {
            add('src/types.ts', `${tsExpr}.${k} 在 TS 中允许 null，但 Rust ${rustName}.${rf.rustName} 非可空`)
          }
        } else {
          if (tf.optional && !rf.isOverride) {
            add('src/types.ts', `${tsExpr}.${k} 是 wire response 字段，禁止 optional`)
          }
          if (rf.nullable && !rf.isOverride && !/\bnull\b/.test(tf.type) && tf.type !== 'unknown') {
            add('src/types.ts', `${tsExpr}.${k} 对应 Rust Option，TS 类型必须允许 null`)
          }
          if (!rf.nullable && /\bnull\b/.test(tf.type)) {
            add('src/types.ts', `${tsExpr}.${k} 在 TS 中允许 null，但 Rust ${rustName}.${rf.rustName} 非 Option`)
          }
        }

        const nr = extractRustBaseType(rf.type)
        const nt = extractTsBaseType(tf.type)
        if (nr && nt && (rustStructs.has(nr) || rustEnums.has(nr))) {
          queue.push({ rustName: nr, tsExpr: nt, role, context: `${rustName}.${k}` })
        }
      }

      for (const [k] of tFields) {
        if (!rFields.has(k)) {
          add('src/types.ts', `${tsExpr}.${k} 在 Rust ${rustName} 中不存在（经由 ${context}）`)
        }
      }
    } else if (rustEnums.has(rustName)) {
      const key = `${rustName}:${tsExpr}:${role}`
      if (checkedEnums.has(key)) continue
      checkedEnums.add(key)

      const re = rustEnums.get(rustName)
      if (re.untagged) continue

      if (!re.tag && re.variants.every((v) => v.shape === 'unit')) {
        // Skip integer-repr enums (e.g. MessageRating: -1 | 0 | 1)
        const tsRawType = tsTypes.get(tsExpr) ?? tsExpr
        if (/^-?\d+(?:\s*\|\s*-?\d+)+$/.test(tsRawType.trim())) continue
        const rustVals = re.variants.map((v) => v.wireName)
        const tsVals = resolveTsStringUnion(tsExpr, tsTypes, tsInterfaces)
        if (!tsVals) {
          if (tsExpr !== 'string' && tsExpr !== 'unknown') {
            add('src/types.ts', `无法解析与 Rust 枚举 ${rustName} 对应的 TS 联合类型 ${tsExpr}（经由 ${context}）`)
          }
          continue
        }
        const extra = tsVals.filter((v) => !rustVals.includes(v))
        const missing = rustVals.filter(
          (v) => !tsVals.includes(v) && !(rustName === 'PreferenceKey' && BACKEND_ONLY_PREFERENCE_KEYS.has(v)),
        )
        if (extra.length > 0 || missing.length > 0) {
          add(
            'src/types.ts',
            `枚举 ${tsExpr} 与 Rust ${rustName} wire 值不一致：TS 多余 ${JSON.stringify(extra)}，TS 缺失 ${JSON.stringify(missing)}（经由 ${context}）`,
          )
        }
      } else if (re.tag && !re.content) {
        const tsVariants = resolveTsTaggedVariants(tsExpr, re.tag, tsTypes, tsInterfaces)
        if (!tsVariants) continue
        const rustTags = re.variants.map((v) => v.wireName)
        const tsTags = [...tsVariants.keys()]
        const extraTags = tsTags.filter((t) => !rustTags.includes(t))
        const missingTags = rustTags.filter(
          (t) =>
            !tsTags.includes(t) && !(rustName === 'PreferenceUpdateRequest' && BACKEND_ONLY_PREFERENCE_KEYS.has(t)),
        )
        if (extraTags.length > 0 || missingTags.length > 0) {
          add(
            'src/types.ts',
            `Tagged enum ${tsExpr} 与 Rust ${rustName}（tag="${re.tag}"）变体不一致：TS 多余 ${JSON.stringify(extraTags)}，TS 缺失 ${JSON.stringify(missingTags)}（经由 ${context}）`,
          )
        }
        for (const v of re.variants) {
          if (v.shape !== 'struct' || !v.vFields) continue
          const tFields = tsVariants.get(v.wireName)
          if (!tFields) continue
          for (const [fk, rf] of v.vFields) {
            if (!tFields.has(fk)) {
              add(
                'src/types.ts',
                `${tsExpr}[${re.tag}='${v.wireName}'] 缺少字段 '${fk}'（Rust ${rustName}::${v.vName}）`,
              )
              continue
            }
            const tf = tFields.get(fk)
            const nr = extractRustBaseType(rf.type)
            const nt = extractTsBaseType(tf.type)
            if (nr && nt && (rustStructs.has(nr) || rustEnums.has(nr))) {
              queue.push({ rustName: nr, tsExpr: nt, role, context: `${rustName}::${v.vName}.${fk}` })
            }
          }
          for (const [tk] of tFields) {
            if (!v.vFields.has(tk)) {
              add('src/types.ts', `${tsExpr}[${re.tag}='${v.wireName}'].${tk} 在 Rust ${rustName}::${v.vName} 中不存在`)
            }
          }
        }
      }
    }
  }

  return {
    problems,
    stats: {
      commands: apiCmds.size,
      structs: checkedStructs.size,
      enums: checkedEnums.size,
    },
  }
}
