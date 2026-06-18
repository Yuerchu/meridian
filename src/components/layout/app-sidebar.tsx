import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { open, save } from '@tauri-apps/plugin-dialog'
import { MessageSquare, MessageCircle, Plus, Settings, Trash2, FolderOpen, FolderPlus, Users, Archive, MoreHorizontal, Download } from 'lucide-react'
import type { Conversation, Project } from '@/types'
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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface AppSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, path: string) => void
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

export function AppSidebar({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onOpenSettings,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
}: AppSidebarProps) {
  const { t } = useTranslation()
  const [showNewProject, setShowNewProject] = useState(false)

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
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    isActive={project.id === activeProjectId}
                    onClick={() => onSelectProject(project.id)}
                  >
                    <ProjectIcon sourceType={project.source_type} />
                    <span>{project.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
              {conversations.map((conv) => (
                <SidebarMenuItem key={conv.id}>
                  <SidebarMenuButton
                    isActive={conv.id === activeId}
                    onClick={() => onSelect(conv.id)}
                    className={conv.is_archived ? 'opacity-50' : undefined}
                  >
                    {conv.is_archived ? <Archive /> : <MessageSquare />}
                    <span>{conv.title ?? t('sidebar.newChat')}</span>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<SidebarMenuAction />}>
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start">
                      <DropdownMenuItem onClick={async () => {
                        const path = await save({ defaultPath: `${conv.title ?? 'chat'}_sft.jsonl`, filters: [{ name: 'JSONL', extensions: ['jsonl'] }] })
                        if (path) await api.exportConversation(conv.id, 'sft', path)
                      }}>
                        <Download />
                        {t('sidebar.exportSft')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => {
                        const path = await save({ defaultPath: `${conv.title ?? 'chat'}_dpo.jsonl`, filters: [{ name: 'JSONL', extensions: ['jsonl'] }] })
                        if (path) await api.exportConversation(conv.id, 'dpo', path)
                      }}>
                        <Download />
                        {t('sidebar.exportDpo')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => onDelete(conv.id)}>
                        <Trash2 />
                        {t('sidebar.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              ))}
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
    </Sidebar>
  )
}
