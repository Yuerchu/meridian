import './sub-agent-sheet.css'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from '@/components/yuerchu-ui/components/drawer/drawer'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { ErrorAlert } from '@/components/ui/error-alert'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useConversationStore } from '@/stores/conversation-store'
import { useTurns } from '@/hooks/use-turns'
import { ChatTranscript } from './chat-transcript'
import { SubAgentSheetContext, type SubAgentSheetRequest } from './sub-agent-sheet-context'
import type { MessageViewModel } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

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

  // The library's Drawer does not know about the back gesture.
  useHistoryLevel(true, onClose)

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
  const turns = useTurns(messages, streaming, session?.turns, session?.liveTriggers)
  // The first load has nothing to draw until it lands; a live run whose
  // session already holds rows is drawn at once and reconciled under itself.
  // A failed load with rows already in hand is the one case that draws anyway:
  // those rows are real, they came from the live stream, and the notice above
  // them says the rest could not be fetched.
  const ready = load === 'loaded' || messages.length > 0
  const failed = load === 'failed'

  return (
    <Drawer
      isOpen
      side="right"
      size="lg"
      onOpenChange={(open) => !open && onClose()}
      isDismissable
      heading={
        <span className="m-sub-agent-sheet__title" onPointerEnter={titleIfTruncated}>
          {request.title}
        </span>
      }
      description={
        <span data-slot="sub-agent-sheet-kind" className="m-sub-agent-sheet__kind">
          {t(`chat.subAgent.${request.kind}`)}
        </span>
      }
    >
      <div className="m-sub-agent-sheet__body">
        {failed && (
          // The read's own failure, not the session's last action error:
          // that one belongs to whatever the run was doing, and a stale
          // one standing in for "why could this not be loaded" is the
          // wrong reason given confidently.
          <ErrorAlert
            data-slot="sub-agent-sheet-error"
            className="m-sub-agent-sheet__error"
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
              <p data-slot="sub-agent-sheet-empty" className="m-sub-agent-sheet__empty">
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
            className="m-sub-agent-sheet__loading"
          >
            <div className="m-sub-agent-sheet__outgoing-placeholder">
              <Skeleton shape="rect" width="100%" height="2.5rem" />
            </div>
            <Skeleton shape="rect" width="100%" height="6rem" />
            <Skeleton shape="rect" width="83.33%" height="4rem" />
          </div>
        )}
      </div>
    </Drawer>
  )
}

export function SubAgentSheetProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<SubAgentSheetRequest | null>(null)
  const close = React.useCallback(() => setRequest(null), [])
  const value = React.useMemo(() => ({ open: setRequest }), [])
  return (
    <SubAgentSheetContext value={value}>
      {children}
      {request && <SubAgentSheet request={request} onClose={close} />}
    </SubAgentSheetContext>
  )
}
