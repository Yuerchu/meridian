import { describe, expect, it } from 'vitest'

import { planReviewActionRules } from './plan-review-draft'
import {
  planCommentRequests,
  planDraftPayload,
  planSubmittedReviewPatch,
  projectPlanReviewDraft,
} from './plan-review-projection'
import type { PlanCommentInfoResponse, PlanReviewInfoResponse } from '@/types'

const RAW_PLAN = '# Plan   \n\nBody\n'
const NORMALIZED_PLAN = '# Plan\n\nBody\n'

function review(
  overrides: {
    mode?: 'rich' | 'source'
    generation?: number
    sourceText?: string | null
    baseMarkdown?: string
    draftMarkdown?: string
    schemaVersion?: number | null
    schemaHash?: string | null
    comments?: PlanCommentInfoResponse[]
  } = {},
): PlanReviewInfoResponse {
  const mode = overrides.mode ?? 'source'
  return {
    document: {
      id: 'document-1',
      conversation_id: 'conversation-1',
      state: 'reviewing',
      head_revision_id: 'revision-1',
      approved_revision_id: null,
      working_generation: 0,
      file_rel_path: '.meridian/plans/plan.md',
      file_sync_state: 'applied',
      created_at: 1,
      updated_at: 1,
    },
    review: {
      id: 'review-1',
      document_id: 'document-1',
      submitted_revision_id: 'revision-1',
      state: 'pending',
      decision_id: null,
      suggestion_revision_id: null,
      assistant_message_id: 'message-1',
      provider_call_id: 'call-1',
      turn_id: 'turn-1',
      lock_version: 0,
      created_at: 1,
      updated_at: 1,
    },
    submitted_revision: {
      id: 'revision-1',
      document_id: 'document-1',
      revision_no: 1,
      parent_revision_id: null,
      author_kind: 'assistant',
      content_markdown: RAW_PLAN,
      content_sha256: 'revision-hash',
      patch: null,
      responding_to_suggestion_revision_id: null,
      assistant_message_id: 'message-1',
      provider_call_id: 'call-1',
      editor_json: null,
      created_at: 1,
    },
    parent_revision: null,
    draft: {
      review_id: 'review-1',
      base_revision_id: 'revision-1',
      generation: overrides.generation ?? 0,
      mode,
      base_editor_json: mode === 'rich' ? { type: 'doc', content: [] } : null,
      draft_editor_json: mode === 'rich' ? { type: 'doc', content: [] } : null,
      source_text: overrides.sourceText ?? (mode === 'source' ? RAW_PLAN : null),
      base_normalized_markdown: overrides.baseMarkdown ?? (mode === 'rich' ? NORMALIZED_PLAN : RAW_PLAN),
      draft_normalized_markdown: overrides.draftMarkdown ?? (mode === 'rich' ? NORMALIZED_PLAN : RAW_PLAN),
      draft_sha256: 'draft-hash',
      global_note: null,
      selection: null,
      editor_schema_version: overrides.schemaVersion ?? null,
      editor_schema_hash: overrides.schemaHash ?? null,
      created_at: 1,
      updated_at: 1,
    },
    comments: overrides.comments ?? [],
    delivery: null,
  }
}

