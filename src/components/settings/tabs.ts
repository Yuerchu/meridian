import {
  Bulb,
  BroadcastSignal,
  ChartColumn,
  CircleInfo,
  Cloud,
  FaceRobot,
  FaceSmile,
  LogoMcp,
  Flask,
  Keyboard,
  Link,
  Microphone,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sparkles,
  Terminal,
  Wrench,
} from '@gravity-ui/icons'

import { can } from '@/lib/capabilities'
import { isRemote } from '@/lib/transport'

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
  | 'provider'
  | 'usage'
  | 'assistants'
  | 'emoji'
  | 'tools'
  | 'autoreview'
  | 'skills'
  | 'mcp'
  | 'memories'
  | 'voice'
  | 'voiceCorpus'
  | 'onebot'
  | 'hooks'
  | 'acp'
  | 'remote'
  | 'ime'
  | 'general'
  | 'developer'
  | 'about'

export interface SettingsTabDef {
  id: SettingsTab
  labelKey: string
  icon: React.ElementType
}

const settingsTabs: SettingsTabDef[] = [
  { id: 'provider', labelKey: 'settings.provider', icon: Cloud },
  // Beside the providers rather than near the logs: it is priced entirely by
  // what that page was filled in with, and the two are read together.
  { id: 'usage', labelKey: 'settings.usage', icon: ChartColumn },
  { id: 'assistants', labelKey: 'settings.assistants', icon: FaceRobot },
  { id: 'emoji', labelKey: 'settings.emoji', icon: FaceSmile },
  { id: 'tools', labelKey: 'settings.toolsTab', icon: Wrench },
  // Beside the tools rather than beside the servers: what it configures is who
  // answers a tool's approval, and the row above is where the user just decided
  // which tools exist. Not desktop-only — a phone runs the same turn loop and
  // gets the same interruptions.
  { id: 'autoreview', labelKey: 'settings.autoReview', icon: ShieldCheck },
  { id: 'skills', labelKey: 'settings.skillsTab', icon: Sparkles },
  { id: 'mcp', labelKey: 'settings.mcp', icon: LogoMcp },
  { id: 'memories', labelKey: 'settings.memories', icon: Bulb },
  { id: 'voice', labelKey: 'settings.voice', icon: Microphone },
  { id: 'voiceCorpus', labelKey: 'settings.voiceCorpus', icon: Microphone },
  { id: 'onebot', labelKey: 'settings.onebot', icon: BroadcastSignal },
  { id: 'hooks', labelKey: 'settings.hooks', icon: Link },
  // Next to the hook gates because both are about another coding agent, and
  // whoever is setting one up is usually setting up the other.
  { id: 'acp', labelKey: 'settings.acp', icon: Terminal },
  // Last of the three panels that open a socket, and beside them for that
  // reason: OneBot, the hook endpoint and this one are the same decision made
  // three times, and a user looking for "what is this machine serving" should
  // find them together.
  { id: 'remote', labelKey: 'settings.remote', icon: Smartphone },
  // The one panel that is about this machine's keyboard rather than its
  // network. Windows only, and only where the backend is this machine.
  { id: 'ime', labelKey: 'settings.ime', icon: Keyboard },
  { id: 'general', labelKey: 'settings.general', icon: Sliders },
  { id: 'developer', labelKey: 'settings.developer', icon: Flask },
  { id: 'about', labelKey: 'settings.about', icon: CircleInfo },
]

/**
 * Panels for things Android cannot run: three listening sockets, and one child
 * process. `acp` is the odd one out mechanically — it serves nothing — but it
 * lands in the same place for the same two reasons: the command is compiled out
 * on Android, and what it configures is a binary on the machine the *backend* is
 * on, which is not the one a remote client is holding.
 */
const DESKTOP_ONLY: SettingsTab[] = ['onebot', 'hooks', 'acp', 'remote']

/**
 * Android has no OneBot connection and nothing to serve the hook endpoint to,
 * so both panels would open onto nothing there. Remote access is the same
 * answer for a different reason: the phone is the client in that arrangement —
 * it is what connects to a desktop, not what another device connects to — so
 * serving from it is backwards even where the socket would bind. Voice input is
 * not in the same position: recording happens in the WebView, and the model has
 * to be downloaded from this screen before anything can be transcribed.
 *
 * `can.manageServers` removes the same three, and it is the same three by
 * construction — it is exactly "the servers this app runs, including the one
 * answering". These are hidden rather than disabled because there is nothing
 * partial to show: every control on all three panels would be inert, and the
 * one a remote client would actually reach for is the address it is already
 * connected to, which it can read in General.
 *
 * `platform` is null for the first frame — `usePlatform` resolves over IPC — and
 * that frame shows the full list. Filtering on an unknown platform would hide a
 * row and then pop it back in, which reads worse than one frame of a list
 * nobody has looked at yet. `can` carries no such delay: it is decided at
 * startup, so it filters from the first frame.
 */
/**
 * Hidden on a standalone Android app and nowhere else.
 *
 * The voice corpus only exists where a OneBot connection does, and that is not
 * Android. But unlike the panels above it stays visible to a *remote* client on
 * purpose: what it offers is listing and deleting, and deleting is precisely
 * the thing somebody asks for while holding their phone. Export is withheld
 * separately, by `can.exportToDisk` inside the panel — it writes a bundle to a
 * path on whichever machine is answering.
 *
 * So the test is where the *backend* runs, not what is in the hand: an Android
 * phone in remote mode is a window onto a desktop that does have a corpus, and
 * `platform` alone — which still says `android` there — hides the one panel
 * that workflow is for.
 */
const ANDROID_ONLY_HIDDEN: SettingsTab[] = ['voiceCorpus']

/**
 * The input method is a Windows text service; there is nothing to show for it
 * anywhere else, and a remote client is looking at a desktop whose keyboard is
 * not the one in its hand. `platform` is null for the first frame and that
 * frame shows the row, for the reason given above.
 */
const WINDOWS_ONLY: SettingsTab[] = ['ime']

export function visibleSettingsTabs(platform: string | null): SettingsTabDef[] {
  const hidden = new Set<SettingsTab>()
  if (platform === 'android' || !can.manageServers) DESKTOP_ONLY.forEach((id) => hidden.add(id))
  if (platform === 'android' && !isRemote) ANDROID_ONLY_HIDDEN.forEach((id) => hidden.add(id))
  if ((platform !== null && platform !== 'windows') || !can.manageServers) WINDOWS_ONLY.forEach((id) => hidden.add(id))
  return hidden.size === 0 ? settingsTabs : settingsTabs.filter((tab) => !hidden.has(tab.id))
}
