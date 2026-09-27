import { create } from 'zustand'

import { api } from '@/api'
import type { SystemNoticeEvent } from '@/lib/app-event'
import { isRemote } from '@/lib/transport'
import type { SystemNoticeInfoResponse } from '@/types'

/**
 * What this machine did on its own — a dictionary upgrade after an update —
 * as the inbox's system tab shows it. Beside the attention queue rather than
 * in it: a notice belongs to no conversation, has no approval id, and waits on
 * nobody, so none of the queue's rules (the floating stack, the sidebar dot,
 * answering to retire it) apply.
 *
 * A remote client has none: the notices are the host machine's, and the
 * commands are refused over a socket.
 */
interface SystemNoticeState {
  notices: SystemNoticeInfoResponse[]
  load: () => Promise<void>
  receive: (event: SystemNoticeEvent) => void
  dismiss: (id: string) => Promise<void>
}

export const useSystemNoticeStore = create<SystemNoticeState>((set) => ({
  notices: [],
  load: async () => {
    if (isRemote) return
    try {
      set({ notices: await api.listSystemNotices() })
    } catch (err) {
      console.error('system notices not loaded', err)
    }
  },
  receive: (event) =>
    set(({ notices }) => {
      if (event.type === 'dismiss') return { notices: notices.filter((n) => n.id !== event.id) }
      const at = notices.findIndex((n) => n.id === event.notice.id)
      if (at < 0) return { notices: [...notices, event.notice] }
      const next = [...notices]
      next[at] = event.notice
      return { notices: next }
    }),
  dismiss: async (id) => {
    await api.dismissSystemNotice({ id })
    set(({ notices }) => ({ notices: notices.filter((n) => n.id !== id) }))
  },
}))
