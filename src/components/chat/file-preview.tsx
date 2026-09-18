import * as React from 'react'
import { ArrowRightFromSquare, Check, Copy, FileText } from '@gravity-ui/icons'
import { Button, Spinner } from '@/components/base'
import { Hint } from '@/components/ui/hint'
import { Segment } from '@/components/base'
import { Sheet } from '@/components/base'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import type { WorkspaceFileContentResponse } from '@/types'
import { usePlatform } from '@/hooks/use-platform'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useShikiLanguage } from '@/hooks/use-shiki-language'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
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
    <div
      data-slot="file-preview-lines"
      className="code-block__code min-w-max overflow-visible py-2 font-mono text-caption-1-regular leading-5"
    >
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
            className={highlighted ? 'flex bg-button-primary/10 text-text-primary' : 'flex text-text-primary/80'}
          >
            <span
              data-slot="file-preview-line-number"
              aria-hidden="true"
              className="sticky left-0 w-14 shrink-0 select-none bg-background-primary-default px-3 text-right tabular-nums text-text-secondary"
            >
              {number}
            </span>
            <span data-slot="file-preview-line-source" className="shiki min-w-0 whitespace-pre pe-6">
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
    <div data-slot="markdown-file-preview" className="h-full overflow-auto bg-background-primary-default px-6 py-4">
      {/* A README may mention more project files, but opening one from inside
          an already-open preview would silently replace the current sheet.
          Keep those references visible and inert instead. */}
      <FilePreviewContext value={null}>
        <MarkdownContent
          content={content}
          blockId={`file-preview:${path}`}
          allowRemoteImages={false}
          className="mx-auto max-w-3xl"
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
      className="h-full w-full border-0 bg-background-primary-default"
    />
  )
}

