import React, { useState, useEffect } from 'react'
import { api } from '@/api'
import type { Emoji } from '@/types'

export interface EmojiMap {
  [name: string]: { emoji: Emoji; url: string }
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
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .getEmojiFileUrl(stickerId)
      .then((next) => {
        if (!cancelled) setUrl(next)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [stickerId])

  if (!url) {
    return <div className={`${className} rounded-xl bg-default/40 animate-pulse`} aria-label={name} />
  }
  return <img src={url} alt={name ?? 'sticker'} title={name} className={`${className} object-contain`} />
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
