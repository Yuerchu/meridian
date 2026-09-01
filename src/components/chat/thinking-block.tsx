import { useTranslation } from 'react-i18next'
import { Comment } from '@gravity-ui/icons'
import { ChatTool, ChatToolContent, ChatToolTrigger } from '@/components/ui/chat-tool'
import { usePanelExpansion } from '@/hooks/use-panel-expansion'
import { cn } from '@/lib/utils'

/**
 * The reasoning behind a bubble, as a key on its keyboard.
 *
 * One panel per bubble rather than one per reasoning block: the model may think
 * several times on the way to one answer, and what the reader wants is "what
 * was it thinking", not a stack of keys that each say "Thinking". Open while
 * the thought is still arriving — it is the only sign of life at that point —
 * and shut once the answer starts, unless the reader opened it themselves.
 */
export function ThinkingBlock({
  text,
  panelKey,
  isStreaming = false,
}: {
  text: string
  /** Stable across renders and across the post-turn reload, which re-keys the
   *  rows: a bubble's own key, which is derived from the row id. */
  panelKey: string
  isStreaming?: boolean
}) {
  const { t } = useTranslation()
  const expansion = usePanelExpansion(panelKey, isStreaming, false)
  return (
    <ChatTool state={isStreaming ? 'input-streaming' : 'output-available'} {...expansion}>
      <ChatToolTrigger>
        <Comment aria-hidden className="size-3.5 shrink-0 text-muted" />
        <span className={cn('font-medium text-foreground', isStreaming && 'shimmer')}>{t('chat.thinking')}</span>
      </ChatToolTrigger>
      <ChatToolContent>
        <div data-slot="thinking-text" className="leading-relaxed whitespace-pre-wrap text-muted">
          {text}
        </div>
      </ChatToolContent>
    </ChatTool>
  )
}
