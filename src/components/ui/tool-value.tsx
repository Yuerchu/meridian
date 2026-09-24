import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { cx } from '@/utils/cx'
import { fieldLabel, isInlineValue, parseStructured } from '@/lib/tool-value'

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
      <span data-slot="tool-value-null" className="text-text-secondary">
        {t('chat.tool.value.none')}
      </span>
    )
  }
  if (typeof value === 'boolean') {
    return (
      <span
        data-slot="tool-value-boolean"
        data-value={value}
        className={cx(value ? 'text-status-success-soft-foreground' : 'text-text-secondary')}
      >
        {t(value ? 'chat.tool.value.yes' : 'chat.tool.value.no')}
      </span>
    )
  }
  if (typeof value === 'number') {
    return (
      <span data-slot="tool-value-number" className="font-mono text-text-primary tabular-nums">
        {value}
      </span>
    )
  }
  if (value === '') {
    return (
      <span data-slot="tool-value-empty" className="text-text-secondary">
        {t('chat.tool.value.empty')}
      </span>
    )
  }
  return (
    <span
      data-slot="tool-value-string"
      className="min-w-0 font-mono break-words text-text-primary [overflow-wrap:anywhere]"
    >
      {value}
    </span>
  )
}

function LongText({ text }: { text: string }) {
  return (
    <pre
      data-slot="tool-value-text"
      className="max-h-48 min-w-0 overflow-auto rounded-md bg-background-secondary-default/40 px-2 py-1 font-mono text-caption-1-regular whitespace-pre-wrap text-text-primary/90 [overflow-wrap:anywhere]"
    >
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
      <span data-slot="tool-value-empty" className="text-text-secondary">
        {t('chat.tool.value.empty')}
      </span>
    )
  }
  return (
    <dl data-slot="tool-fields" className={cx('flex min-w-0 flex-col gap-1.5 text-caption-1-regular', className)}>
      {entries.map(([key, value]) => {
        const inline = isInlineValue(value)
        return (
          <div
            key={key}
            data-slot="tool-field"
            data-inline={inline || undefined}
            className={cx('flex min-w-0 gap-x-2', inline ? 'flex-row items-baseline' : 'flex-col gap-y-1')}
          >
            <dt data-slot="tool-field-label" className="shrink-0 text-text-secondary">
              {fieldLabel(t, key)}
            </dt>
            <dd data-slot="tool-field-value" className="min-w-0">
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
    <div data-slot="tool-value-table-scroll" className="max-h-72 min-w-0 overflow-auto">
      <table data-slot="tool-value-table" className="w-full border-collapse text-left text-caption-1-regular">
        <thead data-slot="tool-value-table-head">
          <tr data-slot="tool-value-table-row">
            {keys.map((key) => (
              <th
                key={key}
                data-slot="tool-value-table-header"
                className="border-b border-border-button-default/50 px-2 py-1 text-caption-1-medium whitespace-nowrap text-text-secondary"
              >
                {fieldLabel(t, key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody data-slot="tool-value-table-body">
          {items.map((item, i) => (
            <tr
              key={i}
              data-slot="tool-value-table-row"
              className="not-last:border-b not-last:border-border-button-default/30"
            >
              {keys.map((key) => {
                const v = item[key]
                return (
                  <td key={key} data-slot="tool-value-table-cell" className="px-2 py-1 align-top">
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
      <span data-slot="tool-value-empty" className="text-text-secondary">
        {t('chat.tool.value.empty')}
      </span>
    )
  }
  return (
    <span data-slot="tool-value-chips" className="inline-flex flex-wrap gap-1">
      {items.map((item, i) => (
        <span
          key={i}
          data-slot="tool-value-chip"
          className="rounded-md bg-background-secondary-default/60 px-1.5 font-mono text-caption-1-regular text-text-primary"
        >
          {item}
        </span>
      ))}
    </span>
  )
}

function McpContent({ parts }: { parts: McpPart[] }) {
  return (
    <div data-slot="tool-value-mcp" className="flex min-w-0 flex-col gap-2">
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
              className="max-h-72 max-w-full rounded-md object-contain"
            />
          )
        }
        return (
          <div key={i} data-slot="tool-value-resource" className="flex min-w-0 flex-col gap-1">
            {part.resource.uri && (
              <span data-slot="tool-value-resource-uri" className="truncate font-mono text-text-secondary">
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
      <span data-slot="tool-value-deep" className="text-text-secondary">
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
        <span data-slot="tool-value-empty" className="text-text-secondary">
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
      <ol data-slot="tool-value-list" className="flex min-w-0 flex-col gap-1.5">
        {value.map((item, i) => (
          <li
            key={i}
            data-slot="tool-value-list-item"
            className={cx('min-w-0', isRecord(item) && 'rounded-md border border-border-button-default/50 px-2 py-1.5')}
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
      <div data-slot="tool-structured-result" className={cx('max-h-96 min-w-0 overflow-auto px-3 py-2', className)}>
        <ToolValue value={structured} />
      </div>
    )
  }
  return (
    <pre
      data-slot="tool-text-result"
      className={cx(
        'max-h-72 overflow-auto px-3 py-2 font-mono text-caption-1-regular whitespace-pre-wrap text-text-primary/90 [overflow-wrap:anywhere]',
        className,
      )}
    >
      {text}
    </pre>
  )
}
