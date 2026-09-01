import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { PlanCommentAnchor, PlanCommentInfoResponse, PlanProseMirrorRange, PlanSourceRange } from '@/types'

export const planCommentDecorationKey = new PluginKey<DecorationSet>('meridian-plan-comments')

type CommentLike = Pick<PlanCommentInfoResponse, 'id' | 'state' | 'anchor'>

function visible(comment: CommentLike): comment is CommentLike & { anchor: PlanProseMirrorRange } {
  return (
    comment.state !== 'deleted' &&
    comment.state !== 'orphaned' &&
    comment.anchor.kind === 'prosemirror_range' &&
    comment.anchor.from < comment.anchor.to
  )
}

function decorations(document: ProseMirrorNode, comments: readonly CommentLike[]): DecorationSet {
  const ranges = comments.flatMap((comment) => {
    if (!visible(comment) || comment.anchor.from < 0 || comment.anchor.to > document.content.size) return []
    return [
      Decoration.inline(
        comment.anchor.from,
        comment.anchor.to,
        {
          class: 'plan-comment-highlight',
          'data-plan-comment-id': comment.id,
        },
        { planCommentId: comment.id },
      ),
    ]
  })
  return DecorationSet.create(document, ranges)
}

export const PlanCommentDecorations = Extension.create({
  name: 'meridianPlanCommentDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: planCommentDecorationKey,
        state: {
          init: (_, state) => DecorationSet.create(state.doc, []),
          apply: (transaction, current) => {
            const next = transaction.getMeta(planCommentDecorationKey) as readonly CommentLike[] | undefined
            return next ? decorations(transaction.doc, next) : current.map(transaction.mapping, transaction.doc)
          },
        },
        props: {
          decorations: (state) => planCommentDecorationKey.getState(state) ?? null,
        },
      }),
    ]
  },
})

export function setPlanCommentDecorations(editor: Editor, comments: readonly CommentLike[]): void {
  editor.view.dispatch(editor.state.tr.setMeta(planCommentDecorationKey, comments))
}

function context(
  document: ProseMirrorNode,
  from: number,
  to: number,
): Pick<PlanCommentAnchor, 'quote' | 'prefix' | 'suffix'> {
  const size = document.content.size
  return {
    quote: document.textBetween(from, to, '\n', '\n'),
    prefix: document.textBetween(Math.max(0, from - 32), from, '\n', '\n'),
    suffix: document.textBetween(to, Math.min(size, to + 32), '\n', '\n'),
  }
}

export function proseMirrorAnchor(document: ProseMirrorNode, from: number, to: number): PlanProseMirrorRange {
  return { kind: 'prosemirror_range', from, to, ...context(document, from, to) }
}

export function mappedPlanCommentAnchors(
  editor: Editor,
  comments: readonly CommentLike[],
): Map<string, PlanProseMirrorRange | null> {
  const set = planCommentDecorationKey.getState(editor.state)
  const positions = new Map<string, { from: number; to: number }>()
  for (const decoration of set?.find() ?? []) {
    const id = decoration.spec.planCommentId
    if (typeof id === 'string') positions.set(id, { from: decoration.from, to: decoration.to })
  }

  return new Map(
    comments.map((comment) => {
      if (comment.anchor.kind !== 'prosemirror_range' || comment.state === 'deleted') return [comment.id, null]
      const position = positions.get(comment.id)
      return [
        comment.id,
        position && position.from < position.to
          ? proseMirrorAnchor(editor.state.doc, position.from, position.to)
          : null,
      ]
    }),
  )
}

export function sourceRangeAnchor(source: string, from: number, to: number): PlanSourceRange | null {
  if (from < 0 || from >= to || to > source.length) return null
  return {
    kind: 'source_range',
    from,
    to,
    quote: source.slice(from, to),
    prefix: source.slice(Math.max(0, from - 32), from),
    suffix: source.slice(to, Math.min(source.length, to + 32)),
  }
}

/** Map an exact UTF-16 source selection after an edit without guessing. */
export function remapSourceRange(source: string, anchor: PlanSourceRange): PlanSourceRange | null {
  if (source.slice(anchor.from, anchor.to) === anchor.quote) {
    return sourceRangeAnchor(source, anchor.from, anchor.to)
  }
  if (!anchor.quote) return null

  const matches: number[] = []
  let cursor = 0
  while (cursor <= source.length - anchor.quote.length) {
    const found = source.indexOf(anchor.quote, cursor)
    if (found < 0) break
    matches.push(found)
    cursor = found + 1
  }
  if (matches.length === 0) return null
  if (matches.length === 1) {
    const from = matches[0]
    return sourceRangeAnchor(source, from, from + anchor.quote.length)
  }

  const contextual = matches.filter((from) => {
    const to = from + anchor.quote.length
    const prefixMatches = anchor.prefix
      ? source.slice(Math.max(0, from - anchor.prefix.length), from) === anchor.prefix
      : from === 0
    const suffixMatches = anchor.suffix
      ? source.slice(to, to + anchor.suffix.length) === anchor.suffix
      : to === source.length
    return prefixMatches && suffixMatches
  })
  if (contextual.length !== 1) return null
  const from = contextual[0]
  return sourceRangeAnchor(source, from, from + anchor.quote.length)
}
