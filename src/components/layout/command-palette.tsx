import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Command } from '@/components/base'
import { Archive, Comment, FolderOpen, Magnifier, Plus, TextAlignLeft } from '@gravity-ui/icons'

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
 * Cmd+K, over what the app already has in memory.
 *
 * Filtering comes from `Command.Dialog`: it wraps its children in React Aria's
 * `Autocomplete`, which matches each item's `textValue` case-insensitively.
 * So the only rule here is that **`textValue` has to carry every word worth
 * searching for** — a settings row whose `textValue` is just its own label
 * cannot be found by typing the word "settings".
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
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .searchConversations({ query: trimmed, limit: null })
        .then((hits) => {
          if (!cancelled) setTranscriptHits(hits)
        })
        .catch(() => {
          if (!cancelled) setTranscriptHits([])
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, isOpen])

  /** Acting closes the palette; nothing here leaves it open behind a change. */
  const act = (run: () => void) => () => {
    onOpenChange(false)
    run()
  }

  const listed = query ? conversations : conversations.slice(0, RECENT)

  // A conversation whose title already says the query is in the group above;
  // repeating it here as "also said in a message" is two rows for one answer.
  const contentOnlyHits = transcriptHits.filter(
    (hit) => !(hit.title ?? '').toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <Command>
      <Command.Backdrop
        isOpen={isOpen}
        onOpenChange={(open) => {
          onOpenChange(open)
          // A palette that reopens onto the last search is a palette that
          // reopens onto a stale one.
          if (!open) setQuery('')
        }}
      >
        <Command.Container size="md">
          <Command.Dialog aria-label={t('palette.title')} inputValue={query} onInputChange={setQuery}>
            <Command.Header>
              <Command.InputGroup aria-label={t('palette.title')}>
                <Command.InputGroup.Prefix>
                  <Magnifier />
                </Command.InputGroup.Prefix>
                <Command.InputGroup.Input placeholder={t('palette.placeholder')} />
                <Command.InputGroup.ClearButton aria-label={t('palette.clearSearch')} />
              </Command.InputGroup>
            </Command.Header>

            <Command.List aria-label={t('palette.title')} renderEmptyState={() => t('palette.empty')}>
              <Command.Group heading={t('palette.actions')}>
                <Command.Item id="new-conversation" textValue={t('sidebar.newChat')} onAction={act(onCreate)}>
                  <Plus />
                  {t('sidebar.newChat')}
                </Command.Item>
              </Command.Group>

              <Command.Group heading={query ? t('sidebar.conversations') : t('palette.recent')}>
                {listed.map((conv) => (
                  <Command.Item
                    key={conv.id}
                    id={`conversation:${conv.id}`}
                    textValue={conv.title ?? t('sidebar.newChat')}
                    onAction={act(() => onSelectConversation(conv.id))}
                  >
                    {conv.is_archived ? <Archive /> : <Comment />}
                    {conv.title ?? t('sidebar.newChat')}
                  </Command.Item>
                ))}
              </Command.Group>

              {/* What the transcripts say, not just what they are called. The
                  snippet is part of `textValue` on purpose: the outer
                  Autocomplete filters items by it, and the match that earned
                  this row a place is in the snippet, not necessarily in the
                  title. */}
              {contentOnlyHits.length > 0 && (
                <Command.Group heading={t('palette.inMessages')}>
                  {contentOnlyHits.map((hit) => (
                    <Command.Item
                      key={`content:${hit.conversation_id}`}
                      id={`content:${hit.conversation_id}`}
                      textValue={`${hit.title ?? t('sidebar.newChat')} ${hit.snippet}`}
                      onAction={act(() => onSelectConversation(hit.conversation_id))}
                    >
                      <TextAlignLeft />
                      <div data-slot="palette-hit" className="flex min-w-0 flex-col">
                        <span data-slot="palette-hit-title" className="truncate">
                          {hit.title ?? t('sidebar.newChat')}
                        </span>
                        <span
                          data-slot="palette-hit-snippet"
                          className="truncate text-caption-1-regular text-text-secondary"
                        >
                          {hit.snippet}
                        </span>
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading={t('sidebar.projects')}>
                <Command.Item
                  id="project:all"
                  textValue={t('sidebar.allProjects')}
                  onAction={act(() => onSelectProject(null))}
                >
                  <FolderOpen />
                  {t('sidebar.allProjects')}
                </Command.Item>
                {projects.map((project) => (
                  <Command.Item
                    key={project.id}
                    id={`project:${project.id}`}
                    textValue={project.name}
                    onAction={act(() => onSelectProject(project.id))}
                  >
                    <ProjectIcon sourceType={project.source_type} />
                    {project.name}
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading={t('settings.title')}>
                {visibleSettingsTabs(platform).map((tab) => (
                  <Command.Item
                    key={tab.id}
                    id={`settings:${tab.id}`}
                    // Both words: the section's own name is what someone who
                    // knows the app types, "settings" is what everyone else does.
                    textValue={`${t(tab.labelKey)} ${t('settings.title')}`}
                    onAction={act(() => onOpenSettingsTab(tab.id))}
                  >
                    <tab.icon />
                    {t(tab.labelKey)}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>

            <Command.Footer>{t('palette.footer')}</Command.Footer>
          </Command.Dialog>
        </Command.Container>
      </Command.Backdrop>
    </Command>
  )
}
