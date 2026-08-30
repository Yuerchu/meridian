/* eslint-disable react-refresh/only-export-components --
   The cases and the registry naming them belong together: splitting `CASES` out
   would leave a file of components nothing imports and a file of ids nothing
   renders. Fast refresh is what the rule protects, and this page is opened to
   run a sweep against a fixed set of widths — a full reload is the honest
   response to editing it anyway. */
import { useState } from 'react'

import { Composer } from '@/components/chat/composer'
import { ComposerMenu } from '@/components/chat/composer-menu'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { VoiceOverlay } from '@/components/chat/voice-overlay'
import { MasterDetail } from '@/components/settings/master-detail'
import { useMasterDetail } from '@/components/settings/use-master-detail'
import { ListView } from '@heroui-pro/react/list-view'

/**
 * The things worth putting in front of the detectors, and nothing else.
 *
 * Chosen so that each one fails a *different* way — clipping, a fixed width that
 * cannot narrow, a breakpoint measured against the wrong box, a floating element
 * that ignores the keyboard. Adding a fifth that fails like one of these buys
 * nothing but a longer sweep.
 *
 * Every case renders from props alone. Nothing here may call `invoke` on mount:
 * the frame deletes Tauri's bridge before rendering, so a case that tried would
 * throw rather than quietly hang — see `responsive-lab.tsx`.
 */

export interface ResponsiveCase {
  id: string
  label: string
  /** What it is here to catch, printed beside the case so a red row can be read. */
  watchFor: string
  render: () => React.ReactNode
}

const TABLE_MD = [
  '| Provider | Model | Input | Output | Cache read | Cache write |',
  '| --- | --- | --- | --- | --- | --- |',
  '| OpenAI | gpt-4.1-mini | 0.40 | 1.60 | 0.10 | 0.50 |',
  '| Anthropic | claude-sonnet-4-5-20250929 | 3.00 | 15.00 | 0.30 | 3.75 |',
  '| xAI | grok-4.6 | 2.00 | 10.00 | 0.50 | 2.50 |',
  '',
  'A fence, for the copy button and the sideways scroll it is allowed to have:',
  '',
  '```ts',
  'const priced = rows.map((row) => ({ ...row, cost: costOf(row, prices, tiers, window) }))',
  '```',
].join('\n')

function noop() {}

function ComposerCase() {
  const [value, setValue] = useState('')
  return (
    <div className="p-4">
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={noop}
        ariaLabel="Message"
        placeholder="Send a message..."
        toolbarStart={
          <ComposerMenu
            assistants={[]}
            providers={[]}
            currentAssistantId={null}
            currentModelId="claude-sonnet-4-5-20250929"
            currentProviderId={null}
            onSelectAssistant={noop}
            onSelectModel={noop}
            thinkingLevel="default"
            onSelectThinkingLevel={noop}
            fastMode={false}
            onToggleFast={noop}
            mode="work"
            onSelectMode={noop}
            acceptEdits={false}
            onToggleAcceptEdits={noop}
          />
        }
      />
      <p className="mt-2 text-xs text-muted">
        Open the <code>+</code> menu before sweeping: it is portalled, and 464px of it is what the escape detector is
        here to catch.
      </p>
    </div>
  )
}

function TranscriptCase() {
  return (
    <div className="p-4">
      <div className="rounded-2xl bg-surface p-3 shadow-surface">
        <MarkdownContent content={TABLE_MD} />
      </div>
    </div>
  )
}

function SettingsCase() {
  const nav = useMasterDetail()
  return (
    // No `SettingsPane` around it, matching `ProviderSettings`: the pane caps at
    // `max-w-lg`, which would hold this below the two-column threshold at every
    // width and quietly make the case prove nothing.
    <div className="p-4">
      <MasterDetail
        nav={nav}
        title="Providers"
        list={
          <ListView
            aria-label="Providers"
            className="flex flex-col gap-1"
            selectedKeys={nav.selectedId ? new Set([nav.selectedId]) : new Set<string>()}
            selectionBehavior="replace"
            selectionMode="single"
            shouldSelectOnPressUp
            variant="secondary"
            onSelectionChange={(keys) => {
              if (keys === 'all') return
              const id = keys.values().next().value
              if (typeof id === 'string' && id !== nav.selectedId) nav.openItem(id)
            }}
          >
            {[
              ['openai', 'OpenAI'],
              ['anthropic', 'Anthropic'],
            ].map(([id, label]) => (
              <ListView.Item
                key={id}
                id={id}
                textValue={label}
                className="min-h-11 rounded-lg border-b-0 px-3 py-2 data-[selected=true]:bg-default data-[selected=true]:text-default-foreground"
              >
                <ListView.ItemContent>
                  <ListView.Title className="font-normal">{label}</ListView.Title>
                </ListView.ItemContent>
              </ListView.Item>
            ))}
          </ListView>
        }
        detailTitle="Anthropic"
        emptyDetail="Pick a provider"
        detail={
          nav.selectedId ? (
            // Deliberately shaped like `ModelConfigEditor`'s price block rather
            // than being it: the real panel fetches on mount. Keep the two in
            // step by hand — this exists to show what that grid does at a width,
            // and it is worth nothing if it stops looking like it.
            <div className="space-y-2 rounded-lg bg-default/30 px-3 py-3">
              <div className="grid grid-cols-1 gap-2 @sm/pane:grid-cols-2">
                {['Input price', 'Output price', 'Cache read', 'Cache write'].map((label) => (
                  <label key={label} className="block text-xs">
                    <span className="text-muted">{label}</span>
                    <span className="mt-1 block h-7 rounded-md border border-field-border bg-field-background pointer-coarse:h-10" />
                  </label>
                ))}
              </div>
            </div>
          ) : null
        }
      />
    </div>
  )
}

function VoiceCase() {
  return (
    <div className="relative h-full p-4">
      <p className="text-xs text-muted">
        Set an IME inset in the panel: this overlay is `fixed` and outside the shell that `app-shell` pads.
      </p>
      <VoiceOverlay state="recording-hold" elapsed={12} peak={0.6} />
    </div>
  )
}

export const CASES: ResponsiveCase[] = [
  {
    id: 'composer',
    label: 'Composer',
    watchFor: 'Send clipped away by a wide toolbar; the + menu drawn off-screen; the context dial under 44px',
    render: () => <ComposerCase />,
  },
  {
    id: 'transcript',
    label: 'Markdown table',
    watchFor: 'A table clipped by the bubble (fail) beside a code fence that scrolls (info) — the calibration case',
    render: () => <TranscriptCase />,
  },
  {
    id: 'settings',
    label: 'Settings two-column',
    watchFor: 'The detail column squeezed at window widths the viewport still calls a desktop',
    render: () => <SettingsCase />,
  },
  {
    id: 'voice',
    label: 'Voice overlay',
    watchFor: 'Level meter and prompt under the keyboard',
    render: () => <VoiceCase />,
  },
]
