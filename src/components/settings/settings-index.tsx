import { useTranslation } from 'react-i18next'

import { usePlatform } from '@/hooks/use-platform'
import { SettingsRow } from './primitives'
import { visibleSettingsTabs, type SettingsTab } from './tabs'

/**
 * The list of settings sections, for screens that show one at a time.
 *
 * The desktop reaches the same sections through the sidebar; this exists
 * because a phone has no sidebar to put them in. Both read the same filtered
 * list, so a section hidden on Android cannot come back through one route and
 * not the other.
 */
export function SettingsIndex({ onSelect }: { onSelect: (tab: SettingsTab) => void }) {
  const { t } = useTranslation()
  const platform = usePlatform()

  return (
    <div data-slot="settings-index" className="space-y-0.5 p-2">
      {visibleSettingsTabs(platform).map((tab) => (
        <SettingsRow
          key={tab.id}
          icon={<tab.icon />}
          label={t(tab.labelKey)}
          onClick={() => onSelect(tab.id)}
        />
      ))}
    </div>
  )
}
