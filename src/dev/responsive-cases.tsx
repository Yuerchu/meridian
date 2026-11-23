/* eslint-disable react-refresh/only-export-components --
   The cases and the registry naming them belong together: splitting `CASES` out
   would leave a file of components nothing imports and a file of ids nothing
   renders. Fast refresh is what the rule protects, and this page is opened to
   run a sweep against a fixed set of widths — a full reload is the honest
   response to editing it anyway. */
import './responsive-cases.css'
import { useState } from 'react'

import { Composer } from '@/components/chat/composer'
import { ComposerMenu } from '@/components/chat/composer-menu'
import { ModeChip } from '@/components/chat/mode-chip'
import { ModelPanel } from '@/components/chat/model-panel'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { VoiceOverlay } from '@/components/chat/voice-overlay'
import { MasterDetail } from '@/components/settings/master-detail'
import { useMasterDetail } from '@/components/settings/use-master-detail'
import { ListBox, ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'

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
    <div data-slot="responsive-case-composer" className="m-dev-responsive-case__pad">
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={noop}
        ariaLabel="Message"
        placeholder="Send a message..."
        toolbarStart={
          <>
            <ComposerMenu onPickFile={noop} onOpenStickers={noop} />
            <ModeChip mode="work" acceptEdits={false} onSelectMode={noop} onToggleAcceptEdits={noop} />
          </>
        }
        toolbarEnd={
          <ModelPanel
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
          />
        }
      />
      <p data-slot="responsive-case-note" className="m-dev-responsive-case__note">
        Open the <code data-slot="responsive-case-note-code">+</code> menu, the mode menu and the model panel before
        sweeping: all three are portalled, and a panel opening past the edge is what the escape detector is here to
        catch.
      </p>
    </div>
  )
}

function TranscriptCase() {
  return (
    <div data-slot="responsive-case-transcript" className="m-dev-responsive-case__pad">
      <div data-slot="responsive-case-bubble" className="m-dev-responsive-case__bubble">
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
    <div data-slot="responsive-case-settings" className="m-dev-responsive-case__pad">
      <MasterDetail
        nav={nav}
        title="Providers"
        list={
          <ListBox
            aria-label="Providers"
            selectedKeys={nav.selectedId ? new Set([nav.selectedId]) : new Set<string>()}
            selectionBehavior="replace"
            selectionMode="single"
            shouldSelectOnPressUp
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
              <ListBoxItem key={id} id={id} textValue={label}>
                {label}
              </ListBoxItem>
            ))}
          </ListBox>
        }
        detailTitle="Anthropic"
        emptyDetail="Pick a provider"
        detail={
          nav.selectedId ? (
            // Deliberately shaped like `ModelConfigEditor`'s price block rather
            // than being it: the real panel fetches on mount. Keep the two in
            // step by hand — this exists to show what that grid does at a width,
            // and it is worth nothing if it stops looking like it.
            <div data-slot="responsive-case-price-block" className="m-dev-responsive-case__price-block">
              <div data-slot="responsive-case-price-grid" className="m-dev-responsive-case__price-grid">
                {['Input price', 'Output price', 'Cache read', 'Cache write'].map((label) => (
                  <div key={label} className="m-dev-responsive-case__price-field">
                    <span data-slot="responsive-case-price-label" className="m-dev-responsive-case__price-label">
                      {label}
                    </span>
                    <span data-slot="responsive-case-price-input" className="m-dev-responsive-case__price-input" />
                  </div>
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
    <div data-slot="responsive-case-voice" className="m-dev-responsive-case__voice">
      <p data-slot="responsive-case-note" className="m-dev-responsive-case__note-flush">
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
