/** Small, dependency-free syntax helpers used by the model contract guard. */

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

export function isMoneyLeafField(name) {
  if (name === 'balance') return false // provider catalog capability, not an amount
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
