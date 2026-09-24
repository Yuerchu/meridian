import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ClaudeSessionPicker } from './claude-session-picker'
import i18n from '@/i18n'
import type { AcpDiscoveredSessionInfoResponse } from '@/types'

const acpListSessions = vi.fn()
const acpImportSession = vi.fn()
const acpAttachSession = vi.fn()
const acpConversationSession = vi.fn()
/** What the native directory picker hands back. */
const pickDirectory = vi.fn()

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: () => pickDirectory() }))

vi.mock('@/api', () => ({
  api: {
    acpListSessions: (...args: unknown[]) => acpListSessions(...args),
    acpImportSession: (...args: unknown[]) => acpImportSession(...args),
    acpAttachSession: (...args: unknown[]) => acpAttachSession(...args),
    acpConversationSession: (...args: unknown[]) => acpConversationSession(...args),
  },
}))

function session(
  over: Partial<AcpDiscoveredSessionInfoResponse> & { sessionId: string },
): AcpDiscoveredSessionInfoResponse {
  return {
    cwd: '/work/meridian',
    title: null,
    updatedAt: null,
    ownedBy: null,
    ...over,
  }
}

const SESSIONS: AcpDiscoveredSessionInfoResponse[] = [
  session({ sessionId: 's-old', title: '很久以前', updatedAt: '2026-01-01T00:00:00.000Z' }),
  session({ sessionId: 's-none', title: '不知道什么时候' }),
  session({ sessionId: 's-new', title: '刚刚', updatedAt: '2026-08-20T11:00:00.000Z' }),
]

async function open(props: Partial<React.ComponentProps<typeof ClaudeSessionPicker>> = {}) {
  await i18n.changeLanguage('en')
  render(<ClaudeSessionPicker isOpen onOpenChange={() => {}} mode="import" {...props} />)
  // The list is a process start, so it always arrives asynchronously.
  await waitFor(() => expect(acpListSessions).toHaveBeenCalled())
}

/** The session rows' titles. Skips the "N more" line, which is not a session. */
function titles(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((row) => row.querySelector('[data-slot="session-title"]')?.textContent)
    .filter((title): title is string => title !== null && title !== undefined)
}

/** Waits for the list to settle at `count` rows. */
async function rows(count: number): Promise<HTMLElement[]> {
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(count))
  return screen.getAllByRole('listitem')
}

beforeEach(() => {
  vi.clearAllMocks()
  acpListSessions.mockResolvedValue(SESSIONS)
  pickDirectory.mockResolvedValue('/work/foxline')
})

/**
 * Most recently worked on first — with thirty of these on a laptop, the order
 * is most of the usefulness. A session the agent could not date sorts last: an
 * unknown time is not a recent one, and floating it to the top would put the
 * least identifiable row where the eye lands.
 */
test('sessions are listed newest first, with an undated one last', async () => {
  await open()
  await rows(3)
  expect(titles()).toEqual(['刚刚', '很久以前', '不知道什么时候'])
})

test('the search box narrows on title and on path', async () => {
  acpListSessions.mockResolvedValue([
    session({ sessionId: 's-a', title: 'queue work', cwd: '/work/meridian' }),
    session({ sessionId: 's-b', title: 'unrelated', cwd: '/work/foxline' }),
  ])
  await open()
  await rows(2)

  await userEvent.type(screen.getByRole('searchbox'), 'foxline')
  await rows(1)
  expect(screen.getByText('unrelated')).toBeInTheDocument()
})

/**
 * Importing marks the row and leaves the dialog up.
 *
 * Both halves matter. Anyone with a screenful of terminals is here to pull in
 * several, so closing after one would mean reopening — and each reopen is
 * another adapter start. And a row that still offers "Import" after being
 * imported invites a second attempt that can only fail on the unique index.
 */
test('an imported row becomes an already-imported row and the dialog stays open', async () => {
  acpImportSession.mockResolvedValue({ conversationId: 'conv-99', truncated: false, messages: 12 })
  const onOpenChange = vi.fn()
  await open({ onOpenChange })
  await rows(3)

  const row = screen.getByText('刚刚').closest('li')!
  await userEvent.click(within(row).getByRole('button', { name: 'Import' }))

  await waitFor(() => expect(within(row).getByRole('button', { name: /Imported/ })).toBeInTheDocument())
  expect(acpImportSession).toHaveBeenCalledWith({
    sessionId: 's-new',
    cwd: '/work/meridian',
    title: '刚刚',
    updatedAt: '2026-08-20T11:00:00.000Z',
  })
  expect(onOpenChange).not.toHaveBeenCalled()
  // And it was not re-fetched: the list is an adapter start, not a query.
  expect(acpListSessions).toHaveBeenCalledTimes(1)
})

