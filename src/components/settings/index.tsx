import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, Bot, Settings2, Info, Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProviderSettings } from './provider-settings'
import { AssistantSettings } from './assistant-settings'
import { GeneralSettings } from './general-settings'
import { McpSettings } from './mcp-settings'
import { About } from './about'

type SettingsTab = 'provider' | 'assistants' | 'mcp' | 'general' | 'about'

export default function SettingsPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<SettingsTab>('provider')

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ElementType }> = [
    { id: 'provider', label: t('settings.provider'), icon: Cloud },
    { id: 'assistants', label: t('settings.assistants'), icon: Bot },
    { id: 'mcp', label: t('settings.mcp'), icon: Plug },
    { id: 'general', label: t('settings.general'), icon: Settings2 },
    { id: 'about', label: t('settings.about'), icon: Info },
  ]

  return (
    <div className="flex flex-col md:flex-row h-full">
      <nav className="flex md:flex-col md:w-48 md:border-r border-border md:p-3 md:space-y-1 flex-shrink-0 overflow-x-auto border-b md:border-b-0 p-1 gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap flex-shrink-0 md:w-full',
              activeTab === tab.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {activeTab === 'provider' && <ProviderSettings />}
        {activeTab === 'assistants' && <AssistantSettings />}
        {activeTab === 'mcp' && <McpSettings />}
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'about' && <About />}
      </div>
    </div>
  )
}