function FileGlyph({ path }: { path: string }) {
  const icon = fileIconUrl(path)
  return icon ? (
    <img data-slot="file-preview-glyph" src={icon} alt="" aria-hidden className="size-4 shrink-0" />
  ) : (
    <FileText className="size-4" />
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
  const [copied, markCopied] = useTemporaryFlag()
  const [editorError, setEditorError] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<PreviewMode>('code')
  const canOpenEditor = platform !== null && platform !== 'android' && platform !== 'ios' && !isRemote
  const name = markdownFileName(reference.path)
  const richPreview =
    state.status === 'loaded' && state.kind === 'project_file' ? richFilePreview(reference.path) : null

  React.useEffect(() => {
    setMode('code')
  }, [reference.endLine, reference.line, reference.path])

  const copyPath = React.useCallback(() => {
    void navigator.clipboard
      .writeText(reference.path)
      .then(markCopied)
      .catch(() => {})
  }, [reference, markCopied])

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
    <Sheet isOpen placement="right" onOpenChange={onOpenChange} isDismissable>
      <Sheet.Backdrop variant="blur">
        <Sheet.Content className="w-full sm:max-w-2xl">
          <Sheet.Dialog className="flex h-full min-h-0 flex-col">
            <Sheet.Header className="pe-14">
              <div data-slot="file-preview-title" className="flex min-w-0 items-center gap-2">
                <FileGlyph path={reference.path} />
                <Sheet.Heading className="truncate">{name}</Sheet.Heading>
              </div>
              <Hint
                as="p"
                className="mt-1 truncate font-mono text-caption-1-regular text-text-secondary"
                label={reference.path}
              >
                {reference.path}
                {reference.line
                  ? `:${reference.line}${reference.endLine ? `-${reference.endLine}` : ''}${reference.column ? `:${reference.column}` : ''}`
                  : ''}
              </Hint>
              {richPreview && (
                <Segment
                  aria-label={t('chat.filePreview.mode')}
                  size="sm"
                  selectedKey={mode}
                  onSelectionChange={(next) => {
                    if (next === 'code' || next === 'preview') setMode(next)
                  }}
                  className="mt-3 w-fit"
                >
                  <Segment.Item id="code">{t('chat.filePreview.code')}</Segment.Item>
                  <Segment.Item id="preview">{t('chat.filePreview.preview')}</Segment.Item>
                </Segment>
              )}
              <Sheet.CloseTrigger aria-label={t('common.close')} />
            </Sheet.Header>

            <Sheet.Body data-sheet-no-drag className="min-h-0 flex-1 overflow-hidden p-0">
              {state.status === 'loading' && (
                <div
                  data-slot="file-preview-loading"
                  role="status"
                  className="flex h-full items-center justify-center gap-2 text-body-regular text-text-secondary"
                >
                  <Spinner size="sm" />
                  {t('chat.filePreview.loading')}
                </div>
              )}
              {state.status === 'error' && (
                <div
                  data-slot="file-preview-error"
                  role="alert"
                  className="p-6 text-body-regular text-status-danger wrap-break-word"
                >
                  {t('chat.filePreview.loadError', { error: state.message })}
                </div>
              )}
              {state.status === 'loaded' && state.file.binary && (
                <div
                  data-slot="file-preview-binary"
                  className="flex h-full items-center justify-center p-6 text-center text-body-regular text-text-secondary"
                >
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
                    <div data-slot="file-preview-source" className="h-full overflow-auto bg-background-primary-default">
                      <FilePreviewLines file={state.file} reference={reference} firstLine={state.firstLine} />
                    </div>
                  )}
                </>
              )}
            </Sheet.Body>

            <Sheet.Footer className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <div
                data-slot="file-preview-metadata"
                className="min-w-0 flex-1 text-caption-1-regular text-text-secondary"
              >
                {state.status === 'loaded' && (
                  <>
                    {t('chat.filePreview.metadata', {
                      lines: state.file.total_lines,
                      size: humanBytes(state.file.size_bytes),
                    })}
                    {state.file.truncated && ` · ${t('chat.filePreview.truncated')}`}
                  </>
                )}
                {editorError && (
                  <p
                    data-slot="file-preview-editor-error"
                    role="alert"
                    className="mt-1 text-status-danger wrap-break-word"
                  >
                    {editorError === 'editor_not_configured'
                      ? t('chat.filePreview.editorNotConfigured')
                      : t('chat.filePreview.editorError', { error: editorError })}
                  </p>
                )}
              </div>
              <div data-slot="file-preview-actions" className="flex shrink-0 justify-end gap-2">
                <Button variant="secondary" onPress={copyPath}>
                  {copied ? <Check /> : <Copy />}
                  {t(copied ? 'chat.filePreview.pathCopied' : 'chat.filePreview.copyPath')}
                </Button>
                {canOpenEditor && state.status === 'loaded' && state.kind === 'project_file' && (
                  <Button variant="outline" onPress={openInEditor}>
                    <ArrowRightFromSquare />
                    {t('chat.filePreview.openInEditor')}
                  </Button>
                )}
              </div>
            </Sheet.Footer>
          </Sheet.Dialog>
        </Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
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
  const probeCache = React.useRef(new Map<string, Promise<boolean>>())

  const closePreview = React.useCallback(() => {
    setRequest(null)
    setState({ status: 'idle' })
  }, [])

  // On Android/iOS an overlay is a history level. Without this claim the
  // system back gesture skips past the preview sheet to the page underneath.
  useHistoryLevel(request !== null, closePreview)

  const openPreview = React.useCallback(
    (reference: MarkdownFileReference) => {
      setState({ status: 'loading' })
      setRequest({ conversationId, reference })
    },
    [conversationId],
  )

  const probeReference = React.useCallback(
    (path: string) => {
      const key = `${conversationId}\0${path}`
      const cached = probeCache.current.get(key)
      if (cached) return cached
      const probe = api
        .workspaceProbeRef({ conversationId, projectId: null, path })
        .then(
          () => true,
          () => false,
        )
        .finally(() => {
          // Deduplicate only concurrent probes. A later message must observe
          // files created or removed since an earlier render, and a transient
          // failure must not keep the path inert for the whole conversation.
          if (probeCache.current.get(key) === probe) probeCache.current.delete(key)
        })
      probeCache.current.set(key, probe)
      return probe
    },
    [conversationId],
  )

  React.useEffect(() => {
    probeCache.current.clear()
  }, [conversationId])

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
