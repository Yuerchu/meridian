import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  MessageSquare, MessageCircle, Plus, Settings, Trash2, FolderOpen, FolderPlus,
  Users, Archive, Download, ArrowLeft, Pin, PinOff, Pencil,
  Cloud, Bot, Smile, Wrench, Sparkles, Plug, Brain, Mic, Radio, Settings2, Info,
} from 'lucide-react'
import SpotlightCard from '@/components/SpotlightCard'
import { useConversationStore } from '@/stores/conversation-store'
import type { Conversation, Project } from '@/types'
import type { SettingsTab } from '@/components/settings'
import { api } from '@/api'
import { usePlatform } from '@/hooks/use-platform'
import { Button, Input } from '@heroui/react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'

interface AppSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => void
  onTogglePin: (id: string) => void
  page: 'chat' | 'settings'
  onOpenSettings: () => void
  onCloseSettings: () => void
  settingsTab: SettingsTab
  onSettingsTabChange: (tab: SettingsTab) => void
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => void
  onDeleteProject: (id: string) => void
  onRenameProject: (id: string, newName: string) => void
}

function NewProjectForm({ onSubmit, onCancel }: { onSubmit: (name: string, path: string) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')

  const handleBrowse = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected) {
      setPath(selected)
      if (!name.trim()) {
        const parts = selected.replace(/\\/g, '/').split('/')
        setName(parts[parts.length - 1] || '')
      }
    }
  }, [name])

  return (
    <div className="px-2 py-1.5 space-y-1.5">
      <Input fullWidth
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('sidebar.projectName')}
        className="text-xs"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim() && path.trim()) onSubmit(name.trim(), path.trim())
          else if (e.key === 'Escape') onCancel()
        }}
      />
      <Button
        type="button"
        variant="outline"
        onClick={handleBrowse}
        className="w-full justify-start text-xs"
      >
        <FolderOpen className="text-muted" />
        <span className={path ? 'text-foreground truncate' : 'text-muted'}>
          {path || t('sidebar.browsePath')}
        </span>
      </Button>
      <div className="flex gap-1">
        <Button
          variant="secondary"
          onClick={() => name.trim() && path.trim() && onSubmit(name.trim(), path.trim())}
          isDisabled={!name.trim() || !path.trim()}
          className="flex-1"
        >
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          ✕
        </Button>
      </div>
    </div>
  )
}

function ProjectIcon({ sourceType }: { sourceType: string }) {
  switch (sourceType) {
    case 'onebot_private': return <MessageCircle />
    case 'onebot_group': return <Users />
    default: return <FolderOpen />
  }
}

const settingsTabs: Array<{ id: SettingsTab; labelKey: string; icon: React.ElementType }> = [
  { id: 'provider', labelKey: 'settings.provider', icon: Cloud },
  { id: 'assistants', labelKey: 'settings.assistants', icon: Bot },
  { id: 'emoji', labelKey: 'settings.emoji', icon: Smile },
  { id: 'tools', labelKey: 'settings.toolsTab', icon: Wrench },
  { id: 'skills', labelKey: 'settings.skillsTab', icon: Sparkles },
  { id: 'mcp', labelKey: 'settings.mcp', icon: Plug },
  { id: 'memories', labelKey: 'settings.memories', icon: Brain },
  { id: 'voice', labelKey: 'settings.voice', icon: Mic },
  { id: 'onebot', labelKey: 'settings.onebot', icon: Radio },
  { id: 'general', labelKey: 'settings.general', icon: Settings2 },
  { id: 'about', labelKey: 'settings.about', icon: Info },
]

function ConversationIndicator({ conversationId, activeId }: { conversationId: string; activeId: string | null }) {
  const session = useConversationStore((s) => s.sessions[conversationId])
  if (!session || conversationId === activeId) return null

  if (session.pendingApproval || session.pendingAskUser) {
    return <span className="size-2 shrink-0 rounded-full bg-warning animate-pulse" />
  }
  if (session.streaming) {
    return <span className="size-2 shrink-0 rounded-full bg-info animate-pulse" />
  }
  if (session.fulfilledUnseen) {
    return <span className="size-2 shrink-0 rounded-full bg-success" />
  }
  return null
}

function InlineRenameInput({ value, onSubmit, onCancel }: { value: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  return (
    <Input fullWidth
      ref={inputRef}
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && text.trim()) onSubmit(text.trim())
        else if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => {
        if (text.trim() && text.trim() !== value) onSubmit(text.trim())
        else onCancel()
      }}
      className="h-auto px-1 py-0 text-sm rounded"
    />
  )
}

