import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@heroui/react'
import { Sheet } from '@heroui-pro/react/sheet'
import { useConversationStore } from '@/stores/conversation-store'
import { useTurns } from '@/hooks/use-turns'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { ChatTranscript } from './chat-transcript'
import { SubAgentSheetContext, type SubAgentSheetRequest } from './sub-agent-sheet-context'
import type { MessageViewModel } from '@/types'

/**
 * A delegated run's own conversation, beside the transcript that started it.
 *
 * The sheet is the same shell the file preview uses, and what it draws is the
 * real transcript — `ChatTranscript` over the run's session in the store —
 * rather than a step list projected out of a snapshot. One renderer, and a
 * reader who opens a run sees its bubbles, its keys and its thinking exactly
 * as they would in the window.
 *
 * The session is the store's: the global listener has been writing the run's
 * stream into it since the run announced itself, and `loadMessages` brings in
 * whatever happened before this window was watching. Loading is asked for on
 * every open — it reconciles rather than replaces, so an open sheet on a live
 * run keeps up through the same events the parent does.
 */

const NO_MESSAGES: MessageViewModel[] = []

function SubAgentSheet({ request, onClose }: { request: SubAgentSheetRequest; onClose: () => void }) {
  const { t } = useTranslation()
  const { conversationId } = request
  const ensureSession = useConversationStore((s) => s.ensureSession)
  const loadMessages = useConversationStore((s) => s.loadMessages)
  const session = useConversationStore((s) => s.sessions[conversationId])
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoaded(false)
    ensureSession(conversationId)
    void loadMessages(conversationId).finally(() => {
      if (!cancelled) setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, ensureSession, loadMessages])

  const messages = session?.messages ?? NO_MESSAGES
  const streaming = session?.streaming ?? false
  const turns = useTurns(messages, streaming, session?.turns)
  // The first load has nothing to draw until it lands; a live run whose
  // session already holds rows is drawn at once and reconciled under itself.
  const ready = loaded || messages.length > 0

  return (
    <Sheet isOpen placement="right" onOpenChange={(open) => !open && onClose()} isDismissable>
      <Sheet.Backdrop variant="blur">
        <Sheet.Content className="w-full sm:max-w-2xl">
          <Sheet.Dialog className="flex h-full min-h-0 flex-col">
            <Sheet.Header className="pe-14">
              <Sheet.Heading className="truncate">{request.title}</Sheet.Heading>
              <p data-slot="sub-agent-sheet-kind" className="mt-1 text-xs text-muted">
                {t(`chat.subAgent.${request.kind}`)}
              </p>
              <Sheet.CloseTrigger aria-label={t('common.close')} />
            </Sheet.Header>
            <Sheet.Body data-sheet-no-drag className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
              {ready ? (
                <ChatTranscript
                  turns={turns}
                  conversationId={conversationId}
                  streaming={streaming}
                  scrollToBottomLabel={t('chat.scrollToBottom')}
                  emptyState={
                    <p data-slot="sub-agent-sheet-empty" className="px-6 py-8 text-center text-sm text-muted">
                      {t('chat.tool.panel.processEmpty')}
                    </p>
                  }
                />
              ) : (
                <div
                  data-slot="sub-agent-sheet-loading"
                  role="status"
                  aria-busy="true"
                  aria-label={t('chat.tool.panel.processLoading')}
                  className="flex flex-col gap-3 px-6 py-6"
                >
                  <Skeleton className="h-10 w-3/4 self-end rounded-2xl" />
                  <Skeleton className="h-24 w-full rounded-2xl" />
                  <Skeleton className="h-16 w-5/6 rounded-2xl" />
                </div>
              )}
            </Sheet.Body>
          </Sheet.Dialog>
        </Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
  )
}

export function SubAgentSheetProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<SubAgentSheetRequest | null>(null)
  const close = React.useCallback(() => setRequest(null), [])
  // On Android/iOS an overlay is a history level, so the back gesture closes
  // the sheet rather than leaving the conversation under it.
  useHistoryLevel(request !== null, close)
  const value = React.useMemo(() => ({ open: setRequest }), [])
  return (
    <SubAgentSheetContext value={value}>
      {children}
      {request && <SubAgentSheet request={request} onClose={close} />}
    </SubAgentSheetContext>
  )
}
