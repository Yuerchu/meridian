#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function defaultRoot() {
  if (process.env.MERIDIAN_INVOKE_SCHEMA_ROOT) return resolve(process.env.MERIDIAN_INVOKE_SCHEMA_ROOT)
  if (!import.meta.url.startsWith('file:')) return process.cwd()
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

export function runInvokeResponseSchemaGenerator(options = {}) {
  const ROOT = resolve(options.root ?? defaultRoot())
  const CHECK = options.check ?? false
  const STAGED = options.staged ?? false
  const ts = createRequire(join(ROOT, 'package.json'))('typescript')
  const API_FILE = 'src/api.ts'
  const TYPES_FILE = 'src/types.ts'
  const OUTPUT_FILE = 'src/lib/invoke-response-schema.generated.ts'

  const slash = (path) => path.replaceAll('\\', '/')
  const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
  const git = (args) =>
    execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

  const stagedFiles = STAGED
    ? new Set(git(['ls-files', '--cached', '-z']).split('\0').filter(Boolean).map(slash))
    : null
  const stagedText = new Map()

  function readStaged(path) {
    if (!stagedFiles?.has(path)) return undefined
    if (!stagedText.has(path)) stagedText.set(path, git(['show', `:${path}`]))
    return stagedText.get(path)
  }

  function repoPath(fileName) {
    const path = slash(relative(ROOT, resolve(fileName)))
    return path.startsWith('../') ? null : path
  }

  function readCompilerFile(fileName) {
    const path = repoPath(fileName)
    if (STAGED && path?.startsWith('src/') && /\.(?:ts|tsx)$/.test(path)) return readStaged(path)
    return ts.sys.readFile(fileName)
  }

  const configText = STAGED
    ? (readStaged('tsconfig.json') ?? readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'))
    : readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')
  const config = ts.parseConfigFileTextToJson(join(ROOT, 'tsconfig.json'), configText)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT)
  const rootNames = STAGED
    ? parsed.fileNames.filter((fileName) => {
        const path = repoPath(fileName)
        return path == null || !path.startsWith('src/') || stagedFiles.has(path)
      })
    : parsed.fileNames

  const host = ts.createCompilerHost(parsed.options, true)
  host.fileExists = (fileName) => readCompilerFile(fileName) !== undefined
  host.readFile = readCompilerFile
  host.getSourceFile = (fileName, languageVersion, onError) => {
    const source = readCompilerFile(fileName)
    if (source === undefined) {
      onError?.(`File not found: ${fileName}`)
      return undefined
    }
    return ts.createSourceFile(fileName, source, languageVersion, true, ts.getScriptKindFromFileName(fileName))
  }

  const program = ts.createProgram({ rootNames, options: parsed.options, host })
  const checker = program.getTypeChecker()
  const apiSource = program.getSourceFile(join(ROOT, API_FILE))
  const typesSource = program.getSourceFile(join(ROOT, TYPES_FILE))
  if (!apiSource || !typesSource) throw new Error(`Cannot load ${API_FILE} and ${TYPES_FILE}`)

  const commands = new Map()

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'invoke') {
      if (node.typeArguments?.length !== 1) {
        throw new Error(
          `${API_FILE}:${apiSource.getLineAndCharacterOfPosition(node.getStart()).line + 1}: invoke must declare exactly one response type argument`,
        )
      }
      const command = node.arguments[0]
      if (!command || !ts.isStringLiteral(command)) {
        throw new Error(
          `${API_FILE}:${apiSource.getLineAndCharacterOfPosition(node.getStart()).line + 1}: invoke command must be a string literal`,
        )
      }
      if (commands.has(command.text))
        throw new Error(`${API_FILE}: duplicate invoke response declaration for ${command.text}`)
      commands.set(command.text, checker.getTypeFromTypeNode(node.typeArguments[0]))
    }
    ts.forEachChild(node, visit)
  }

  visit(apiSource)
  if (commands.size === 0) throw new Error(`${API_FILE}: no invoke<T>(command) calls found`)

  const definitions = []
  const seen = new Map()

  function typeName(type) {
    return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
  }

  function isNamed(type, name) {
    return type.aliasSymbol?.getName() === name || type.symbol?.getName() === name || typeName(type) === name
  }

  function reference(type, build) {
    const prior = seen.get(type)
    if (prior !== undefined) return { kind: 'ref', id: prior }
    const id = definitions.length
    seen.set(type, id)
    definitions.push(null)
    definitions[id] = build()
    return { kind: 'ref', id }
  }

  function withoutUndefined(type, context) {
    if (!(type.flags & ts.TypeFlags.Union)) return type
    const kept = type.types.filter((part) => !(part.flags & ts.TypeFlags.Undefined))
    if (kept.length === type.types.length) return type
    if (kept.length === 0) throw new Error(`${context}: an optional response field cannot contain only undefined`)
    return kept.length === 1 ? kept[0] : { unionParts: kept }
  }

  function schemaForParts(parts, context) {
    if (parts.some((part) => part.flags & ts.TypeFlags.Undefined)) {
      throw new Error(`${context}: undefined is not a JSON response value`)
    }
    if (parts.length === 1) return schemaFor(parts[0], context)
    const hasTrue = parts.some((part) => part.flags & ts.TypeFlags.BooleanLiteral && part.intrinsicName === 'true')
    const hasFalse = parts.some((part) => part.flags & ts.TypeFlags.BooleanLiteral && part.intrinsicName === 'false')
    const nonBooleanParts = parts.filter((part) => !(part.flags & ts.TypeFlags.BooleanLiteral))
    const variants = [
      ...(hasTrue && hasFalse ? [{ kind: 'boolean' }] : []),
      ...(!hasTrue || !hasFalse
        ? parts.filter((part) => part.flags & ts.TypeFlags.BooleanLiteral).map((part) => schemaFor(part, context))
        : []),
      ...nonBooleanParts.map((part) => schemaFor(part, context)),
    ]
    return variants.length === 1 ? variants[0] : { kind: 'union', variants }
  }

  function schemaFor(typeOrParts, context) {
    if ('unionParts' in typeOrParts) return schemaForParts(typeOrParts.unionParts, context)
    const type = typeOrParts

    if (isNamed(type, 'DecimalString')) return { kind: 'decimal' }
    if (isNamed(type, 'JsonValue')) return { kind: 'json' }

    const flags = type.flags
    if (flags & ts.TypeFlags.Any) throw new Error(`${context}: any has no exact runtime contract`)
    if (flags & ts.TypeFlags.Unknown) return { kind: 'json' }
    if (flags & ts.TypeFlags.Void) return { kind: 'null' }
    if (flags & ts.TypeFlags.Undefined) throw new Error(`${context}: undefined is not a JSON response value`)
    if (flags & ts.TypeFlags.Null) return { kind: 'null' }
    if (flags & ts.TypeFlags.StringLiteral) return { kind: 'literal', value: type.value }
    if (flags & ts.TypeFlags.NumberLiteral) return { kind: 'literal', value: type.value }
    if (flags & ts.TypeFlags.BooleanLiteral) return { kind: 'literal', value: type.intrinsicName === 'true' }
    if (flags & ts.TypeFlags.String) return { kind: 'string' }
    if (flags & ts.TypeFlags.Number) return { kind: 'number' }
    if (flags & ts.TypeFlags.Boolean) return { kind: 'boolean' }
    if (flags & ts.TypeFlags.Never) throw new Error(`${context}: never has no wire value`)
    if (flags & ts.TypeFlags.TypeParameter) throw new Error(`${context}: unresolved type parameter ${typeName(type)}`)
    if (flags & ts.TypeFlags.Conditional) throw new Error(`${context}: unresolved conditional type ${typeName(type)}`)
    if (flags & ts.TypeFlags.IndexedAccess) throw new Error(`${context}: unresolved indexed access ${typeName(type)}`)
    if (flags & ts.TypeFlags.TemplateLiteral)
      throw new Error(`${context}: template literal type is not supported: ${typeName(type)}`)

    if (flags & ts.TypeFlags.Union) {
      return reference(type, () => schemaForParts(type.types, context))
    }

    if (checker.isTupleType(type)) {
      return reference(type, () => ({
        kind: 'tuple',
        items: checker.getTypeArguments(type).map((part, index) => schemaFor(part, `${context}[${index}]`)),
      }))
    }

    if (checker.isArrayType(type) || type.symbol?.getName() === 'ReadonlyArray') {
      const item = checker.getTypeArguments(type)[0]
      if (!item) throw new Error(`${context}: cannot resolve array item type for ${typeName(type)}`)
      return reference(type, () => ({ kind: 'array', item: schemaFor(item, `${context}[]`) }))
    }

    if (!(flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) {
      throw new Error(`${context}: unsupported TypeScript type ${typeName(type)} (flags ${flags})`)
    }

    return reference(type, () => {
      if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) {
        throw new Error(`${context}: callable values are not JSON response contracts`)
      }
      const properties = checker.getPropertiesOfType(type)
      const fields = {}
      for (const property of properties.sort((left, right) => compareText(left.getName(), right.getName()))) {
        const name = property.getName()
        if (name.startsWith('__@')) throw new Error(`${context}: symbol property ${name} is not a JSON key`)
        const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? typesSource
        const optional = Boolean(property.flags & ts.SymbolFlags.Optional)
        const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration)
        const wireType = optional ? withoutUndefined(propertyType, `${context}.${name}`) : propertyType
        fields[name] = { optional, schema: schemaFor(wireType, `${context}.${name}`) }
      }

      const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String)
      const numberIndex = checker.getIndexTypeOfType(type, ts.IndexKind.Number)
      if (numberIndex && !stringIndex)
        throw new Error(`${context}: numeric index signatures are not JSON object contracts`)
      return {
        kind: 'object',
        fields,
        additional: stringIndex ? schemaFor(stringIndex, `${context}[string]`) : null,
      }
    })
  }

  function exportedType(name) {
    const module = checker.getSymbolAtLocation(typesSource)
    const symbol = module && checker.getExportsOfModule(module).find((candidate) => candidate.getName() === name)
    if (!symbol) throw new Error(`${TYPES_FILE}: missing exported type ${name}`)
    return checker.getDeclaredTypeOfSymbol(symbol)
  }

  const preferenceValues = {}
  const preferenceValueProperties = checker
    .getPropertiesOfType(exportedType('PreferenceInfoValueByKey'))
    .sort((left, right) => compareText(left.getName(), right.getName()))
  for (const property of preferenceValueProperties) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? typesSource
    preferenceValues[property.getName()] = schemaFor(
      checker.getTypeOfSymbolAtLocation(property, declaration),
      `PreferenceInfoValueByKey.${property.getName()}`,
    )
  }

  const preferenceKeyType = exportedType('PreferenceKey')
  const preferenceKeyParts =
    preferenceKeyType.flags & ts.TypeFlags.Union ? preferenceKeyType.types : [preferenceKeyType]
  if (preferenceKeyParts.some((part) => !(part.flags & ts.TypeFlags.StringLiteral))) {
    throw new Error(`${TYPES_FILE}: PreferenceKey must be a closed string-literal union`)
  }
  const preferenceKeys = preferenceKeyParts.map((part) => part.value).sort()
  const preferenceValueKeys = preferenceValueProperties.map((property) => property.getName()).sort()
  if (preferenceKeys.join('\0') !== preferenceValueKeys.join('\0')) {
    throw new Error(`${TYPES_FILE}: PreferenceInfoValueByKey must define exactly every PreferenceKey`)
  }

  const getPreferenceType = commands.get('get_preference')
  if (!getPreferenceType || getPreferenceType.aliasSymbol?.getName() !== 'PreferenceInfoResponse') {
    throw new Error(`${API_FILE}: get_preference must declare invoke<PreferenceInfoResponse<K>>`)
  }

  const commandSchemas = {}
  for (const [command, type] of [...commands].sort(([left], [right]) => compareText(left, right))) {
    commandSchemas[command] = command === 'get_preference' ? { kind: 'preference' } : schemaFor(type, command)
  }

  if (definitions.some((definition) => definition === null))
    throw new Error('Internal error: incomplete response schema')

  const document = {
    commands: commandSchemas,
    definitions,
    preferenceValues,
  }
  const generated =
    `// Generated by scripts/generate-invoke-response-schema.mjs. Do not edit.\n` +
    `import type { InvokeResponseSchemaDocument } from './invoke-response-schema'\n\n` +
    `export const invokeResponseSchemaDocument: InvokeResponseSchemaDocument = ${JSON.stringify(document, null, 2)}\n\n` +
    `export const INVOKE_RESPONSE_SCHEMA_COMMAND_COUNT = ${commands.size}\n`

  const outputPath = join(ROOT, OUTPUT_FILE)
  if (CHECK) {
    const current = STAGED ? readStaged(OUTPUT_FILE) : readFileSync(outputPath, 'utf8')
    if (current !== generated) {
      throw new Error(`${OUTPUT_FILE} is stale; run node scripts/generate-invoke-response-schema.mjs`)
    }
    console.log(`invoke response schema is fresh (${commands.size} commands)`)
  } else {
    writeFileSync(outputPath, generated)
    console.log(`generated ${OUTPUT_FILE} (${commands.size} commands, ${definitions.length} definitions)`)
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryUrl === import.meta.url) {
  runInvokeResponseSchemaGenerator({
    check: process.argv.includes('--check'),
    staged: process.argv.includes('--staged'),
  })
}