describe('plan review editor projection', () => {
  it('projects only an untouched generation-zero source draft into rich mode and freezes the normalized baseline', () => {
    const projected = projectPlanReviewDraft(review())
    expect(projected.mode).toBe('rich')
    expect(projected.baseMarkdown).toBe(NORMALIZED_PLAN)
    expect(projected.markdown).toBe(NORMALIZED_PLAN)
    expect(planDraftPayload(projected).baseNormalizedMarkdown).toBe(NORMALIZED_PLAN)
    expect(
      planReviewActionRules({
        status: 'pending',
        baseMarkdown: projected.baseMarkdown,
        draftMarkdown: projected.markdown,
        comments: [],
        globalNote: null,
        saveState: 'saved',
        isHistorical: false,
      }).canApprove,
    ).toBe(true)
  })

  it('does not auto-promote a persisted source draft or lose its UTF-16 source anchor', () => {
    const anchor = {
      kind: 'source_range' as const,
      from: 2,
      to: 6,
      quote: 'Plan',
      prefix: '# ',
      suffix: '   ',
    }
    const comment: PlanCommentInfoResponse = {
      id: 'comment-1',
      review_id: 'review-1',
      position: 0,
      state: 'active',
      anchor,
      body: 'Keep this',
      created_at: 1,
      updated_at: 1,
    }
    const projected = projectPlanReviewDraft(review({ generation: 1, comments: [comment] }))
    expect(projected.mode).toBe('source')
    expect(projected.sourceText).toBe(RAW_PLAN)
    expect(projected.comments[0].anchor).toEqual(anchor)
    expect(planDraftPayload(projected)).toMatchObject({
      mode: 'source',
      baseEditorJson: null,
      baseNormalizedMarkdown: RAW_PLAN,
      editorSchemaVersion: null,
    })
  })

  it('downgrades an unchanged stale rich schema to the exact submitted source as a pristine transition', () => {
    const projected = projectPlanReviewDraft(
      review({ mode: 'rich', generation: 2, schemaVersion: 99, schemaHash: 'old-schema' }),
    )
    expect(projected).toMatchObject({ mode: 'source', baseMarkdown: RAW_PLAN, sourceText: RAW_PLAN })
    expect(planDraftPayload(projected)).toMatchObject({
      baseEditorJson: null,
      baseNormalizedMarkdown: RAW_PLAN,
      sourceText: RAW_PLAN,
    })
  })

  it('keeps a stale rich draft body edit as a dirty source suggestion during the transition', () => {
    const projected = projectPlanReviewDraft(
      review({
        mode: 'rich',
        generation: 2,
        schemaVersion: 99,
        schemaHash: 'old-schema',
        draftMarkdown: '# Edited\n',
      }),
    )
    expect(projected).toMatchObject({ mode: 'source', baseMarkdown: RAW_PLAN, sourceText: '# Edited\n' })
    expect(projected.markdown).not.toBe(projected.baseMarkdown)
  })

  it('orphans rich anchors explicitly when a stale editor schema falls back to source', () => {
    const anchor = {
      kind: 'prosemirror_range' as const,
      from: 1,
      to: 5,
      quote: 'Plan',
      prefix: '',
      suffix: '',
    }
    const info = review({
      mode: 'rich',
      generation: 2,
      schemaVersion: 99,
      schemaHash: 'old-schema',
      comments: [
        {
          id: 'comment-rich',
          review_id: 'review-1',
          position: 0,
          state: 'active',
          anchor,
          body: 'Keep this wording',
          created_at: 1,
          updated_at: 1,
        },
      ],
    })
    info.draft.selection = anchor

    const projected = projectPlanReviewDraft(info)
    expect(projected).toMatchObject({ mode: 'source', selection: null })
    expect(projected.comments[0]).toMatchObject({ state: 'orphaned', anchor })
    expect(planDraftPayload(projected).comments[0]).toMatchObject({ state: 'orphaned', anchor })
  })

  it('builds Changes from the previous reviewed revision and ignores the final per-update patch', () => {
    const info = review()
    info.parent_revision = {
      ...info.submitted_revision,
      id: 'revision-reviewed-before',
      revision_no: 1,
      content_markdown: '# Plan\n\nFirst reviewed body\n',
      patch: null,
    }
    info.submitted_revision = {
      ...info.submitted_revision,
      id: 'revision-current',
      revision_no: 4,
      content_markdown: '# Plan\n\nFirst update\n\nSecond update\n',
      // This last delta omits the first update and must never drive the tab.
      patch: '@@ -3 +3 @@\n-First update\n+Second update\n',
    }

    const patch = planSubmittedReviewPatch(info)
    expect(patch).toContain('-First reviewed body')
    expect(patch).toContain('+First update')
    expect(patch).toContain('+Second update')
  })

  it('shows the submitted patch for the first review when no earlier reviewed revision exists', () => {
    const info = review()
    info.submitted_revision.patch = '*** Begin Patch\n*** Add File: plan.md\n+# Plan\n*** End Patch'

    expect(planSubmittedReviewPatch(info)).toBe(info.submitted_revision.patch)
  })
})

describe('planCommentRequests', () => {
  const anchor = { kind: 'source_range' as const, from: 2, to: 6, quote: 'Plan', prefix: '# ', suffix: '\n' }
  const comment = (id: string, body: string, state: PlanCommentInfoResponse['state'] = 'active') => ({
    id,
    review_id: 'review-1',
    position: 0,
    state,
    anchor,
    body,
    created_at: 1,
    updated_at: 1,
  })

  it('keeps a freshly added comment out of the wire and the rules until something is typed', () => {
    const blank = [comment('c1', ''), comment('c2', '   ')]
    expect(planCommentRequests(blank)).toEqual([])
    const rules = planReviewActionRules({
      status: 'pending',
      baseMarkdown: '# Plan\n',
      draftMarkdown: '# Plan\n',
      comments: planCommentRequests(blank),
      globalNote: null,
      saveState: 'saved',
      isHistorical: false,
    })
    expect(rules).toMatchObject({ isPristine: true, canApprove: true, canRequestChanges: false })
  })

  it('still carries typed comments and deletions of a comment the server may hold', () => {
    const requests = planCommentRequests([comment('c1', 'Rename'), comment('c2', '', 'deleted')])
    expect(requests.map((request) => request.id)).toEqual(['c1', 'c2'])
  })
})
