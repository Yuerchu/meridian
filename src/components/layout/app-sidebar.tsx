import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  MessageSquare, MessageCircle, Plus, Settings, Trash2, FolderOpen, FolderPlus,
  Users, Archive, Download, ArrowLeft, Pin, PinOff, Pencil,
  Cloud, Bot, BookTemplate, Smile, Wrench, Plug, Brain, Radio, Settings2, Info,
} from 'lucide-react'
import SpotlightCard from '@/components/SpotlightCard'
import type { Conversation, Project } from '@/types'
import type { SettingsTab } from '@/components/settings'
import { api } from '@/api'
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
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('sidebar.projectName')}
        className="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim() && path.trim()) onSubmit(name.trim(), path.trim())
          else if (e.key === 'Escape') onCancel()
        }}
      />
      <button
        type="button"
        onClick={handleBrowse}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs bg-background border border-border rounded hover:bg-accent/40 transition-colors text-left"
      >
        <FolderOpen className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className={path ? 'text-foreground truncate' : 'text-muted-foreground'}>
          {path || t('sidebar.browsePath')}
        </span>
      </button>
      <div className="flex gap-1">
        <button
          onClick={() => name.trim() && path.trim() && onSubmit(name.trim(), path.trim())}
          disabled={!name.trim() || !path.trim()}
          className="flex-1 px-2 py-1 text-xs bg-accent text-accent-foreground rounded hover:bg-accent/80 disabled:opacity-50"
        >
          {t('common.save')}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded"
        >
          ✕
        </button>
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
  { id: 'templates', labelKey: 'settings.templates', icon: BookTemplate },
  { id: 'emoji', labelKey: 'settings.emoji', icon: Smile },
  { id: 'tools', labelKey: 'settings.toolsTab', icon: Wrench },
  { id: 'mcp', labelKey: 'settings.mcp', icon: Plug },
  { id: 'memories', labelKey: 'settings.memories', icon: Brain },
  { id: 'onebot', labelKey: 'settings.onebot', icon: Radio },
  { id: 'general', labelKey: 'settings.general', icon: Settings2 },
  { id: 'about', labelKey: 'settings.about', icon: Info },
]

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
    <input
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
      className="w-full px-1 py-0 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
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
                {settingsTabs.map((tab) => (
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
            <button
              onClick={() => setShowNewProject(true)}
              className="ml-auto p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
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
                      <SpotlightCard className="rounded-md" spotlightColor="rgba(255, 255, 255, 0.06)">
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
                            <span>{conv.title ?? t('sidebar.newChat')}</span>
                          )}
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
            <AlertDialogClose className="bg-accent text-accent-foreground hover:bg-accent/80">
              {t('common.cancel')}
            </AlertDialogClose>
            <AlertDialogClose
              className="bg-destructive text-white hover:bg-destructive/80"
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
