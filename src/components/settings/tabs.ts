import {
  Bulb, BroadcastSignal, CircleInfo, Cloud, FaceRobot, FaceSmile, LogoMcp,
  Microphone, Sliders, Sparkles, Wrench,
} from '@gravity-ui/icons'

/**
 * The settings sections, and which of them a given platform can reach.
 *
 * Lives apart from `./index.tsx` because that module pulls in all eleven
 * panels. The sidebar and the mobile index only need the list, and importing it
 * from the barrel would drag the whole settings chunk — several thousand lines,
 * lazily loaded today — into the main bundle. Import this path directly; an
 * eslint rule forbids taking values from the barrel for the same reason.
 */
export type SettingsTab =
  | 'provider' | 'assistants' | 'emoji' | 'tools' | 'skills' | 'mcp'
  | 'memories' | 'voice' | 'onebot' | 'general' | 'about'

export interface SettingsTabDef {
  id: SettingsTab
  labelKey: string
  icon: React.ElementType
}

export const settingsTabs: SettingsTabDef[] = [
  { id: 'provider', labelKey: 'settings.provider', icon: Cloud },
  { id: 'assistants', labelKey: 'settings.assistants', icon: FaceRobot },
  { id: 'emoji', labelKey: 'settings.emoji', icon: FaceSmile },
  { id: 'tools', labelKey: 'settings.toolsTab', icon: Wrench },
  { id: 'skills', labelKey: 'settings.skillsTab', icon: Sparkles },
  { id: 'mcp', labelKey: 'settings.mcp', icon: LogoMcp },
  { id: 'memories', labelKey: 'settings.memories', icon: Bulb },
  { id: 'voice', labelKey: 'settings.voice', icon: Microphone },
  { id: 'onebot', labelKey: 'settings.onebot', icon: BroadcastSignal },
  { id: 'general', labelKey: 'settings.general', icon: Sliders },
  { id: 'about', labelKey: 'settings.about', icon: CircleInfo },
]

/**
 * Android has neither a OneBot connection nor microphone capture, so those two
 * panels would open onto nothing there.
 *
 * `platform` is null for the first frame — `usePlatform` resolves over IPC — and
 * that frame shows the full list. Filtering on an unknown platform would hide
 * two rows and then pop them back in, which reads worse than one frame of a
 * list nobody has looked at yet.
 */
export function visibleSettingsTabs(platform: string | null): SettingsTabDef[] {
  if (platform !== 'android') return settingsTabs
  return settingsTabs.filter((tab) => tab.id !== 'onebot' && tab.id !== 'voice')
}
