import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const shellOpen = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const workspaceReadFile = vi.hoisted(() => vi.fn())
const workspaceResolveRef = vi.hoisted(() => vi.fn())
const workspaceProbeRef = vi.hoisted(() => vi.fn())
const openInEditor = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('@tauri-apps/plugin-shell', () => ({ open: shellOpen }))
vi.mock('@/api', () => ({
  api: {
    getPlatform: vi.fn(() => Promise.resolve('windows')),
    workspaceReadFile,
    workspaceResolveRef,
    workspaceProbeRef,
    openInEditor,
  },
}))

import { MarkdownContent } from './markdown-content'
import { FilePreviewProvider } from './file-preview'

beforeEach(() => {
  workspaceProbeRef.mockResolvedValue({ kind: 'project_file', path: 'resolved' })
})

afterEach(() => {
  shellOpen.mockClear()
  workspaceReadFile.mockReset()
  workspaceResolveRef.mockReset()
  workspaceProbeRef.mockReset()
  openInEditor.mockClear()
})

describe('MarkdownContent images', () => {
  it('reserves a stable frame and lazy-loads remote content', async () => {
    const { container } = render(<MarkdownContent content="![Architecture diagram](https://example.com/image.png)" />)

    const image = await screen.findByRole('img', { name: 'Architecture diagram' })
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(image).not.toHaveAttribute('width')
    expect(image).not.toHaveAttribute('height')
    expect(image.className).toContain('h-auto')
    expect(image.className).toContain('max-w-full')

    const frame = container.querySelector('[data-slot="markdown-image-frame"]')!
    expect(frame.className).not.toContain('aspect-video')
    expect(Array.from(frame.classList)).not.toContain('w-full')
    expect(frame).toContainElement(image)
    fireEvent.load(image)
    expect(frame).toHaveAttribute('data-loaded', 'true')
  })
})

