import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import { ChatToolPresentationProvider } from '@/components/ui/chat-tool'
import { TranscriptConversationProvider } from '@/hooks/use-transcript-conversation'
import i18n from '@/i18n'
import { useConversationStore } from '@/stores/conversation-store'
import type { ToolCallDisplay, ToolMediaResponse } from '@/types'
import { MediaResult } from './media-result'
import { ToolCallBlock } from './tool-call-block'

const capability = vi.hoisted(() => ({ can: { exportToDisk: true } }))
const dialog = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/lib/capabilities', () => capability)
vi.mock('@tauri-apps/plugin-dialog', () => dialog)
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(() => Promise.resolve()) }))
vi.mock('@/api', () => ({
  api: {
    exportMediaFile: vi.fn(),
    workspaceResolveRef: vi.fn(),
    conversationSnapshot: vi.fn(),
  },
}))

const image: ToolMediaResponse = {
  kind: 'image',
  url: 'file:///C:/data/files/c1/drawn.png',
  mime_type: 'image/png',
  name: 'drawn.png',
}
const video: ToolMediaResponse = {
  kind: 'video',
  url: 'file:///C:/data/files/c1/clip.mp4',
  mime_type: 'video/mp4',
  name: null,
}

function draw(media: ToolMediaResponse[]) {
  return render(
    <TranscriptConversationProvider value="c1">
      <MediaResult media={media} />
    </TranscriptConversationProvider>,
  )
}

describe('MediaResult', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    capability.can.exportToDisk = true
  })

  it('draws a picture through the asset protocol', () => {
    const { container } = draw([image])
    const img = container.querySelector('img[data-slot="media-image"]')
    expect(img).toHaveAttribute('src', 'asset://C:/data/files/c1/drawn.png')
    expect(img).toHaveAttribute('alt', 'drawn.png')
  })

  it('draws a video with the WebView controls, named for its kind when the tool gave no name', () => {
    const { container } = draw([image, video])
    const element = container.querySelector('video')
    expect(element).not.toBeNull()
    expect(element).toHaveAttribute('src', 'asset://C:/data/files/c1/clip.mp4')
    expect(element).toHaveAttribute('controls')
    expect(element).toHaveAttribute('preload', 'metadata')
    expect(element).toHaveAttribute('aria-label', i18n.t('chat.media.untitled.video'))
  })

  it('saves the opened picture through export_media_file', async () => {
    const user = userEvent.setup()
    dialog.save.mockResolvedValue('D:/out/drawn.png')
    vi.mocked(api.exportMediaFile).mockResolvedValue(undefined)
    draw([image])

    await user.click(screen.getByRole('button', { name: i18n.t('chat.media.open', { name: 'drawn.png' }) }))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: i18n.t('chat.media.save') }))

    expect(dialog.save).toHaveBeenCalledWith({ defaultPath: 'drawn.png' })
    expect(api.exportMediaFile).toHaveBeenCalledWith({
      conversationId: 'c1',
      uri: image.url,
      outputPath: 'D:/out/drawn.png',
    })
  })

  it('offers no save when the file is on another machine', async () => {
    capability.can.exportToDisk = false
    const user = userEvent.setup()
    draw([image])

    await user.click(screen.getByRole('button', { name: i18n.t('chat.media.open', { name: 'drawn.png' }) }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).queryByRole('button', { name: i18n.t('chat.media.save') })).toBeNull()
    expect(within(sheet).getByText(i18n.t('capability.exportToDisk'))).toBeInTheDocument()
  })
})

describe('tool card with media', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    useConversationStore.setState({ sessions: {}, activeId: 'conv' })
    useConversationStore.getState().ensureSession('conv')
  })

  // An MCP tool: no catalog entry, the generic renderer, and still the picture.
  it('shows a finished call’s media without being opened', () => {
    const data: ToolCallDisplay = {
      call_id: 'call-mcp',
      tool_name: 'mcp__painter__draw',
      arguments: '{"prompt":"a fox"}',
      status: 'completed',
      result: 'Here is the fox you asked for, drawn in watercolour on a white background.',
      media: [image],
    }
    const { container } = render(
      <ChatToolPresentationProvider value="bubble">
        <ToolCallBlock data={data} />
      </ChatToolPresentationProvider>,
    )
    const img = container.querySelector('[data-slot="tool-media"] img[data-slot="media-image"]')
    expect(img).toHaveAttribute('src', 'asset://C:/data/files/c1/drawn.png')
    expect(img).toBeVisible()
  })
})