/**
 * A session Meridian already owns is shown rather than hidden — the adapter has
 * no way to leave those out, and hiding them makes "where did that session go"
 * unanswerable. Pressing it goes to the conversation instead of importing it
 * again.
 */
test('a session another conversation owns opens that conversation', async () => {
  acpListSessions.mockResolvedValue([session({ sessionId: 's-mine', title: '已经在里面了', ownedBy: 'conv-7' })])
  const onOpenConversation = vi.fn()
  const onOpenChange = vi.fn()
  await open({ onOpenConversation, onOpenChange })
  await rows(1)

  expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Imported/ }))
  expect(onOpenConversation).toHaveBeenCalledWith('conv-7')
  expect(onOpenChange).toHaveBeenCalledWith(false)
  expect(acpImportSession).not.toHaveBeenCalled()
})

/**
 * Attaching opens on the conversation's own directory. The session it lost is
 * the one that ran there, and the whole-machine list is the wrong place to go
 * looking for it.
 */
test('attaching starts narrowed to the conversation directory and closes when it lands', async () => {
  acpConversationSession.mockResolvedValue({ cwd: '/work/foxline', acp_session_id: null })
  acpListSessions.mockResolvedValue([session({ sessionId: 's-a', title: 'there it is', cwd: '/work/foxline' })])
  const onOpenChange = vi.fn()
  await open({ mode: 'attach', conversationId: 'conv-1', onOpenChange })

  expect(acpConversationSession).toHaveBeenCalledWith('conv-1')
  expect(acpListSessions).toHaveBeenCalledWith({ cwd: '/work/foxline' })

  await rows(1)
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect(acpAttachSession).toHaveBeenCalledWith({
    conversationId: 'conv-1',
    sessionId: 's-a',
    cwd: '/work/foxline',
  })
  // The opposite of an import: there is exactly one session to pick and the
  // conversation it was picked for is already open behind this.
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
})

/**
 * A conversation with no record at all — one that never had a session, or a
 * read that failed — falls back to the whole machine rather than to a filter on
 * the empty string, which would list nothing and read as "you have no sessions".
 */
test('attaching a conversation with nothing on record lists every project', async () => {
  acpConversationSession.mockResolvedValue(null)
  await open({ mode: 'attach', conversationId: 'conv-1' })
  expect(acpListSessions).toHaveBeenCalledWith({ cwd: null })

  vi.clearAllMocks()
  acpListSessions.mockResolvedValue(SESSIONS)
  acpConversationSession.mockRejectedValue('no such conversation')
  await open({ mode: 'attach', conversationId: 'conv-2' })
  expect(acpListSessions).toHaveBeenCalledWith({ cwd: null })
})

/**
 * Two conversations pointing at one session would be two transcripts written
 * from the same place. The row says so instead of failing when pressed — the
 * unique index would refuse it anyway, several seconds later.
 */
