import { ProviderSettings } from './provider-settings'
import { UsageSettings } from './usage-settings'
import { AssistantSettings } from './assistant-settings'
import { GeneralSettings } from './general-settings'
import { McpSettings } from './mcp-settings'
import { OneBotSettings } from './onebot-settings'
import { HooksSettings } from './hooks-settings'
import { AcpSettings } from './acp-settings'
import { RemoteAccessSettings } from './remote-access-settings'
import { EmojiSettings } from './emoji-settings'
import { ToolMarketplace } from './tool-marketplace'
import { AutoReviewSettings } from './auto-review-settings'
import { SkillSettings } from './skill-settings'
import { MemorySettings } from './memory-settings'
import { VoiceSettings } from './voice-settings'
import { VoiceCorpusSettings } from './voice-corpus-settings'
import { DeveloperSettings } from './developer-settings'
import { About } from './about'

// Re-exported so existing type-only importers keep working. The list itself now
// lives in `./tabs`, which carries no panel imports — see the note there.
export type { SettingsTab } from './tabs'
import type { SettingsTab } from './tabs'

export default function SettingsPage({
  activeTab,
  onOpenConversation,
}: {
  activeTab: SettingsTab
  onOpenConversation: (conversationId: string) => void
}) {
  let panel: React.ReactNode
  switch (activeTab) {
    case 'provider':
      panel = <ProviderSettings />
      break
    case 'usage':
      panel = <UsageSettings onOpenConversation={onOpenConversation} />
      break
    case 'assistants':
      panel = <AssistantSettings />
      break
    case 'emoji':
      panel = <EmojiSettings />
      break
    case 'tools':
      panel = <ToolMarketplace />
      break
    case 'autoreview':
      panel = <AutoReviewSettings />
      break
    case 'skills':
      panel = <SkillSettings />
      break
    case 'mcp':
      panel = <McpSettings />
      break
    case 'memories':
      panel = <MemorySettings />
      break
    case 'voice':
      panel = <VoiceSettings />
      break
    case 'voiceCorpus':
      panel = <VoiceCorpusSettings />
      break
    case 'onebot':
      panel = <OneBotSettings />
      break
    case 'hooks':
      panel = <HooksSettings />
      break
    case 'acp':
      panel = <AcpSettings />
      break
    case 'remote':
      panel = <RemoteAccessSettings />
      break
    case 'general':
      panel = <GeneralSettings />
      break
    case 'developer':
      panel = <DeveloperSettings />
      break
    case 'about':
      panel = <About />
      break
  }

  // The inset sits on the scroller itself, and the spacing stays inside it.
  // Padding here lets the last control come to rest above the navigation bar
  // while the list still scrolls the full height of the screen; taking the room
  // off an ancestor's height instead would turn that strip into dead background
  // — the web equivalent of `clipToPadding=true`. Sides matter in landscape,
  // where the 3-button bar moves to one edge.
  return (
    <div
      data-slot="settings-page"
      className="@container/settings h-full overflow-y-auto overscroll-contain pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)]"
    >
      {/* Against the layer, not the window: this is the chat's width minus the
          sidebar, so a 769px window leaves 519px here and the roomier padding
          was taking 9% of it. The container is declared on the scroller above
          rather than here — a query resolves against an ancestor container, so
          an element carrying both would look past its own. */}
      <div data-slot="settings-panel" className="p-4 @2xl/settings:p-6">
        {panel}
      </div>
    </div>
  )
}
