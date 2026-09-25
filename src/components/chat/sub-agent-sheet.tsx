import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/base'
import { ErrorAlert } from '@/components/ui/error-alert'
import { Sheet } from '@/components/base'
import { useConversationStore } from '@/stores/conversation-store'
import { useTurns } from '@/hooks/use-turns'
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
  const [load, setLoad] = React.useState<'loading' | 'loaded' | 'failed'>('loading')
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    setLoad('loading')
    ensureSession(conversationId)
    // `loadMessages` answers `false` for a fetch that failed and for a snapshot
    // that would not validate, having already put the reason on the session. A
    // `finally` reads both of those as success: with nothing cached the sheet
    // then says "nothing recorded yet" about a run that has a transcript, and
    // with something cached it presents stale rows as current — in neither case
    // saying anything went wrong, and in neither case offering a way to retry.
    void loadMessages(conversationId).then(
      (ok) => {
        if (!cancelled) setLoad(ok ? 'loaded' : 'failed')
      },
      () => {
        if (!cancelled) setLoad('failed')
      },
    )
    return () => {
      cancelled = true
    }
  }, [conversationId, ensureSession, loadMessages, attempt])

  const messages = session?.messages ?? NO_MESSAGES
  const streaming = session?.streaming ?? false
  const turns = useTurns(messages, streaming, session?.turns)
  // The first load has nothing to draw until it lands; a live run whose
  // session already holds rows is drawn at once and reconciled under itself.
  // A failed load with rows already in hand is the one case that draws anyway:
  // those rows are real, they came from the live stream, and the notice above
  // them says the rest could not be fetched.
  const ready = load === 'loaded' || messages.length > 0
  const failed = load === 'failed'

  return (
    <Sheet isOpen placement="right" onOpenChange={(open) => !open && onClose()} isDismissable>
      <Sheet.Backdrop>
        <Sheet.Content className="w-full sm:max-w-2xl">
          <Sheet.Dialog className="flex h-full min-h-0 flex-col">
            <Sheet.Header className="pe-14">
              <Sheet.Heading className="truncate">{request.title}</Sheet.Heading>
              <p data-slot="sub-agent-sheet-kind" className="mt-1 text-caption-1-regular text-text-secondary">
                {t(`chat.subAgent.${request.kind}`)}
              </p>
              <Sheet.CloseTrigger aria-label={t('common.close')} />
            </Sheet.Header>
            <Sheet.Body data-sheet-no-drag className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
              {failed && (
                // The read's own failure, not the session's last action error:
                // that one belongs to whatever the run was doing, and a stale
                // one standing in for "why could this not be loaded" is the
                // wrong reason given confidently.
                <ErrorAlert
                  data-slot="sub-agent-sheet-error"
                  className="m-4 mb-0"
                  title={t('chat.subAgent.loadFailed')}
                  message={session?.loadError ?? t('chat.subAgent.loadFailed')}
                  onRetry={() => setAttempt((n) => n + 1)}
                />
              )}
              {ready ? (
                <ChatTranscript
                  turns={turns}
                  conversationId={conversationId}
                  streaming={streaming}
                  scrollToBottomLabel={t('chat.scrollToBottom')}
                  emptyState={
                    <p
                      data-slot="sub-agent-sheet-empty"
                      className="px-6 py-8 text-center text-body-regular text-text-secondary"
                    >
                      {t('chat.tool.panel.processEmpty')}
                    </p>
                  }
                />
              ) : failed ? null : (
                // Not while it is failing: a skeleton is a promise that
                // something is on its way, and the notice above has just said
                // it is not.
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
  // The back gesture is the Sheet's own level now — see `base/sheet.tsx`. It
  // closes through `onOpenChange`, which is `close`.
  const value = React.useMemo(() => ({ open: setRequest }), [])
  return (
    <SubAgentSheetContext value={value}>
      {children}
      {request && <SubAgentSheet request={request} onClose={close} />}
    </SubAgentSheetContext>
  )
}
