import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlignLeft, Archive, FolderOpen, Message, Plus } from '@keyline-icons/react/two-tone'
import { CommandPalette as LibraryCommandPalette } from '@/components/yuerchu-ui/components/command-palette/command-palette'
import { MenuItem, MenuSection } from '@/components/yuerchu-ui/components/menu/menu'

import { api } from '@/api'
import type { ConversationInfoResponse, ConversationSearchHitInfoResponse, ProjectInfoResponse } from '@/types'
import { visibleSettingsTabs, type SettingsTab } from '@/components/settings/tabs'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { usePlatform } from '@/hooks/use-platform'
import { ProjectIcon } from './project-icon'

/**
 * How many conversations to list before anything has been typed.
 *
 * Not a limit on what can be found — the filter runs over what is rendered, so
 * everything below is still rendered once there is a query. This is only about
 * what an empty palette opens onto, and a wall of three hundred rows is not an
 * answer to "what do you want to do".
 */
const RECENT = 20

/**
 * Whether any of `texts` says the query, case-insensitively: the one rule every
 * group below filters by.
 *
 * The library's palette stops filtering the moment it is given `onInputChange`,
 * and this one has to be told what is typed to ask the backend about message
 * bodies, so the local filtering is ours until it can be both (Yuerchu/ui#551).
 * Plain containment is what the boardui palette did, so nothing is lost; what
 * is not gained is the library's pinyin matching.
 */
function matches(query: string, ...texts: string[]): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || texts.some((text) => text.toLowerCase().includes(needle))
}

/**
 * Cmd+K, over what the app already has in memory.
 *
 * A settings row has to be found by the word "settings" as well as by its own
 * name, so `matches` is given both.
 *
 * Everything it can do, it does by calling the shell's own handlers. There is
 * one navigation path in this app and the palette is not allowed to become a
 * second one.
 */
export function CommandPalette({
  isOpen,
  onOpenChange,
  conversations,
  projects,
  onSelectConversation,
  onSelectProject,
  onOpenSettingsTab,
  onCreate,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  conversations: ConversationInfoResponse[]
  projects: ProjectInfoResponse[]
  onSelectConversation: (id: string) => void
  onSelectProject: (id: string | null) => void
  onOpenSettingsTab: (tab: SettingsTab) => void
  onCreate: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const platform = usePlatform()
  const [query, setQuery] = useState('')
  /** What the transcripts say about the query — the backend's answer, since
   *  message bodies are not in memory here. Empty until a search lands. */
  const [transcriptHits, setTranscriptHits] = useState<ConversationSearchHitInfoResponse[]>([])
  const [searching, setSearching] = useState(false)

  // The palette is a level, not a screen: the back gesture dismisses it before
  // it reaches anything behind. A no-op where there is no back gesture.
  useHistoryLevel(isOpen, () => onOpenChange(false))

  // Debounced rather than per keystroke: every query is a LIKE over the whole
  // messages table, and the intermediate strings of someone still typing are
  // questions nobody asked. A stale reply is dropped by the cleanup rather
  // than raced — the timer and the fetch share one cancellation.
  useEffect(() => {
    const trimmed = query.trim()
    if (!isOpen || trimmed === '') {
      setTranscriptHits([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      api
        .searchConversations({ query: trimmed, limit: null })
        .then((hits) => {
          if (!cancelled) setTranscriptHits(hits)
        })
        .catch(() => {
          // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- search results are display only; nothing is written back
          if (!cancelled) setTranscriptHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, isOpen])

  // What each id does. The library closes the palette after `onAction`, and
  // there is one navigation path in this app: the shell's own handlers.
  const act = (key: string) => {
    if (key === 'new-conversation') return void onCreate()
    if (key === 'project:all') return onSelectProject(null)
    const [kind, ...rest] = key.split(':')
    const id = rest.join(':')
    if (kind === 'conversation' || kind === 'content') onSelectConversation(id)
    else if (kind === 'project') onSelectProject(id)
    else if (kind === 'settings') onOpenSettingsTab(id as SettingsTab)
  }

  const newChat = t('sidebar.newChat')
  const allProjects = t('sidebar.allProjects')
  const recent = query ? conversations : conversations.slice(0, RECENT)
  const listed = recent.filter((conv) => matches(query, conv.title ?? newChat))
  const listedProjects = projects.filter((project) => matches(query, project.name))
  const tabs = visibleSettingsTabs(platform).filter((tab) =>
    // Both words: the section's own name is what someone who knows the app
    // types, "settings" is what everyone else does.
    matches(query, t(tab.labelKey), t('settings.title')),
  )

  // A conversation whose title already says the query is in the group above;
  // repeating it here as "also said in a message" is two rows for one answer.
  const contentOnlyHits = transcriptHits.filter(
    (hit) => !(hit.title ?? '').toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <LibraryCommandPalette
      isOpen={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open)
        // A palette that reopens onto the last search is a palette that
        // reopens onto a stale one.
        if (!open) setQuery('')
      }}
      // The shell owns Mod+K (`ignoreInInput: false`); two listeners would
      // toggle it twice.
      shortcut={false}
      aria-label={t('palette.title')}
      placeholder={t('palette.placeholder')}
      inputValue={query}
      onInputChange={setQuery}
      isLoading={searching}
      onAction={(key) => act(String(key))}
    >
      {matches(query, newChat) && (
        <MenuSection header={t('palette.actions')}>
          <MenuItem id="new-conversation" icon={<Plus />}>
            {newChat}
          </MenuItem>
        </MenuSection>
      )}

      {listed.length > 0 && (
        <MenuSection header={query ? t('sidebar.conversations') : t('palette.recent')}>
          {listed.map((conv) => (
            <MenuItem key={conv.id} id={`conversation:${conv.id}`} icon={conv.is_archived ? <Archive /> : <Message />}>
              {conv.title ?? newChat}
            </MenuItem>
          ))}
        </MenuSection>
      )}

      {/* What the transcripts say, not just what they are called: the
          backend's answer, shown as it came. */}
      {contentOnlyHits.length > 0 && (
        <MenuSection header={t('palette.inMessages')}>
          {contentOnlyHits.map((hit) => (
            <MenuItem
              key={`content:${hit.conversation_id}`}
              id={`content:${hit.conversation_id}`}
              icon={<AlignLeft />}
              description={hit.snippet}
            >
              {hit.title ?? newChat}
            </MenuItem>
          ))}
        </MenuSection>
      )}

      {(matches(query, allProjects) || listedProjects.length > 0) && (
        <MenuSection header={t('sidebar.projects')}>
          {matches(query, allProjects) && (
            <MenuItem id="project:all" icon={<FolderOpen />}>
              {allProjects}
            </MenuItem>
          )}
          {listedProjects.map((project) => (
            <MenuItem
              key={project.id}
              id={`project:${project.id}`}
              icon={<ProjectIcon sourceType={project.source_type} />}
            >
              {project.name}
            </MenuItem>
          ))}
        </MenuSection>
      )}

      {tabs.length > 0 && (
        <MenuSection header={t('settings.title')}>
          {tabs.map((tab) => (
            <MenuItem key={tab.id} id={`settings:${tab.id}`} icon={<tab.icon />}>
              {t(tab.labelKey)}
            </MenuItem>
          ))}
        </MenuSection>
      )}
    </LibraryCommandPalette>
  )
}
