// Dev-only: two hundred animated stickers in a transcript-shaped scroller, to
// measure what playing them costs. `#playground/stickers` draws them the way
// the transcript does now (still frames, playback gated by `sticker-playback`);
// `#playground/stickers-legacy` draws each as a bare autoplaying `<img>`, which
// is what the transcript did before. Drive both with the same wheel script and
// compare frame rate and main-thread time.
//
// Every tenth row of the new page is an assistant's markdown naming a sticker
// as `[emoji:name]` — the path `MarkdownContent` takes — so both sticker
// surfaces are measured under the one playback scope.
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import type { EmojiMap } from '@/components/chat/emoji-renderer'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { StickerThumb } from '@/components/chat/sticker-thumb'
import { useStickerPlayback } from '@/components/chat/sticker-playback'
import { seedStickerUrl } from '@/lib/sticker-urls'
import type { EmojiInfoResponse } from '@/types'
import { cx } from '@/utils/cx'

const COUNT = 200

/**
 * An SVG whose SMIL animation plays in an `<img>` and stops at its first frame
 * when drawn into a canvas — the still/playing split a GIF gets. Several moving
 * parts, so each frame costs something to rasterise.
 */
function labSticker(i: number): string {
  const hue = (i * 47) % 360
  const dots = Array.from(
    { length: 6 },
    (_, d) =>
      `<circle cx="${20 + d * 12}" cy="${30 + ((d * 17) % 40)}" r="6" fill="white"><animate attributeName="cy" values="20;76;20" dur="${0.8 + d * 0.15}s" repeatCount="indefinite"/></circle>`,
  ).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="hsl(${hue} 70% 55%)"><animate attributeName="rx" values="10;40;10" dur="2s" repeatCount="indefinite"/></rect>${dots}<text x="48" y="92" font-size="12" text-anchor="middle" fill="white">${i + 1}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const SVG_SOURCES = Array.from({ length: COUNT }, (_, i) => labSticker(i))

/**
 * `?gif` swaps the SVGs for forty real animated GIFs (240px, 24 frames at
 * 25fps, generated into `public/.sticker-lab/` for the measurement), read into
 * `data:` URLs — the shape `get_emoji_file_url` answers with.
 */
function useSources(): string[] | null {
  const gif = new URLSearchParams(window.location.search).has('gif')
  const [sources, setSources] = useState<string[] | null>(gif ? null : SVG_SOURCES)
  useEffect(() => {
    if (!gif) return
    void Promise.all(
      Array.from({ length: 40 }, async (_, i) => {
        const blob = await (await fetch(`/.sticker-lab/s${i}.gif`)).blob()
        return await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.readAsDataURL(blob)
        })
      }),
    ).then((urls) => setSources(Array.from({ length: COUNT }, (_, i) => urls[i % urls.length])))
  }, [gif])
  return sources
}

const GatedSticker = memo(function GatedSticker({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null)
  const { near, playing } = useStickerPlayback(box, { autoplay: true, explicit: false })
  return (
    <div ref={box} data-slot="sticker-lab-gated" className="size-32 shrink-0">
      <StickerThumb src={src} near={near} playing={playing} fallback={null} />
    </div>
  )
})

const MARKDOWN_EVERY = 10

const isMarkdownRow = (i: number) => i % MARKDOWN_EVERY === MARKDOWN_EVERY / 2

/**
 * The markdown rows' stickers, answered from memory: they have no backend, so
 * their URLs are put in the shared cache and `useStickerUrl` finds them there.
 */
function useLabEmojiMap(sources: string[] | null): EmojiMap {
  return useMemo(() => {
    if (!sources) return {}
    const entries = sources.flatMap((src, i) => {
      if (!isMarkdownRow(i)) return []
      const id = `sticker-lab-${i}`
      seedStickerUrl(id, src)
      const emoji = { id, name: `lab-${i + 1}`, file_format: 'gif', semantic_status: 'confirmed' }
      return [[emoji.name, emoji as EmojiInfoResponse] as const]
    })
    return Object.fromEntries(entries)
  }, [sources])
}

const MarkdownRow = memo(function MarkdownRow({ i, emojiMap }: { i: number; emojiMap: EmojiMap }) {
  return (
    <div data-slot="sticker-lab-markdown" className="max-w-md rounded-2xl bg-background-secondary-default px-4 py-2">
      <MarkdownContent
        content={`第 ${i + 1} 行是一段回复，贴纸夹在正文里：[emoji:lab-${i + 1}] 后面还有一句话。`}
        emojiMap={emojiMap}
        blockId={`sticker-lab-${i}`}
      />
    </div>
  )
})

const LegacySticker = memo(function LegacySticker({ src }: { src: string }) {
  return (
    <img
      data-slot="sticker-lab-legacy"
      src={src}
      alt=""
      loading="lazy"
      width={128}
      height={128}
      className="size-32 object-contain"
    />
  )
})

export default function StickerLab({ legacy }: { legacy: boolean }) {
  const sources = useSources()
  const emojiMap = useLabEmojiMap(legacy ? null : sources)
  return (
    <div data-slot="sticker-lab" className="flex h-screen flex-col bg-background-full text-text-primary">
      <header data-slot="sticker-lab-header" className="flex items-center gap-4 px-6 py-3">
        <h1 data-slot="sticker-lab-title" className="text-headline-semibold">
          {legacy ? '贴纸：旧（全部自动播放）' : '贴纸：新（可见 + 非滚动 + 上限）'}
        </h1>
      </header>
      <div data-slot="sticker-lab-scroller" id="sticker-lab-scroller" className="min-h-0 flex-1 overflow-y-auto px-6">
        {sources?.map((src, i) => (
          <div
            key={i}
            data-slot="sticker-lab-row"
            className={cx('flex py-2', i % 2 === 0 ? 'justify-start' : 'justify-end')}
          >
            {legacy ? (
              <LegacySticker src={src} />
            ) : isMarkdownRow(i) ? (
              <MarkdownRow i={i} emojiMap={emojiMap} />
            ) : (
              <GatedSticker src={src} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