export function AppSidebar({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onTogglePin,
  page,
  onOpenSettings,
  onCloseSettings,
  settingsTab,
  onSettingsTabChange,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
}: AppSidebarProps) {
  const { t } = useTranslation()
  const platform = usePlatform()
  const [showNewProject, setShowNewProject] = useState(false)
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'conversation' | 'project'; id: string } | null>(null)

  if (page === 'settings') {
    return (
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onCloseSettings}>
                <ArrowLeft />
                <span>{t('settings.backToApp')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t('settings.title')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {settingsTabs.filter((tab) => (tab.id !== 'onebot' && tab.id !== 'voice') || platform !== 'android').map((tab) => (
                  <SidebarMenuItem key={tab.id}>
                    <SidebarMenuButton
                      isActive={settingsTab === tab.id}
                      onClick={() => onSettingsTabChange(tab.id)}
                    >
                      <tab.icon />
                      <span>{t(tab.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    )
  }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onCreate}>
              <Plus />
              <span>{t('sidebar.newChat')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Project selector */}
        <SidebarGroup>
          <SidebarGroupLabel>
            <span>{t('sidebar.projects')}</span>
            <Button
              isIconOnly
              variant="ghost"
              onClick={() => setShowNewProject(true)}
              className="ml-auto text-muted"
            >
              <FolderPlus />
            </Button>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeProjectId === null}
                  onClick={() => onSelectProject(null)}
                >
                  <FolderOpen />
                  <span>{t('sidebar.allProjects')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {projects.map((project) => (
                <ContextMenu key={project.id}>
                  <ContextMenuTrigger render={<SidebarMenuItem />}>
                    <SidebarMenuButton
                      isActive={project.id === activeProjectId}
                      onClick={() => onSelectProject(project.id)}
                    >
                      <ProjectIcon sourceType={project.source_type} />
                      {renamingProjectId === project.id ? (
                        <InlineRenameInput
                          value={project.name}
                          onSubmit={(v) => { onRenameProject(project.id, v); setRenamingProjectId(null) }}
                          onCancel={() => setRenamingProjectId(null)}
                        />
                      ) : (
                        <span>{project.name}</span>
                      )}
                    </SidebarMenuButton>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => setRenamingProjectId(project.id)}>
                      <Pencil />
                      {t('contextMenu.rename')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget({ type: 'project', id: project.id })}>
                      <Trash2 />
                      {t('sidebar.delete')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
              {showNewProject && (
                <NewProjectForm
                  onSubmit={(name, path) => {
                    onCreateProject(name, path)
                    setShowNewProject(false)
                  }}
                  onCancel={() => setShowNewProject(false)}
                />
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Conversations */}
        <SidebarGroup>
          <SidebarGroupLabel>{t('sidebar.conversations')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {conversations.map((conv) => {
                const exportSft = async () => {
                  const path = await save({ defaultPath: `${conv.title ?? 'chat'}_sft.jsonl`, filters: [{ name: 'JSONL', extensions: ['jsonl'] }] })
                  if (path) await api.exportConversation(conv.id, 'sft', path)
                }
                const exportDpo = async () => {
                  const path = await save({ defaultPath: `${conv.title ?? 'chat'}_dpo.jsonl`, filters: [{ name: 'JSONL', extensions: ['jsonl'] }] })
                  if (path) await api.exportConversation(conv.id, 'dpo', path)
                }
                return (
                  <ContextMenu key={conv.id}>
                    <ContextMenuTrigger render={<SidebarMenuItem />}>
                      <SpotlightCard className="rounded-md">
                        <SidebarMenuButton
                          isActive={conv.id === activeId}
                          onClick={() => onSelect(conv.id)}
                          className={conv.is_archived ? 'opacity-50' : undefined}
                        >
                          {conv.is_archived ? <Archive /> : <MessageSquare />}
                          {renamingConvId === conv.id ? (
                            <InlineRenameInput
                              value={conv.title ?? ''}
                              onSubmit={(v) => { onRename(conv.id, v); setRenamingConvId(null) }}
                              onCancel={() => setRenamingConvId(null)}
                            />
                          ) : (
                            <span className="flex-1 truncate">{conv.title ?? t('sidebar.newChat')}</span>
                          )}
                          <ConversationIndicator conversationId={conv.id} activeId={activeId} />
                        </SidebarMenuButton>
                      </SpotlightCard>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => onTogglePin(conv.id)}>
                        {conv.is_pinned ? <PinOff /> : <Pin />}
                        {conv.is_pinned ? t('contextMenu.unpin') : t('contextMenu.pin')}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => setRenamingConvId(conv.id)}>
                        <Pencil />
                        {t('contextMenu.rename')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={exportSft}>
                        <Download />
                        {t('sidebar.exportSft')}
                      </ContextMenuItem>
                      <ContextMenuItem onClick={exportDpo}>
                        <Download />
                        {t('sidebar.exportDpo')}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget({ type: 'conversation', id: conv.id })}>
                        <Trash2 />
                        {t('sidebar.delete')}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onOpenSettings}>
              <Settings />
              <span>{t('sidebar.settings')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogPopup>
          <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {deleteTarget?.type === 'project' ? t('confirm.deleteProject') : t('confirm.deleteConversation')}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose className="bg-default text-default-foreground hover:bg-default/80">
              {t('common.cancel')}
            </AlertDialogClose>
            <AlertDialogClose
              className="bg-danger text-white hover:bg-danger/80"
              onClick={() => {
                if (deleteTarget?.type === 'conversation') onDelete(deleteTarget.id)
                else if (deleteTarget?.type === 'project') onDeleteProject(deleteTarget.id)
              }}
            >
              {t('common.confirm')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Sidebar>
  )
}
