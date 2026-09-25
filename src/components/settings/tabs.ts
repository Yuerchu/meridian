import {
  Bot,
  Broadcast,
  ChartColumn,
  Cloud,
  FaceSmile,
  FlaskConical,
  Info,
  Keyboard,
  Lightbulb,
  Link,
  Mic,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Terminal,
  Wrench,
} from '@keyline-icons/react/two-tone'

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

/** Everything a tab is, except where it sits — which is the group's to say. */
const TAB_DEFS: Record<SettingsTab, Omit<SettingsTabDef, 'id'>> = {
  provider: { labelKey: 'settings.provider', icon: Cloud },
  usage: { labelKey: 'settings.usage', icon: ChartColumn },
  assistants: { labelKey: 'settings.assistants', icon: Bot },
  emoji: { labelKey: 'settings.emoji', icon: FaceSmile },
  tools: { labelKey: 'settings.toolsTab', icon: Wrench },
  autoreview: { labelKey: 'settings.autoReview', icon: ShieldCheck },
  skills: { labelKey: 'settings.skillsTab', icon: Sparkles },
  mcp: { labelKey: 'settings.mcp', icon: Plug },
  memories: { labelKey: 'settings.memories', icon: Lightbulb },
  voice: { labelKey: 'settings.voice', icon: Mic },
  voiceCorpus: { labelKey: 'settings.voiceCorpus', icon: Mic },
  onebot: { labelKey: 'settings.onebot', icon: Broadcast },
  hooks: { labelKey: 'settings.hooks', icon: Link },
  acp: { labelKey: 'settings.acp', icon: Terminal },
  remote: { labelKey: 'settings.remote', icon: Smartphone },
  ime: { labelKey: 'settings.ime', icon: Keyboard },
  general: { labelKey: 'settings.general', icon: SlidersHorizontal },
  developer: { labelKey: 'settings.developer', icon: FlaskConical },
  about: { labelKey: 'settings.about', icon: Info },
}

/**
 * Every tab there is, from the one table that has to name them all.
 *
 * `TAB_DEFS` is a `Record<SettingsTab, ...>`, so the compiler refuses a new tab
 * that has no definition. This is how the *groups* are held to the same
 * standard: a tab defined and then left out of every group would compile, and
 * would simply never appear in the sidebar.
 */
export const settingsTabIds = Object.keys(TAB_DEFS) as SettingsTab[]

export type SettingsTabGroupId = 'models' | 'agent' | 'integrations' | 'app'

export interface SettingsTabGroupDef {
  id: SettingsTabGroupId
  labelKey: string
  tabs: readonly SettingsTab[]
}

/**
 * Eighteen rows in one list is a list nobody reads to the end of.
 *
 * Four groups, and the cut is by what a person is trying to do rather than by
 * what the code shares. *Models* is what answers and what it costs — usage sits
 * there because it is priced entirely by what the provider page was filled in
 * with, and the two are read together. *Agent* is what the model can reach:
 * tools, the reviewer that answers their approvals, skills, MCP servers,
 * memory, stickers. *Integrations* is everything that talks to something
 * outside this window — the three panels that open a socket, the child process,
 * and voice, which is a service on the far end of a key. *App* is the window
 * itself.
 *
 * This is also the one order: the flat list every other consumer reads is
 * derived from it, so the sidebar, the command palette and the composer's
 * typeahead cannot disagree about where a tab lives.
 */
export const settingsTabGroups: readonly SettingsTabGroupDef[] = [
  { id: 'models', labelKey: 'settings.group.models', tabs: ['provider', 'usage', 'assistants'] },
  {
    id: 'agent',
    labelKey: 'settings.group.agent',
    // `autoreview` beside the tools rather than beside the servers: what it
    // configures is who answers a tool's approval, and the row above is where
    // the user just decided which tools exist.
    tabs: ['tools', 'autoreview', 'skills', 'mcp', 'memories', 'emoji'],
  },
  {
    id: 'integrations',
    labelKey: 'settings.group.integrations',
    // OneBot, the hook endpoint and remote access are the same decision made
    // three times; somebody asking "what is this machine serving" should find
    // them together. `acp` serves nothing but belongs beside the hook gates,
    // which are about the same other coding agent. `ime` sits by voice: both
    // are ways of typing, and the input method is a service outside this window.
    tabs: ['voice', 'voiceCorpus', 'ime', 'onebot', 'hooks', 'acp', 'remote'],
  },
  { id: 'app', labelKey: 'settings.group.app', tabs: ['general', 'developer', 'about'] },
]

const settingsTabs: SettingsTabDef[] = settingsTabGroups.flatMap((group) =>
  group.tabs.map((id) => ({ id, ...TAB_DEFS[id] })),
)

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
 * The input method exists on Windows (a text service) and Android (the
 * keyboard in this APK); there is nothing to show for it anywhere else, and a
 * remote client is looking at a desktop whose keyboard is not the one in its
 * hand. `platform` is null for the first frame and that frame shows the row,
 * for the reason given above.
 */
const INPUT_METHOD: SettingsTab[] = ['ime']
const INPUT_METHOD_PLATFORMS = ['windows', 'android']

function hiddenTabs(platform: string | null): Set<SettingsTab> {
  const hidden = new Set<SettingsTab>()
  if (platform === 'android' || !can.manageServers) DESKTOP_ONLY.forEach((id) => hidden.add(id))
  if (platform === 'android' && !isRemote) ANDROID_ONLY_HIDDEN.forEach((id) => hidden.add(id))
  if ((platform !== null && !INPUT_METHOD_PLATFORMS.includes(platform)) || !can.manageServers) {
    INPUT_METHOD.forEach((id) => hidden.add(id))
  }
  return hidden
}

export function visibleSettingsTabs(platform: string | null): SettingsTabDef[] {
  const hidden = hiddenTabs(platform)
  return hidden.size === 0 ? settingsTabs : settingsTabs.filter((tab) => !hidden.has(tab.id))
}

/**
 * The same list, in its groups, for the one consumer that draws them.
 *
 * A group whose every tab is hidden is dropped rather than left as a heading
 * over nothing — on a standalone Android build that is most of *Integrations*,
 * and an empty section reads as something failing to load.
 */
export function visibleSettingsTabGroups(
  platform: string | null,
): { group: SettingsTabGroupDef; tabs: SettingsTabDef[] }[] {
  const hidden = hiddenTabs(platform)
  return settingsTabGroups
    .map((group) => ({
      group,
      tabs: group.tabs.filter((id) => !hidden.has(id)).map((id) => ({ id, ...TAB_DEFS[id] })),
    }))
    .filter(({ tabs }) => tabs.length > 0)
}