describe('MarkdownContent links', () => {
  it.each([
    ['https://example.com/docs', 'https://example.com/docs'],
    ['www.example.com/docs', 'https://www.example.com/docs'],
    ['//example.com/docs', 'https://example.com/docs'],
  ])('consumes navigation and opens %s externally', async (href, expected) => {
    render(<MarkdownContent content={`[Documentation](${href})`} />)
    const link = await screen.findByRole('link', { name: 'Documentation' })
    expect(link).toHaveAttribute('href', '#meridian-external')
    expect(link).toHaveAttribute('data-external-href', expected)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(link.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(shellOpen).toHaveBeenCalledWith(expected))
  })

  it('also consumes middle-click without WebView navigation', async () => {
    render(<MarkdownContent content="[Documentation](https://example.com/docs)" />)
    const link = await screen.findByRole('link', { name: 'Documentation' })
    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    expect(link.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(shellOpen).toHaveBeenCalledWith('https://example.com/docs'))
  })

  it('consumes fragment links instead of changing the WebView location', async () => {
    render(<MarkdownContent content={'# Local heading\n\n[Jump](#local-heading)'} />)
    const heading = await screen.findByRole('heading', { name: 'Local heading' })
    const scrollIntoView = vi.fn()
    heading.scrollIntoView = scrollIntoView
    const link = await screen.findByRole('link', { name: 'Jump' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(link.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(shellOpen).not.toHaveBeenCalled()
    expect(heading).toHaveAttribute('id', 'local-heading')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('renders dangerous schemes as inert text', async () => {
    render(<MarkdownContent content="[Do not open](javascript:alert(1))" />)
    expect(await screen.findByText('Do not open')).toHaveAttribute('data-slot', 'markdown-unsupported-link')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('MarkdownContent file references', () => {
  it('keeps ambiguous prose inert and promotes only existing workspace candidates', async () => {
    let resolveExisting!: (value: { kind: 'project_file'; path: string }) => void
    const existing = new Promise<{ kind: 'project_file'; path: string }>((resolve) => {
      resolveExisting = resolve
    })
    workspaceProbeRef.mockImplementation((request: { path: string }) => {
      if (request.path === 'fastapi/__init__.md') return existing
      return Promise.reject(new Error('path does not exist'))
    })

    render(
      <FilePreviewProvider conversationId="conversation-1">
        <MarkdownContent content="条件1/条件2/条件3； fastapi/__init__.md； 再次 fastapi/__init__.md。" />
      </FilePreviewProvider>,
    )

    expect(screen.queryByRole('link', { name: 'fastapi/__init__.md' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '条件1/条件2/条件3' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(workspaceProbeRef).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        projectId: null,
        path: 'fastapi/__init__.md',
      }),
    )

    await act(async () => {
      resolveExisting({ kind: 'project_file', path: 'fastapi/__init__.md' })
      await existing
    })

    expect(await screen.findAllByRole('link', { name: 'fastapi/__init__.md' })).toHaveLength(2)
    expect(screen.queryByRole('link', { name: '条件1/条件2/条件3' })).not.toBeInTheDocument()
    expect(workspaceResolveRef).not.toHaveBeenCalled()
    expect(workspaceProbeRef.mock.calls.filter(([request]) => request.path === 'fastapi/__init__.md')).toHaveLength(1)
    expect(workspaceProbeRef.mock.calls.filter(([request]) => request.path === '条件1/条件2/条件3')).toHaveLength(1)
  })

  it('preserves inline-code styling when a path-shaped candidate does not exist', async () => {
    workspaceProbeRef.mockRejectedValue(new Error('path does not exist'))

    render(
      <FilePreviewProvider conversationId="conversation-1">
        <MarkdownContent content="Use `条件1/条件2/条件3` here." />
      </FilePreviewProvider>,
    )

    const fallback = screen.getByText('条件1/条件2/条件3')
    expect(fallback.tagName).toBe('CODE')
    await waitFor(() => expect(workspaceProbeRef).toHaveBeenCalledTimes(1))
    expect(screen.getByText('条件1/条件2/条件3').tagName).toBe('CODE')
    expect(screen.queryByRole('link', { name: '条件1/条件2/条件3' })).not.toBeInTheDocument()
    expect(workspaceResolveRef).not.toHaveBeenCalled()
  })

  it('renders text, inline-code and explicit paths as icon buttons and previews the selected file', async () => {
    workspaceResolveRef.mockResolvedValue({
      kind: 'project_file',
      path: 'src/chat.ts',
      content: 'one\ntwo\nthree\nfour',
      line_start: null,
      line_end: null,
      byte_count: 18,
      line_count: 4,
      token_count: 4,
      truncated: false,
    })

    render(
      <FilePreviewProvider conversationId="conversation-1">
        <MarkdownContent content={'See src/chat.ts#L2-L3, `README.md`, and [config](./config.json:1).'} />
      </FilePreviewProvider>,
    )

    const source = await screen.findByRole('link', { name: 'src/chat.ts:2-3' })
    expect(source).toHaveTextContent('chat.ts')
    expect(source.querySelector('img')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'README.md' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: './config.json:1' })).toBeInTheDocument()

    fireEvent.click(source)
    await waitFor(() =>
      expect(workspaceResolveRef).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        projectId: null,
        path: 'src/chat.ts',
        lineStart: null,
        lineEnd: null,
      }),
    )
    expect(workspaceReadFile).not.toHaveBeenCalled()
    expect(await screen.findByText('one')).toBeInTheDocument()
    expect(await screen.findByText('two')).toBeInTheDocument()
    expect(document.querySelector('[data-preview-line="1"]')).not.toHaveAttribute('data-highlighted')
    expect(document.querySelector('[data-preview-line="2"]')).toHaveAttribute('data-highlighted', 'true')
    expect(document.querySelector('[data-preview-line="3"]')).toHaveAttribute('data-highlighted', 'true')
  })

  it('does not auto-link unfinished streaming text or fenced code', async () => {
    const { container } = render(
      <FilePreviewProvider conversationId="conversation-1">
        <MarkdownContent isStreaming content={'Writing src/partial.ts\n\n```text\nsrc/fenced.ts\n```'} />
      </FilePreviewProvider>,
    )
    expect(container.querySelector('[data-slot="markdown-file-reference"]')).not.toBeInTheDocument()
    expect(workspaceProbeRef).not.toHaveBeenCalled()
  })

  it('routes a path without a line range through the contained reference resolver', async () => {
    workspaceResolveRef.mockResolvedValue({
      kind: 'project_file',
      path: 'README.md',
      content: '# Meridian',
      line_start: null,
      line_end: null,
      byte_count: 10,
      line_count: 1,
      token_count: 2,
      truncated: false,
    })

    render(
      <FilePreviewProvider conversationId="conversation-1">
        <MarkdownContent content="Open README.md." />
      </FilePreviewProvider>,
    )

    fireEvent.click(await screen.findByRole('link', { name: 'README.md' }))
    await waitFor(() =>
      expect(workspaceResolveRef).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        projectId: null,
        path: 'README.md',
        lineStart: null,
        lineEnd: null,
      }),
    )
    expect(workspaceReadFile).not.toHaveBeenCalled()
    expect(await screen.findByText('# Meridian')).toBeInTheDocument()
  })

  it('does not offer an editor launch for a path the workspace resolver refused', async () => {
    workspaceResolveRef.mockRejectedValue(new Error('outside workspace'))

    render(
      <FilePreviewProvider conversationId="conversation-1">
        <MarkdownContent content={'Open `C:\\outside\\secret.txt`.'} />
      </FilePreviewProvider>,
    )

    fireEvent.click(await screen.findByRole('link', { name: 'C:\\outside\\secret.txt' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /openInEditor|Open in editor/ })).not.toBeInTheDocument()
    expect(openInEditor).not.toHaveBeenCalled()
  })
})

describe('MarkdownContent trailer', () => {
  const trailer = <time data-testid="sent-at">14:20</time>

  /// The float has to be inside the paragraph's own box: placed after the
  /// block it could only ever land on the line below it.
  it('floats the trailer into the last paragraph', () => {
    render(<MarkdownContent content={'First.\n\nLast line here.'} trailer={trailer} />)
    const time = screen.getByTestId('sent-at')
    const paragraph = time.closest('p')!
    expect(paragraph).toHaveTextContent('Last line here.')
    expect(paragraph).not.toHaveTextContent('First.')
  })

  it('puts the trailer on a line of its own under a code block', () => {
    const { container } = render(<MarkdownContent content={'Intro\n\n```js\nconst x = 1\n```'} trailer={trailer} />)
    const time = screen.getByTestId('sent-at')
    expect(time.closest('p')).toBeNull()
    expect(time.closest('pre')).toBeNull()
    expect(container.querySelector('[data-slot="markdown-trailer"]')).toContainElement(time)
  })

  it('drops the trailer while the text is still streaming', () => {
    render(<MarkdownContent content="Half a sen" isStreaming trailer={trailer} />)
    expect(screen.queryByTestId('sent-at')).toBeNull()
  })
})
