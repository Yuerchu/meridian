import './file-preview.css'
import './view-switch.css'
import * as React from 'react'
import { Check, Copy, FileText, SquareArrowUpRight } from '@keyline-icons/react/two-tone'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Drawer } from '@/components/yuerchu-ui/components/drawer/drawer'
import { Hint } from '@/components/ui/hint'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import type { WorkspaceFileContentResponse } from '@/types'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { usePlatform } from '@/hooks/use-platform'
import { useReferenceProbe } from '@/hooks/use-reference-probe'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { useCopy } from '@/hooks/use-copy'
import { CopyAnnouncement } from '@/components/ui/copy-button'
import { fileIconUrl } from '@/lib/file-icon'
import { filePreviewLanguage, richFilePreview, sandboxHtmlDocument } from '@/lib/file-preview'
import { highlightInline } from '@/lib/shiki'
import { isRemote } from '@/lib/transport'
import { markdownFileName, type MarkdownFileReference } from '@/lib/markdown-target'
import { MarkdownContent } from './markdown-content'
import { FilePreviewContext } from './file-preview-context'

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'loaded'
      file: WorkspaceFileContentResponse
      firstLine: number
      kind: 'project_file' | 'project_directory'
    }
  | { status: 'error'; message: string }

type PreviewMode = 'code' | 'preview'

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function FilePreviewLines({
  file,
  reference,
  firstLine,
}: {
  file: WorkspaceFileContentResponse
  reference: MarkdownFileReference
  firstLine: number
}) {
  const targetRef = React.useRef<HTMLDivElement>(null)
  const lines = React.useMemo(() => {
    const split = file.content.split(/\r?\n/)
    if (file.content.endsWith('\n')) split.pop()
    return split
  }, [file.content])
  const { language, ready } = useShikiLanguage(filePreviewLanguage(reference.path))
  const highlightedLines = React.useMemo(
    () => (ready ? lines.map((line) => (line ? highlightInline(line, language) : '')) : null),
    [language, lines, ready],
  )
  const start = reference.line
  const end = reference.endLine ?? start

  React.useEffect(() => {
    if (!start) return
    requestAnimationFrame(() => targetRef.current?.scrollIntoView?.({ block: 'center' }))
  }, [start, file.content])

  return (
    <div data-slot="file-preview-lines" className="code-block__code m-file-preview__lines">
      {lines.map((line, index) => {
        // A source location only selects rows in the bounded whole-file
        // prefix, so numbering always starts at the resolver's first line.
        const number = firstLine + index
        const highlighted = start != null && number >= start && number <= (end ?? start)
        return (
          <div
            key={number}
            ref={number === start ? targetRef : undefined}
            data-slot="file-preview-line"
            data-preview-line={number}
            data-highlighted={highlighted || undefined}
            className="m-file-preview__line"
          >
            <span data-slot="file-preview-line-number" aria-hidden="true" className="m-file-preview__line-number">
              {number}
            </span>
            <span data-slot="file-preview-line-source" className="shiki m-file-preview__line-source">
              {highlightedLines && line ? (
                // Shiki escapes the source and returns only token spans here.
                <span
                  data-slot="file-preview-line-tokens"
                  dangerouslySetInnerHTML={{ __html: highlightedLines[index] }}
                />
              ) : (
                line || ' '
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MarkdownFilePreview({ content, path }: { content: string; path: string }) {
  return (
    <div data-slot="markdown-file-preview" className="m-file-preview__markdown">
      {/* A README may mention more project files, but opening one from inside
          an already-open preview would silently replace the current sheet.
          Keep those references visible and inert instead. */}
      <FilePreviewContext value={null}>
        <MarkdownContent
          content={content}
          blockId={`file-preview:${path}`}
          allowRemoteImages={false}
          className="m-file-preview__markdown-content"
        />
      </FilePreviewContext>
    </div>
  )
}

function HtmlFilePreview({ content, name }: { content: string; name: string }) {
  const { t } = useTranslation()
  const srcDoc = React.useMemo(() => sandboxHtmlDocument(content), [content])

  return (
    <iframe
      data-slot="html-file-preview"
      title={t('chat.filePreview.htmlFrameTitle', { name })}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className="m-file-preview__html"
    />
  )
}

function FileGlyph({ path }: { path: string }) {
  const icon = fileIconUrl(path)
  return icon ? (
    <img data-slot="file-preview-glyph" src={icon} alt="" aria-hidden className="m-file-preview__glyph" />
  ) : (
    <FileText className="m-file-preview__glyph" aria-hidden />
  )
}

function PreviewSheet({
  conversationId,
  reference,
  state,
  onOpenChange,
}: {
  conversationId: string
  reference: MarkdownFileReference
  state: PreviewState
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const platform = usePlatform()
  const { copied, failure: copyFailure, copy } = useCopy()
  const [editorError, setEditorError] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<PreviewMode>('code')
  const canOpenEditor = platform !== null && platform !== 'android' && platform !== 'ios' && !isRemote
  const name = markdownFileName(reference.path)
  const richPreview =
    state.status === 'loaded' && state.kind === 'project_file' ? richFilePreview(reference.path) : null

  // The library's Drawer does not know about the back gesture.
  useHistoryLevel(true, () => onOpenChange(false))

  React.useEffect(() => {
    setMode('code')
  }, [reference.endLine, reference.line, reference.path])

  const copyPath = React.useCallback(() => void copy(reference.path), [reference, copy])

  const openInEditor = React.useCallback(async () => {
    setEditorError(null)
    try {
      await api.openInEditor({
        conversationId,
        relPath: reference.path,
        line: reference.line ?? null,
      })
    } catch (error) {
      setEditorError(String(error))
    }
  }, [conversationId, reference])

  return (
    <Drawer
      isOpen
      side="right"
      size="lg"
      onOpenChange={onOpenChange}
      isDismissable
      heading={
        <span data-slot="file-preview-title" className="m-file-preview__title">
          <FileGlyph path={reference.path} />
          <span className="m-file-preview__name">{name}</span>
        </span>
      }
      description={
        <>
          <Hint as="p" className="m-file-preview__path" label={reference.path}>
            {reference.path}
            {reference.line
              ? `:${reference.line}${reference.endLine ? `-${reference.endLine}` : ''}${reference.column ? `:${reference.column}` : ''}`
              : ''}
          </Hint>
          {richPreview && (
            <div className="m-file-preview__mode">
              <SegmentedControl
                aria-label={t('chat.filePreview.mode')}
                size="sm"
                selectedKey={mode}
                onSelectionChange={(next) => {
                  if (next === 'code' || next === 'preview') setMode(next)
                }}
              >
                <Segment id="code">{t('chat.filePreview.code')}</Segment>
                <Segment id="preview">{t('chat.filePreview.preview')}</Segment>
              </SegmentedControl>
            </div>
          )}
        </>
      }
      footer={
        <div className="m-file-preview__footer">
          <div data-slot="file-preview-metadata" className="m-file-preview__metadata">
            {state.status === 'loaded' && (
              <>
                {t('chat.filePreview.metadata', {
                  lines: state.file.total_lines,
                  size: humanBytes(state.file.size_bytes),
                })}
                {state.file.truncated && ` · ${t('chat.filePreview.truncated')}`}
              </>
            )}
            {copyFailure !== null && (
              <p data-slot="file-preview-copy-error" role="alert" className="m-file-preview__footer-error">
                {t('common.copyFailed', { error: copyFailure })}
              </p>
            )}
            {editorError && (
              <p data-slot="file-preview-editor-error" role="alert" className="m-file-preview__footer-error">
                {editorError === 'editor_not_configured'
                  ? t('chat.filePreview.editorNotConfigured')
                  : t('chat.filePreview.editorError', { error: editorError })}
              </p>
            )}
          </div>
          <div data-slot="file-preview-actions" className="m-file-preview__actions">
            <Button variant="secondary" icon={copied ? <Check /> : <Copy />} onPress={copyPath}>
              {t(copied ? 'chat.filePreview.pathCopied' : 'chat.filePreview.copyPath')}
            </Button>
            <CopyAnnouncement copied={copied} failure={null} />
            {canOpenEditor && state.status === 'loaded' && state.kind === 'project_file' && (
              <Button icon={<SquareArrowUpRight />} variant="secondary" onPress={openInEditor}>
                {t('chat.filePreview.openInEditor')}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="m-file-preview__body">
        {state.status === 'loading' && (
          <div data-slot="file-preview-loading" role="status" className="m-file-preview__loading">
            <span aria-hidden>
              <Spinner size="sm" />
            </span>
            {t('chat.filePreview.loading')}
          </div>
        )}
        {state.status === 'error' && (
          <div data-slot="file-preview-error" role="alert" className="m-file-preview__error">
            {t('chat.filePreview.loadError', { error: state.message })}
          </div>
        )}
        {state.status === 'loaded' && state.file.binary && (
          <div data-slot="file-preview-binary" className="m-file-preview__binary">
            {t('chat.filePreview.binary')}
          </div>
        )}
        {state.status === 'loaded' && !state.file.binary && (
          <>
            {mode === 'preview' && richPreview === 'markdown' ? (
              <MarkdownFilePreview content={state.file.content} path={reference.path} />
            ) : mode === 'preview' && richPreview === 'html' ? (
              <HtmlFilePreview content={state.file.content} name={name} />
            ) : (
              <div data-slot="file-preview-source" className="m-file-preview__source">
                <FilePreviewLines file={state.file} reference={reference} firstLine={state.firstLine} />
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  )
}

/** One preview surface per transcript, shared by every Markdown block in it. */
export function FilePreviewProvider({
  conversationId,
  children,
}: {
  conversationId: string
  children: React.ReactNode
}) {
  const [request, setRequest] = React.useState<{
    conversationId: string
    reference: MarkdownFileReference
  } | null>(null)
  const [state, setState] = React.useState<PreviewState>({ status: 'idle' })
  const probeReference = useReferenceProbe(conversationId)

  const closePreview = React.useCallback(() => {
    setRequest(null)
    setState({ status: 'idle' })
  }, [])

  const openPreview = React.useCallback(
    (reference: MarkdownFileReference) => {
      setState({ status: 'loading' })
      setRequest({ conversationId, reference })
    },
    [conversationId],
  )

  React.useEffect(() => {
    if (!request) return
    let live = true
    // Every assistant-authored path goes through the reference resolver. It
    // performs the workspace-only lexical preflight before touching the OS,
    // then retains the handle-based containment check for links/junctions.
    const load = api
      // A source location chooses where the preview scrolls, not what is read.
      // The resolver still applies its 256 KiB / 2,000-line limits and marks a
      // bounded prefix as truncated.
      .workspaceResolveRef({
        conversationId: request.conversationId,
        projectId: null,
        path: request.reference.path,
        lineStart: null,
        lineEnd: null,
      })
      .then(
        (
          preview,
        ): {
          file: WorkspaceFileContentResponse
          firstLine: number
          kind: 'project_file' | 'project_directory'
        } => ({
          file: {
            content: preview.content,
            size_bytes: preview.byte_count,
            total_lines: preview.line_count,
            truncated: preview.truncated,
            binary: false,
          },
          firstLine: preview.line_start ?? 1,
          kind: preview.kind,
        }),
      )
    void load.then(
      ({ file, firstLine, kind }) => {
        if (live) setState({ status: 'loaded', file, firstLine, kind })
      },
      (error) => {
        if (live) setState({ status: 'error', message: String(error) })
      },
    )
    return () => {
      live = false
    }
  }, [request])

  React.useEffect(() => {
    if (!request || request.conversationId === conversationId) return
    setRequest(null)
    setState({ status: 'idle' })
  }, [conversationId, request])

  const value = React.useMemo(() => ({ openPreview, probeReference }), [openPreview, probeReference])
  const visibleRequest = request?.conversationId === conversationId ? request : null

  return (
    <FilePreviewContext value={value}>
      {children}
      {visibleRequest && (
        <PreviewSheet
          conversationId={conversationId}
          reference={visibleRequest.reference}
          state={state}
          onOpenChange={(open) => {
            if (!open) closePreview()
          }}
        />
      )}
    </FilePreviewContext>
  )
}
