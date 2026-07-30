import { ProviderSettings } from './provider-settings'
import { AssistantSettings } from './assistant-settings'
import { GeneralSettings } from './general-settings'
import { McpSettings } from './mcp-settings'
import { OneBotSettings } from './onebot-settings'
import { EmojiSettings } from './emoji-settings'
import { ToolMarketplace } from './tool-marketplace'
import { SkillSettings } from './skill-settings'
import { MemorySettings } from './memory-settings'
import { VoiceSettings } from './voice-settings'
import { About } from './about'
import { ScrollArea } from '@/components/ui/scroll-area'

export type SettingsTab = 'provider' | 'assistants' | 'emoji' | 'tools' | 'skills' | 'mcp' | 'memories' | 'voice' | 'onebot' | 'general' | 'about'

export default function SettingsPage({ activeTab }: { activeTab: SettingsTab }) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 md:p-6">
        {activeTab === 'provider' && <ProviderSettings />}
        {activeTab === 'assistants' && <AssistantSettings />}
        {activeTab === 'emoji' && <EmojiSettings />}
        {activeTab === 'tools' && <ToolMarketplace />}
        {activeTab === 'skills' && <SkillSettings />}
        {activeTab === 'mcp' && <McpSettings />}
        {activeTab === 'memories' && <MemorySettings />}
        {activeTab === 'voice' && <VoiceSettings />}
        {activeTab === 'onebot' && <OneBotSettings />}
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'about' && <About />}
      </div>
    </ScrollArea>
  )
}
