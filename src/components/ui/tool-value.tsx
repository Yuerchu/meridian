import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { fieldLabel, isInlineValue, parseStructured } from '@/lib/tool-value'
import { titleIfTruncated } from '@/lib/truncation'
import './tool-value.css'

/**
 * A value of a shape nobody told us about, drawn as something to look at.
 *
 * This is the one place a tool's arguments or result are turned from data into
 * UI when no renderer knows the tool: MCP, custom tools, and the fields of a
 * built-in tool's JSON answer. It never pastes the JSON source back — an object
 * is a list of labelled rows, an array of like objects is a table, an array of
 * anything else is a list, a long string is a scrolling block, and a number or
 * a boolean is a token. MCP's `content` array (`text` / `image` / `resource`)
 * is recognised and drawn by its parts.
 *
 * `lint: meridian-ui/no-json-tool-display` keeps `JSON.stringify` out of the
 * tool renderers; this file is where a value goes instead.
 */

const MAX_DEPTH = 6

function joinClasses(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type McpPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri?: string; text?: string } }

function asMcpContent(value: unknown): McpPart[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const ok = value.every(
    (part) =>
      isRecord(part) &&
      ((part.type === 'text' && typeof part.text === 'string') ||
        (part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') ||
        (part.type === 'resource' && isRecord(part.resource))),
  )
  return ok ? (value as McpPart[]) : null
}

function Scalar({ value }: { value: null | number | boolean | string }) {
  const { t } = useTranslation()
  if (value === null) {
    return (
      <span data-slot="tool-value-null" className="m-tool-value-muted">
        {t('chat.tool.value.none')}
      </span>
    )
  }
  if (typeof value === 'boolean') {
    return (
      <span data-slot="tool-value-boolean" data-value={value} className="m-tool-value-boolean">
        {t(value ? 'chat.tool.value.yes' : 'chat.tool.value.no')}
      </span>
    )
  }
  if (typeof value === 'number') {
    return (
      <span data-slot="tool-value-number" className="m-tool-value-number">
        {value}
      </span>
    )
  }
  if (value === '') {
    return (
      <span data-slot="tool-value-empty" className="m-tool-value-muted">
        {t('chat.tool.value.empty')}
      </span>
    )
  }
  return (
    <span data-slot="tool-value-string" className="m-tool-value-string">
      {value}
    </span>
  )
}

function LongText({ text }: { text: string }) {
  return (
    <pre data-slot="tool-value-text" className="m-tool-value-text">
      {text}
    </pre>
  )
}

/** A list of labelled rows: an object, or a tool's arguments. */
export function ToolFields({
  entries,
  depth = 0,
  className,
}: {
  entries: [string, unknown][]
  depth?: number
  className?: string
}) {
  const { t } = useTranslation()
  if (entries.length === 0) {
    return (
      <span data-slot="tool-value-empty" className="m-tool-value-muted">
        {t('chat.tool.value.empty')}
      </span>
    )
  }
  return (
    <dl data-slot="tool-fields" className={joinClasses('m-tool-fields', className)}>
      {entries.map(([key, value]) => {
        const inline = isInlineValue(value)
        return (
          <div key={key} data-slot="tool-field" data-inline={inline || undefined} className="m-tool-field">
            <dt data-slot="tool-field-label" className="m-tool-field__label">
              {fieldLabel(t, key)}
            </dt>
            <dd data-slot="tool-field-value" className="m-tool-field__value">
              <ToolValue value={value} depth={depth + 1} />
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/** An array of objects sharing a few primitive-valued keys: a table reads
 *  better than the same labels repeated on every row. */
function tableShape(items: unknown[]): string[] | null {
  if (items.length < 2 || !items.every(isRecord)) return null
  const keys = Object.keys(items[0] as Record<string, unknown>)
  if (keys.length === 0 || keys.length > 6) return null
  const same = items.every((item) => {
    const k = Object.keys(item as Record<string, unknown>)
    return k.length === keys.length && keys.every((key) => k.includes(key))
  })
  if (!same) return null
  const flat = items.every((item) =>
    keys.every((key) => {
      const v = (item as Record<string, unknown>)[key]
      return isInlineValue(v) || (Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length < 40))
    }),
  )
  return flat ? keys : null
}

function Table({ items, keys }: { items: Record<string, unknown>[]; keys: string[] }) {
  const { t } = useTranslation()
  return (
    <div data-slot="tool-value-table-scroll" className="m-tool-value-table-scroll">
      <table data-slot="tool-value-table" className="m-tool-value-table">
        <thead data-slot="tool-value-table-head">
          <tr data-slot="tool-value-table-row">
            {keys.map((key) => (
              <th key={key} data-slot="tool-value-table-header" className="m-tool-value-table__header">
                {fieldLabel(t, key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody data-slot="tool-value-table-body">
          {items.map((item, i) => (
            <tr key={i} data-slot="tool-value-table-row" className="m-tool-value-table__row">
              {keys.map((key) => {
                const v = item[key]
                return (
                  <td key={key} data-slot="tool-value-table-cell" className="m-tool-value-table__cell">
                    {Array.isArray(v) ? (
                      <InlineList items={v as string[]} />
                    ) : (
                      <Scalar value={v as null | number | boolean | string} />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InlineList({ items }: { items: string[] }) {
  const { t } = useTranslation()
  if (items.length === 0) {
    return (
      <span data-slot="tool-value-empty" className="m-tool-value-muted">
        {t('chat.tool.value.empty')}
      </span>
    )
  }
  return (
    <span data-slot="tool-value-chips" className="m-tool-value-chips">
      {items.map((item, i) => (
        <span key={i} data-slot="tool-value-chip" className="m-tool-value-chip">
          {item}
        </span>
      ))}
    </span>
  )
}

function McpContent({ parts }: { parts: McpPart[] }) {
  return (
    <div data-slot="tool-value-mcp" className="m-tool-value-mcp">
      {parts.map((part, i) => {
        if (part.type === 'text') {
          const nested = parseStructured(part.text)
          return nested !== null ? (
            <ToolValue key={i} value={nested} depth={1} />
          ) : (
            <LongText key={i} text={part.text} />
          )
        }
        if (part.type === 'image') {
          return (
            <img
              key={i}
              data-slot="tool-value-image"
              alt=""
              src={`data:${part.mimeType};base64,${part.data}`}
              className="m-tool-value-image"
            />
          )
        }
        return (
          <div key={i} data-slot="tool-value-resource" className="m-tool-value-resource">
            {part.resource.uri && (
              <span
                data-slot="tool-value-resource-uri"
                onPointerEnter={titleIfTruncated}
                className="m-tool-value-resource__uri"
              >
                {part.resource.uri}
              </span>
            )}
            {part.resource.text && <LongText text={part.resource.text} />}
          </div>
        )
      })}
    </div>
  )
}

/** Any JSON value, by its type. */
export function ToolValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const { t } = useTranslation()
  if (depth > MAX_DEPTH) {
    return (
      <span data-slot="tool-value-deep" className="m-tool-value-muted">
        …
      </span>
    )
  }
  if (value === null || value === undefined) return <Scalar value={null} />
  if (typeof value === 'number' || typeof value === 'boolean') return <Scalar value={value} />
  if (typeof value === 'string') return isInlineValue(value) ? <Scalar value={value} /> : <LongText text={value} />
  const mcp = asMcpContent(value)
  if (mcp) return <McpContent parts={mcp} />
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span data-slot="tool-value-empty" className="m-tool-value-muted">
          {t('chat.tool.value.emptyList')}
        </span>
      )
    }
    if (value.every((item) => typeof item === 'string' && isInlineValue(item))) {
      return <InlineList items={value as string[]} />
    }
    const keys = tableShape(value)
    if (keys) return <Table items={value as Record<string, unknown>[]} keys={keys} />
    return (
      <ol data-slot="tool-value-list" className="m-tool-value-list">
        {value.map((item, i) => (
          <li
            key={i}
            data-slot="tool-value-list-item"
            data-record={isRecord(item) || undefined}
            className="m-tool-value-list__item"
          >
            <ToolValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    )
  }
  if (isRecord(value)) return <ToolFields entries={Object.entries(value)} depth={depth} />
  return <Scalar value={String(value)} />
}

/**
 * A tool's result text, read for structure: a JSON object or array is drawn as
 * one, anything else is kept as the lines the tool wrote.
 */
export function ToolTextResult({ text, className }: { text: string; className?: string }) {
  const structured = React.useMemo(() => parseStructured(text), [text])
  if (structured !== null) {
    return (
      <div data-slot="tool-structured-result" className={joinClasses('m-tool-structured-result', className)}>
        <ToolValue value={structured} />
      </div>
    )
  }
  return (
    <pre data-slot="tool-text-result" className={joinClasses('m-tool-text-result', className)}>
      {text}
    </pre>
  )
}
