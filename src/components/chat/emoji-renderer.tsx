import './emoji-renderer.css'
import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, RefreshCw } from '@keyline-icons/react/two-tone'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { api } from '@/api'
import { useStickerUrl } from '@/lib/sticker-urls'
import type { EmojiInfoResponse } from '@/types'
import { usePointerPlay, useReducedMotion, useStickerPlayback } from './sticker-playback'
import { StickerThumb } from './sticker-thumb'

/**
 * What an assistant's `[emoji:name]` can name: metadata only. The pictures are
 * asked for one at a time, by whichever sticker is about to be drawn
 * (`useStickerUrl`) — resolving every URL here was one IPC round trip per
 * sticker the assistant *could* send, each possibly a megabyte of base64,
 * the moment a conversation opened.
 */
export type EmojiMap = Readonly<Record<string, EmojiInfoResponse>>

export function useEmojiMap(assistantId: string | null): EmojiMap {
  const [map, setMap] = useState<EmojiMap>({})

  useEffect(() => {
    if (!assistantId) {
      setMap({})
      return
    }
    let cancelled = false

    async function load() {
      try {
        const packs = await api.emojis.listPacks({ assistant_id: assistantId! })
        if (cancelled) return
        const emojiGroups = await Promise.all(
          packs.map((pack) => api.emojis.list({ filter: { kind: 'pack', pack_id: pack.id } })),
        )
        if (cancelled) return
        const usable = emojiGroups
          .flat()
          .filter((emoji) => emoji.semantic_status === 'confirmed' && emoji.file_format !== 'lottie')
        setMap(Object.fromEntries(usable.map((emoji) => [emoji.name, emoji])))
      } catch {
        // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- display only: an unresolved sticker name stays text
        if (!cancelled) setMap({})
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [assistantId])

  return map
}

/**
 * A sticker in the transcript: asked for when it comes near the viewport,
 * painted still, and played only while it is on screen, the reader is not
 * scrolling and fewer than `MAX_PLAYING` others already are — or while a
 * pointer rests on it (`sticker-playback.ts`). Under reduced motion only the
 * pointer plays it.
 */
export function StickerImage({
  stickerId,
  name,
  className = 'm-emoji-renderer__sticker',
}: {
  stickerId: string
  name?: string
  className?: string
}) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const reducedMotion = useReducedMotion()
  const [pointed, pointer] = usePointerPlay()
  const { near, playing } = useStickerPlayback(box, { autoplay: !reducedMotion, explicit: pointed })
  const load = useStickerUrl(near ? stickerId : null, attempt)
  const label = name ?? t('chat.emoji.sticker')

  return (
    <div ref={box} data-slot="sticker-box" className={'m-emoji-renderer__box ' + className} {...pointer}>
      {load.status === 'loading' ? (
        <div
          data-slot="sticker-placeholder"
          className="m-emoji-renderer__placeholder"
          role="status"
          aria-busy
          aria-label={t('chat.emoji.loading', { name: label })}
        >
          <Skeleton shape="rect" width="100%" height="100%" />
        </div>
      ) : load.status === 'error' ? (
        <div
          data-slot="sticker-error"
          className="m-emoji-renderer__error"
          role="group"
          aria-label={t('chat.emoji.loadFailed', { name: label })}
        >
          <Image aria-hidden className="m-emoji-renderer__error-icon" />
          <span className="m-emoji-renderer__retry">
            <Button
              icon={<RefreshCw />}
              variant="secondary"
              size="sm"
              onPress={() => setAttempt((current) => current + 1)}
            >
              {t('chat.emoji.retry')}
            </Button>
          </span>
        </div>
      ) : load.status === 'loaded' ? (
        <div data-slot="sticker-image" role="img" aria-label={label} className="m-emoji-renderer__image">
          <StickerThumb
            src={load.url}
            near={near}
            playing={playing}
            fallback={<Image aria-hidden className="m-emoji-renderer__fallback-icon" />}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * A sticker named inline (`[emoji:name]`) — in a person's message or in an
 * assistant's markdown — under the same rule as `StickerImage`: its URL is
 * asked for only once it comes near, and it plays only when the playback
 * scope allows. A `span`, because in markdown it sits inside a `<p>`.
 */
export function InlineSticker({
  stickerId,
  name,
  className = 'm-emoji-renderer__inline-default',
  slot = 'inline-emoji',
}: {
  stickerId: string
  name: string
  className?: string
  slot?: string
}) {
  const { t } = useTranslation()
  const box = useRef<HTMLSpanElement>(null)
  const [attempt, setAttempt] = useState(0)
  const reducedMotion = useReducedMotion()
  const [pointed, pointer] = usePointerPlay()
  const { near, playing } = useStickerPlayback(box, { autoplay: !reducedMotion, explicit: pointed })
  // `attempt` is the same retry counter `StickerImage` bumps: a failed lookup
  // is not cached (`sticker-urls.ts` drops the job on rejection), so a new key
  // is a new request rather than the old failure read back.
  const load = useStickerUrl(near ? stickerId : null, attempt)
  const failed = load.status === 'error'
  const retryLabel = t('chat.emoji.retryNamed', { name })
  return (
    <span
      ref={box}
      data-slot={slot}
      // A failed sticker is a group holding a button, not an image: `img`
      // makes its children presentational and would hide the retry from a
      // screen reader.
      role={failed ? 'group' : 'img'}
      aria-label={failed ? t('chat.emoji.loadFailed', { name }) : name}
      className={'m-emoji-renderer__inline ' + className}
      {...pointer}
    >
      {load.status === 'loaded' ? (
        <StickerThumb
          src={load.url}
          near={near}
          playing={playing}
          fallback={<Image aria-hidden className="m-emoji-renderer__fallback-icon" />}
        />
      ) : failed ? (
        <span data-slot={`${slot}-error`} className="m-emoji-renderer__inline-error m-emoji-renderer__retry">
          <TooltipTrigger>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw />}
              aria-label={retryLabel}
              onPress={() => setAttempt((current) => current + 1)}
            />
            <Tooltip>{retryLabel}</Tooltip>
          </TooltipTrigger>
        </span>
      ) : null}
    </span>
  )
}

const EMOJI_REGEX = /\[emoji:([^\]]+)\]/g

export function renderEmojisInText(text: string, emojiMap: EmojiMap): (string | React.ReactElement)[] {
  if (Object.keys(emojiMap).length === 0) return [text]

  const parts: (string | React.ReactElement)[] = []
  let lastIndex = 0

  for (const match of text.matchAll(EMOJI_REGEX)) {
    const emojiName = match[1]
    const start = match.index!

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start))
    }

    const entry = emojiMap[emojiName]
    if (entry) {
      parts.push(<InlineSticker key={`${start}-${emojiName}`} stickerId={entry.id} name={emojiName} />)
    } else {
      parts.push(match[0])
    }

    lastIndex = start + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}
