import { ProviderSettings } from './provider-settings'
import { AssistantSettings } from './assistant-settings'
import { GeneralSettings } from './general-settings'
import { McpSettings } from './mcp-settings'
import { OneBotSettings } from './onebot-settings'
import { TemplateGallery } from './template-gallery'
import { EmojiSettings } from './emoji-settings'
import { ToolMarketplace } from './tool-marketplace'
import { MemorySettings } from './memory-settings'
import { About } from './about'
import { ScrollArea } from '@/components/ui/scroll-area'

export type SettingsTab = 'provider' | 'assistants' | 'templates' | 'emoji' | 'tools' | 'mcp' | 'memories' | 'onebot' | 'general' | 'about'

export default function SettingsPage({ activeTab }: { activeTab: SettingsTab }) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 md:p-6">
        {activeTab === 'provider' && <ProviderSettings />}
        {activeTab === 'assistants' && <AssistantSettings />}
        {activeTab === 'templates' && <TemplateGallery />}
        {activeTab === 'emoji' && <EmojiSettings />}
        {activeTab === 'tools' && <ToolMarketplace />}
        {activeTab === 'mcp' && <McpSettings />}
        {activeTab === 'memories' && <MemorySettings />}
        {activeTab === 'onebot' && <OneBotSettings />}
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'about' && <About />}
      </div>
    </ScrollArea>
  )
}
