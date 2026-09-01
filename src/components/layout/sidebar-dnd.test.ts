import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { acceptsConversationDrop, CONVERSATION_DRAG_TYPE, conversationIdOf } from './sidebar-dnd'

/**
 * The RAC wiring around these is declarative config jsdom cannot drag
 * anything across; the decisions — which rows carry a conversation, which
 * drags a group header may take — live here where a test can hold them.
 */
describe('sidebar drag and drop', () => {
  it('reads a conversation off its row key, under either prefix', () => {
    expect(conversationIdOf('d-conv-abc-123')).toBe('abc-123')
    expect(conversationIdOf('m-conv-abc-123')).toBe('abc-123')
  })

  it('gives no payload to rows that are not conversations', () => {
    expect(conversationIdOf('d-new')).toBeNull()
    expect(conversationIdOf('d-search')).toBeNull()
    expect(conversationIdOf('d-new-project')).toBeNull()
  })

  it('lets a group header take only conversation drags', () => {
    expect(acceptsConversationDrop(new Set([CONVERSATION_DRAG_TYPE]))).toBe(true)
    // A text drag from anywhere — the composer, another window — is not an
    // offer to refile a conversation.
    expect(acceptsConversationDrop(new Set(['text/plain']))).toBe(false)
    expect(acceptsConversationDrop(new Set())).toBe(false)
  })

  /**
   * React Aria's pointer drag is the HTML5 drag-and-drop API, and Tauri's
   * `dragDropEnabled` takes the WebView's drop target for itself — with it on,
   * every in-page drag shows a refusal cursor wherever it goes and no drop
   * ever lands (measured on Windows/WebView2; the schema's own note says the
   * same). It defaults to *on*, so the flag has to be present and false, and
   * anyone tempted to restore native file drops has to come read this: files
   * arrive through `use-file-drop`'s DOM listeners now.
   */
  it('keeps the native drag-drop handler off, or no in-page drag can land', () => {
    const conf = JSON.parse(readFileSync(resolve(__dirname, '../../../src-tauri/tauri.conf.json'), 'utf8')) as {
      app: { windows: { label: string; dragDropEnabled?: boolean }[] }
    }
    const main = conf.app.windows.find((w) => w.label === 'main')
    expect(main?.dragDropEnabled).toBe(false)
  })
})
