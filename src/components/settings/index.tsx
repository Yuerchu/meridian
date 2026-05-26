import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, Bot, Settings2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProviderSettings } from './provider-settings'
import { AssistantSettings } from './assistant-settings'
import { GeneralSettings } from './general-settings'
import { About } from './about'

type SettingsTab = 'provider' | 'assistants' | 'general' | 'about'

export default function SettingsPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<SettingsTab>('provider')

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ElementType }> = [
    { id: 'provider', label: t('settings.provider'), icon: Cloud },
    { id: 'assistants', label: t('settings.assistants'), icon: Bot },
    { id: 'general', label: t('settings.general'), icon: Settings2 },
    { id: 'about', label: t('settings.about'), icon: Info },
  ]

  return (
    <div className="flex h-full">
      <nav className="w-48 border-r border-border p-3 space-y-1 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
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

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'provider' && <ProviderSettings />}
        {activeTab === 'assistants' && <AssistantSettings />}
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'about' && <About />}
      </div>
    </div>
  )
}
