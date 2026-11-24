import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ToolFields as UiToolFields,
  ToolTextResult as UiToolTextResult,
  ToolValue as UiToolValue,
} from '@/components/yuerchu-ui/components/chat-tool/chat-tool'
import { fieldLabel } from '@/lib/tool-value'

/** Meridian's localized wrappers over `@yuerchu/ui`'s structured tool value components. */

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
  const formatKey = useCallback((key: string) => fieldLabel(t, key), [t])
  return <UiToolFields entries={entries} depth={depth} formatKey={formatKey} className={className} />
}

export function ToolValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const { t } = useTranslation()
  const formatKey = useCallback((key: string) => fieldLabel(t, key), [t])
  return <UiToolValue value={value} depth={depth} formatKey={formatKey} />
}

export function ToolTextResult({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation()
  const formatKey = useCallback((key: string) => fieldLabel(t, key), [t])
  return <UiToolTextResult text={text} formatKey={formatKey} className={className} />
}
