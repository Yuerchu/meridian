import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowsRotateRight, Picture } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { api } from '@/api'
import type { EmojiInfoResponse } from '@/types'

export interface EmojiMap {
  [name: string]: { emoji: EmojiInfoResponse; url: string }
}

export function useEmojiMap(assistantId: string | null) {
  const [map, setMap] = useState<EmojiMap>({})

  useEffect(() => {
    if (!assistantId) {
      setMap({})
      return
    }
    let cancelled = false

    async function load() {
      try {
        const packs = await api.listAssistantEmojiPacks(assistantId!)
        if (cancelled) return
        const emojiGroups = await Promise.all(packs.map((pack) => api.listEmojis(pack.id)))
        if (cancelled) return
        const allEmojis = emojiGroups
          .flat()
          .filter((emoji) => emoji.semantic_status === 'confirmed' && emoji.file_format !== 'lottie')
        const entries = await Promise.all(
          allEmojis.map(async (emoji) => {
            const url = await api.getEmojiFileUrl(emoji.id).catch(() => null)
            return url ? ([emoji.name, { emoji, url }] as const) : null
          }),
        )
        if (!cancelled) setMap(Object.fromEntries(entries.filter((entry) => entry !== null)))
      } catch {
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

export function StickerImage({
  stickerId,
  name,
  className = 'size-32',
}: {
  stickerId: string
  name?: string
  className?: string
}) {
  const { t } = useTranslation()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<{ status: 'loading' | 'loaded' | 'error'; url?: string }>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    void api
      .getEmojiFileUrl(stickerId)
      .then((next) => {
        if (!cancelled) setLoad({ status: 'loaded', url: next })
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [stickerId, attempt])

  if (load.status === 'loading') {
    return (
      <div
        className={`${className} rounded-xl bg-default/40 animate-pulse motion-reduce:animate-none`}
        role="status"
        aria-label={t('chat.emoji.loading', { name: name ?? t('chat.emoji.sticker') })}
      />
    )
  }
  if (load.status === 'error') {
    return (
      <div
        className={`${className} flex flex-col items-center justify-center gap-1 rounded-xl bg-default/40 text-muted`}
        role="group"
        aria-label={t('chat.emoji.loadFailed', { name: name ?? t('chat.emoji.sticker') })}
      >
        <Picture aria-hidden className="size-6" />
        <Button
          variant="ghost"
          size="sm"
          className="touch-hitbox h-auto px-1 py-0.5 text-xs"
          onPress={() => setAttempt((current) => current + 1)}
        >
          <ArrowsRotateRight aria-hidden className="size-3.5" />
          {t('chat.emoji.retry')}
        </Button>
      </div>
    )
  }
  return (
    <img
      src={load.url}
      alt={name ?? t('chat.emoji.sticker')}
      title={name}
      loading="lazy"
      width={128}
      height={128}
      className={`${className} object-contain`}
    />
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
      parts.push(
        <img
          key={`${start}-${emojiName}`}
          src={entry.url}
          alt={emojiName}
          title={emojiName}
          loading="lazy"
          width={48}
          height={48}
          className="emoji-sticker rounded"
        />,
      )
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
