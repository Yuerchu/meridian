import type { JSONContent } from '@tiptap/core'

import {
  PLAN_EDITOR_SCHEMA_HASH,
  PLAN_EDITOR_SCHEMA_VERSION,
  parsePlanMarkdown,
  planEditorDocument,
  planSuggestionPatch,
  type PlanMarkdownFallbackReason,
} from './plan-markdown'
import type { PlanDraftPayload } from './plan-review-draft'
import type {
  JsonValue,
  PlanCommentAnchor,
  PlanCommentDraftRequest,
  PlanCommentInfoResponse,
  PlanReviewInfoResponse,
} from '@/types'

export interface ProjectedPlanDraft {
  mode: 'rich' | 'source'
  baseDocument: JSONContent | null
  baseMarkdown: string
  document: JSONContent | null
  sourceText: string
  markdown: string
  comments: PlanCommentInfoResponse[]
  globalNote: string
  selection: PlanCommentAnchor | null
  fallbackReason: PlanMarkdownFallbackReason | null
  editorSchemaFallback: {
    fromVersion: number
    fromHash: string | null
  } | null
}

function jsonValue(value: JSONContent): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function planCommentRequests(comments: PlanCommentInfoResponse[]): PlanCommentDraftRequest[] {
  return comments.map(({ id, state, anchor, body }) => ({ id, state, anchor, body }))
}

/** Full assistant change across review sessions; per-revision patches are only deltas. */
export function planSubmittedReviewPatch(info: PlanReviewInfoResponse): string {
  return info.parent_revision
    ? planSuggestionPatch(info.parent_revision.content_markdown, info.submitted_revision.content_markdown)
    : (info.submitted_revision.patch ?? '')
}

export function planDraftPayload(draft: ProjectedPlanDraft): PlanDraftPayload {
  return {
    mode: draft.mode,
    baseEditorJson: draft.mode === 'rich' && draft.baseDocument ? jsonValue(draft.baseDocument) : null,
    baseNormalizedMarkdown: draft.baseMarkdown,
    editorJson: draft.mode === 'rich' && draft.document ? jsonValue(draft.document) : null,
    sourceText: draft.mode === 'source' ? draft.sourceText : null,
    normalizedMarkdown: draft.markdown,
    comments: planCommentRequests(draft.comments),
    globalNote: draft.globalNote.trim() ? draft.globalNote : null,
    selection: draft.selection,
    editorSchemaVersion: draft.mode === 'rich' ? PLAN_EDITOR_SCHEMA_VERSION : null,
    editorSchemaHash: draft.mode === 'rich' ? PLAN_EDITOR_SCHEMA_HASH : null,
    editorSchemaFallback: draft.editorSchemaFallback,
  }
}

function sourceProjection(
  info: PlanReviewInfoResponse,
  sourceText: string,
  baseMarkdown: string,
  reason: PlanMarkdownFallbackReason | null,
  orphanRichAnchors = false,
): ProjectedPlanDraft {
  const comments = orphanRichAnchors
    ? info.comments.map((comment) =>
        comment.anchor.kind === 'prosemirror_range' && comment.state !== 'deleted'
          ? { ...comment, state: 'orphaned' as const }
          : comment,
      )
    : info.comments
  const selection =
    orphanRichAnchors && info.draft.selection?.kind === 'prosemirror_range' ? null : info.draft.selection
  return {
    mode: 'source',
    baseDocument: null,
    baseMarkdown,
    document: null,
    sourceText,
    markdown: sourceText,
    comments,
    globalNote: info.draft.global_note ?? '',
    selection,
    fallbackReason: reason,
    editorSchemaFallback: null,
  }
}

/** Project the persisted wire draft into exactly one lossless editor mode. */
export function projectPlanReviewDraft(info: PlanReviewInfoResponse): ProjectedPlanDraft {
  const stored = info.draft
  const schemaMismatch =
    stored.mode === 'rich' &&
    stored.editor_schema_version !== null &&
    (stored.editor_schema_version !== PLAN_EDITOR_SCHEMA_VERSION ||
      stored.editor_schema_hash !== PLAN_EDITOR_SCHEMA_HASH)

  if (schemaMismatch && stored.editor_schema_version !== null) {
    // This is the one supported rich→source baseline transition. Returning to
    // the submitted raw bytes makes an unchanged old rich projection pristine;
    // an actually edited old draft remains a visible source suggestion.
    const rawBase = info.submitted_revision.content_markdown
    const bodyChanged = stored.draft_normalized_markdown !== stored.base_normalized_markdown
    const projection = sourceProjection(
      info,
      bodyChanged ? stored.draft_normalized_markdown : rawBase,
      rawBase,
      'editor_schema',
      true,
    )
    projection.editorSchemaFallback = {
      fromVersion: stored.editor_schema_version,
      fromHash: stored.editor_schema_hash,
    }
    return projection
  }

  if (stored.mode === 'source') {
    const sourceText = stored.source_text ?? stored.draft_normalized_markdown
    const untouched =
      stored.generation === 0 && info.comments.length === 0 && !stored.global_note && stored.selection === null
    if (!untouched) {
      const parsed = parsePlanMarkdown(sourceText)
      return sourceProjection(
        info,
        sourceText,
        stored.base_normalized_markdown,
        parsed.mode === 'source' ? parsed.reason : 'saved_source',
      )
    }
  }

  const storedDocument = planEditorDocument(stored.draft_editor_json)
  if (stored.mode === 'rich' && storedDocument) {
    const parsedBase = parsePlanMarkdown(stored.base_normalized_markdown)
    const baseDocument =
      planEditorDocument(stored.base_editor_json) ?? (parsedBase.mode === 'rich' ? parsedBase.document : null)
    const baseMarkdown = parsedBase.mode === 'rich' ? parsedBase.normalizedMarkdown : stored.base_normalized_markdown
    if (!baseDocument) {
      return sourceProjection(info, stored.draft_normalized_markdown, baseMarkdown, 'malformed', true)
    }
    return {
      mode: 'rich',
      baseDocument,
      baseMarkdown,
      document: storedDocument,
      sourceText: '',
      markdown: stored.draft_normalized_markdown,
      comments: info.comments,
      globalNote: stored.global_note ?? '',
      selection: stored.selection,
      fallbackReason: null,
      editorSchemaFallback: null,
    }
  }

  const draftSource =
    stored.mode === 'source'
      ? (stored.source_text ?? stored.draft_normalized_markdown)
      : stored.draft_normalized_markdown
  const draftParsed = parsePlanMarkdown(draftSource)
  const baseParsed = parsePlanMarkdown(stored.base_normalized_markdown)
  if (draftParsed.mode === 'rich' && baseParsed.mode === 'rich') {
    return {
      mode: 'rich',
      baseDocument: baseParsed.document,
      baseMarkdown: baseParsed.normalizedMarkdown,
      document: draftParsed.document,
      sourceText: '',
      markdown: draftParsed.normalizedMarkdown,
      comments: info.comments,
      globalNote: stored.global_note ?? '',
      selection: stored.selection,
      fallbackReason: null,
      editorSchemaFallback: null,
    }
  }

  return sourceProjection(
    info,
    draftSource,
    stored.base_normalized_markdown,
    draftParsed.mode === 'source' ? draftParsed.reason : baseParsed.mode === 'source' ? baseParsed.reason : 'malformed',
    stored.mode === 'rich',
  )
}
