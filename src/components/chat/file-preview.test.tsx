import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

const workspaceResolveRef = vi.hoisted(() => vi.fn())
const workspaceProbeRef = vi.hoisted(() => vi.fn())
const highlightInline = vi.hoisted(() =>
  vi.fn((text: string, language: string) => `<span data-syntax="${language}">${text}</span>`),
)

vi.mock('@/api', () => ({
  api: {
    getPlatform: vi.fn(() => Promise.resolve('windows')),
    workspaceResolveRef,
    workspaceProbeRef,
    openInEditor: vi.fn(() => Promise.resolve()),
  },
}))
vi.mock('@/hooks/use-shiki-language', () => ({
  useShikiLanguage: (label: string | undefined) => ({
    language: label === 'ts' ? 'typescript' : (label ?? 'plaintext'),
    ready: label != null,
  }),
}))
vi.mock('@/lib/shiki', () => ({
  highlightInline,
  highlight: (code: string) => `<pre><code>${code}</code></pre>`,
}))

import i18n from '@/i18n'
import type { MarkdownFileReference } from '@/lib/markdown-target'
import { FilePreviewProvider } from './file-preview'
import { useFilePreview } from './file-preview-context'

function PreviewTrigger({ reference }: { reference: MarkdownFileReference }) {
  const preview = useFilePreview()
  return <button onClick={() => preview?.openPreview(reference)}>Open preview</button>
}

function ProbeTrigger({ path }: { path: string }) {
  const preview = useFilePreview()
  const [result, setResult] = useState('idle')
  return (
    <>
      <button onClick={() => void preview?.probeReference(path).then((exists) => setResult(String(exists)))}>
        Probe reference
      </button>
      <output>{result}</output>
    </>
  )
}

function renderPreview(reference: MarkdownFileReference) {
  return render(
    <FilePreviewProvider conversationId="conversation-1">
      <PreviewTrigger reference={reference} />
    </FilePreviewProvider>,
  )
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  workspaceResolveRef.mockReset()
  workspaceProbeRef.mockReset()
  highlightInline.mockClear()
})

describe('file reference probes', () => {
  it('deduplicates only in-flight work so a path can appear after a failed probe', async () => {
    workspaceProbeRef.mockRejectedValueOnce(new Error('not created yet')).mockResolvedValueOnce({
      kind: 'project_file',
      path: 'generated/result.ts',
    })

    render(
      <FilePreviewProvider conversationId="conversation-1">
        <ProbeTrigger path="generated/result.ts" />
      </FilePreviewProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Probe reference' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('false'))

    fireEvent.click(screen.getByRole('button', { name: 'Probe reference' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('true'))
    expect(workspaceProbeRef).toHaveBeenCalledTimes(2)
  })
})

describe('file preview source', () => {
  it('loads the bounded whole file, highlights its syntax, then locates the referenced lines', async () => {
    workspaceResolveRef.mockResolvedValue({
      kind: 'project_file',
      path: 'src/example.ts',
      content: 'const one = 1\nconst two = 2\nconst three = 3',
      line_start: null,
      line_end: null,
      byte_count: 45,
      line_count: 3,
      token_count: 12,
      truncated: false,
    })
    renderPreview({ path: 'src/example.ts', line: 2, endLine: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }))
    await waitFor(() =>
      expect(workspaceResolveRef).toHaveBeenCalledWith(
        { path: 'src/example.ts' },
        { conversationId: 'conversation-1' },
      ),
    )

    await waitFor(() => expect(document.querySelector('[data-preview-line="1"]')).toBeInTheDocument())
    const first = document.querySelector('[data-preview-line="1"]')
    const second = document.querySelector('[data-preview-line="2"]')
    const third = document.querySelector('[data-preview-line="3"]')
    expect(first).toHaveTextContent('const one = 1')
    expect(first).not.toHaveAttribute('data-highlighted')
    expect(second).toHaveAttribute('data-highlighted', 'true')
    expect(third).toHaveAttribute('data-highlighted', 'true')
    expect(second?.querySelector('[data-syntax="typescript"]')).toBeInTheDocument()
    expect(highlightInline).toHaveBeenCalledTimes(3)
  })

  it('does not offer rich rendering for a directory whose name ends in .html', async () => {
    workspaceResolveRef.mockResolvedValue({
      kind: 'project_directory',
      path: 'docs.html',
      content: 'guide/\nindex.html',
      line_start: null,
      line_end: null,
      byte_count: 17,
      line_count: 2,
      token_count: 4,
      truncated: false,
    })
    renderPreview({ path: 'docs.html' })

    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }))
    await waitFor(() => expect(document.querySelector('[data-preview-line="1"]')).toBeInTheDocument())
    expect(screen.queryByText('Preview')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Preview of docs.html')).not.toBeInTheDocument()
  })
})

describe('rich file preview modes', () => {
  it('renders Markdown with the existing renderer while keeping nested files inert and remote images unloaded', async () => {
    workspaceResolveRef.mockResolvedValue({
      kind: 'project_file',
      path: 'README.md',
      content:
        '# Meridian\n\nSee [config](config.json).\n\n![Remote diagram](https://example.com/diagram.png)\n\n![sticker:tracker](https://example.com/tracker.png)\n\n![Scheme URL](https:example.com/tracker.png)',
      line_start: null,
      line_end: null,
      byte_count: 89,
      line_count: 5,
      token_count: 20,
      truncated: false,
    })
    renderPreview({ path: 'README.md' })

    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }))
    await waitFor(() => expect(document.querySelector('[data-preview-line="1"]')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Meridian' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Preview'))
    expect(await screen.findByRole('heading', { name: 'Meridian' })).toBeInTheDocument()
    const nested = screen.getByRole('button', { name: 'config.json' })
    expect(nested).toBeDisabled()
    fireEvent.click(nested)
    expect(workspaceResolveRef).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-slot="markdown-blocked-image"]')).toHaveTextContent('Remote diagram')
    expect(document.querySelectorAll('[data-slot="markdown-blocked-image"]')).toHaveLength(3)
    expect(screen.queryByRole('img', { name: 'Remote diagram' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'tracker' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Code'))
    expect(screen.queryByRole('heading', { name: 'Meridian' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-preview-line="1"]')).toHaveTextContent('# Meridian')
  })

  it('renders HTML only in an opaque iframe with no sandbox capabilities', async () => {
    workspaceResolveRef.mockResolvedValue({
      kind: 'project_file',
      path: 'index.html',
      content: '<h1>Demo</h1><script>top.location = "https://example.com"</script>',
      line_start: null,
      line_end: null,
      byte_count: 67,
      line_count: 1,
      token_count: 15,
      truncated: false,
    })
    renderPreview({ path: 'index.html' })

    fireEvent.click(screen.getByRole('button', { name: 'Open preview' }))
    await waitFor(() => expect(document.querySelector('[data-preview-line="1"]')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Preview'))

    const frame = await screen.findByTitle('Preview of index.html')
    expect(frame).toHaveAttribute('sandbox', '')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame).not.toHaveAttribute('allow')
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(frame.getAttribute('srcdoc')).not.toContain('<script')
  })
})
