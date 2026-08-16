import { ProviderSettings } from './provider-settings'
import { UsageSettings } from './usage-settings'
import { AssistantSettings } from './assistant-settings'
import { GeneralSettings } from './general-settings'
import { McpSettings } from './mcp-settings'
import { OneBotSettings } from './onebot-settings'
import { HooksSettings } from './hooks-settings'
import { EmojiSettings } from './emoji-settings'
import { ToolMarketplace } from './tool-marketplace'
import { SkillSettings } from './skill-settings'
import { MemorySettings } from './memory-settings'
import { VoiceSettings } from './voice-settings'
import { DeveloperSettings } from './developer-settings'
import { About } from './about'

// Re-exported so existing type-only importers keep working. The list itself now
// lives in `./tabs`, which carries no panel imports — see the note there.
export type { SettingsTab } from './tabs'
import type { SettingsTab } from './tabs'

export default function SettingsPage({ activeTab }: { activeTab: SettingsTab }) {
  // The inset sits on the scroller itself, and the spacing stays inside it.
  // Padding here lets the last control come to rest above the navigation bar
  // while the list still scrolls the full height of the screen; taking the room
  // off an ancestor's height instead would turn that strip into dead background
  // — the web equivalent of `clipToPadding=true`. Sides matter in landscape,
  // where the 3-button bar moves to one edge.
  return (
    <div
      data-slot="settings-page"
      className="h-full overflow-y-auto overscroll-contain pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)]"
    >
      <div className="p-4 md:p-6">
        {activeTab === 'provider' && <ProviderSettings />}
        {activeTab === 'usage' && <UsageSettings />}
        {activeTab === 'assistants' && <AssistantSettings />}
        {activeTab === 'emoji' && <EmojiSettings />}
        {activeTab === 'tools' && <ToolMarketplace />}
        {activeTab === 'skills' && <SkillSettings />}
        {activeTab === 'mcp' && <McpSettings />}
        {activeTab === 'memories' && <MemorySettings />}
        {activeTab === 'voice' && <VoiceSettings />}
        {activeTab === 'onebot' && <OneBotSettings />}
        {activeTab === 'hooks' && <HooksSettings />}
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'developer' && <DeveloperSettings />}
        {activeTab === 'about' && <About />}
      </div>
    </div>
  )
}