test('a session held by another conversation cannot be attached', async () => {
  acpConversationSession.mockResolvedValue({ cwd: '/work/meridian', acp_session_id: null })
  acpListSessions.mockResolvedValue([
    session({ sessionId: 's-taken', title: '别人的', ownedBy: 'conv-other' }),
    session({ sessionId: 's-ours', title: '就是这个', ownedBy: 'conv-1' }),
  ])
  await open({ mode: 'attach', conversationId: 'conv-1' })
  await rows(2)

  expect(screen.getByText('Taken by another conversation')).toBeInTheDocument()
  expect(screen.getByText('Current')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
})

/** A failure belongs on the row that caused it, not on the dialog. */
test('an import that fails says so beside its own row', async () => {
  acpImportSession.mockRejectedValue('4 update(s) were lost while reading this session')
  await open()
  await rows(3)

  const row = screen.getByText('刚刚').closest('li')!
  await userEvent.click(within(row).getByRole('button', { name: 'Import' }))

  await waitFor(() => expect(within(row).getByRole('alert')).toHaveTextContent(/update\(s\) were lost/))
  // Still offered: the failure is retryable, and the row must not look done.
  expect(within(row).getByRole('button', { name: 'Import' })).toBeInTheDocument()
})

/**
 * A list that failed has to have a way back.
 *
 * Closing and reopening is another adapter start, and in `import` mode with no
 * folder chosen there is neither a folder button (remote) nor a clear button on
 * screen — without this the dialog is simply stuck.
 */
test('a list that failed offers a retry', async () => {
  acpListSessions.mockRejectedValueOnce('npx: command not found')
  await open()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('npx: command not found'))

  acpListSessions.mockResolvedValue(SESSIONS)
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await rows(3)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

/**
 * A load is an adapter start, so two of them are seconds apart and land out of
 * order. The stale one must not win — and the case that traps the dialog is a
 * stale *failure* landing over a good list, because the error state replaces
 * the whole list and takes the controls with it.
 */
test('a slow first load cannot overwrite the narrowed one that overtook it', async () => {
  let releaseWide: (v: AcpDiscoveredSessionInfoResponse[]) => void = () => {}
  let releaseWideError: (e: unknown) => void = () => {}
  acpListSessions.mockImplementationOnce(
    () =>
      new Promise<AcpDiscoveredSessionInfoResponse[]>((resolve, reject) => {
        releaseWide = resolve
        releaseWideError = reject
      }),
  )
  await open()
  expect(screen.queryByRole('listitem')).not.toBeInTheDocument()

  // The user narrows while the whole-machine list is still coming.
  const narrow = [session({ sessionId: 's-a', title: 'narrowed', cwd: '/work/foxline' })]
  acpListSessions.mockResolvedValue(narrow)
  await userEvent.click(screen.getByRole('button', { name: 'Folder' }))
  await rows(1)
  expect(titles()).toEqual(['narrowed'])

  releaseWide(SESSIONS)
  await new Promise((r) => setTimeout(r, 0))
  expect(titles()).toEqual(['narrowed'])

  // And the worse half: a stale rejection must not blank a good list.
  releaseWideError('the adapter never came up')
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(titles()).toEqual(['narrowed'])
})

/**
 * One row at a time. Each import starts an adapter and reads a whole session,
 * and a second press queueing invisibly behind the first looks like nothing
 * happened.
 */
test('while one row is importing the others cannot be pressed', async () => {
  let finish: (outcome: unknown) => void = () => {}
  acpImportSession.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
  await open()
  await rows(3)

  const first = screen.getByText('刚刚').closest('li')!
  const second = screen.getByText('很久以前').closest('li')!
  await userEvent.click(within(first).getByRole('button', { name: 'Import' }))

  await waitFor(() => expect(within(second).getByRole('button', { name: 'Import' })).toBeDisabled())
  // On the row, because React Aria drops everything but the labelable aria
  // props off a Button — and the button keeps its name so it does not vanish
  // from a screen reader mid-import.
  expect(first).toHaveAttribute('aria-busy', 'true')
  expect(within(first).getByRole('button', { name: 'Import' })).toBeInTheDocument()

  finish({ conversationId: 'conv-1', truncated: false, messages: 3 })
  await waitFor(() => expect(within(second).getByRole('button', { name: 'Import' })).toBeEnabled())
  expect(acpImportSession).toHaveBeenCalledTimes(1)
})

/**
 * The one fact about an import that cannot be found out anywhere else.
 *
 * Above 5 MiB the SDK replays only what follows the last compaction, with no
 * flag and no marker — so a six-day session comes back looking complete and
 * containing the last day. Said on the row, and left there: importing five in a
 * row would scroll a notification away.
 */
test('a session that came back as a tail says so on its row', async () => {
  acpImportSession.mockResolvedValue({ conversationId: 'conv-99', truncated: true, messages: 34 })
  await open()
  await rows(3)

  const row = screen.getByText('刚刚').closest('li')!
  await userEvent.click(within(row).getByRole('button', { name: 'Import' }))

  await waitFor(() => expect(within(row).getByText(/only the part after its last compaction/)).toBeInTheDocument())
})

/**
 * Measured: 596 sessions on one working laptop, each row a React Aria Button
 * that re-renders on every keystroke. Cut to the most recent, and the remainder
 * counted rather than silently dropped — otherwise "my session is not in the
 * list" has no answer.
 */
test('a very long list is cut, and says how much it cut', async () => {
  acpListSessions.mockResolvedValue(
    Array.from({ length: 250 }, (_, i) =>
      session({
        sessionId: `s-${i}`,
        title: `session ${i}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      }),
    ),
  )
  await open()
  // 100 rows plus the line that accounts for the rest.
  await rows(101)
  expect(screen.getByText('150 more — search to reach them')).toBeInTheDocument()
  // Newest first, so the cut takes the oldest.
  expect(titles()[0]).toBe('session 249')

  // And the search reaches past the cut.
  await userEvent.type(screen.getByRole('searchbox'), 'session 3')
  await waitFor(() => expect(screen.getByText('session 3')).toBeInTheDocument())
})
