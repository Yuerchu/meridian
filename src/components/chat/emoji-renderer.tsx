import React, { useState, useEffect, useMemo } from 'react'
import { api } from '@/api'
import type { Emoji } from '@/types'

export interface EmojiMap {
  [name: string]: { emoji: Emoji; url: string }
}

export function useEmojiMap(assistantId: string | null) {
  const [map, setMap] = useState<EmojiMap>({})

  useEffect(() => {
    if (!assistantId) { setMap({}); return }
    let cancelled = false

    async function load() {
      try {
        const packs = await api.listAssistantEmojiPacks(assistantId!)
        if (cancelled) return
        const emojiGroups = await Promise.all(packs.map((pack) => api.listEmojis(pack.id)))
        if (cancelled) return
        const allEmojis = emojiGroups.flat()
        const entries = await Promise.all(allEmojis.map(async (emoji) => (
          [emoji.name, { emoji, url: await api.getEmojiFileUrl(emoji.id) }] as const
        )))
        if (!cancelled) setMap(Object.fromEntries(entries))
      } catch {
        if (!cancelled) setMap({})
      }
    }

    void load()
    return () => { cancelled = true }
  }, [assistantId])

  return map
}

const EMOJI_REGEX = /\[emoji:([^\]]+)\]/g

export function renderEmojisInText(
  text: string,
  emojiMap: EmojiMap,
): (string | React.ReactElement)[] {
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

export function EmojiText({
  text,
  emojiMap,
}: {
  text: string
  emojiMap: EmojiMap
}) {
  const parts = useMemo(() => renderEmojisInText(text, emojiMap), [text, emojiMap])
  return <>{parts}</>
}
