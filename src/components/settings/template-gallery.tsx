import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ChevronDown, ChevronRight, BookTemplate, Sparkles, Code, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/api'
import type { PromptTemplate, TemplateVariable } from '@/types'

const CATEGORY_ICONS: Record<string, typeof BookTemplate> = {
  general: BookTemplate,
  character: Sparkles,
  coding: Code,
}

function TemplateCard({
  template,
  onApply,
  onDelete,
}: {
  template: PromptTemplate
  onApply?: (text: string) => void
  onDelete?: (id: string) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const Icon = CATEGORY_ICONS[template.category] ?? BookTemplate

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="flex-1 truncate">{template.name}</span>
        {template.is_builtin === 1 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground flex-shrink-0">
            {t('settings.template.builtin')}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {template.description && (
            <p className="text-xs text-muted-foreground">{template.description}</p>
          )}
          <pre className="text-xs bg-accent/30 rounded-md p-2.5 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-mono leading-relaxed">
            {template.template_text}
          </pre>
          <div className="flex items-center gap-2 pt-1">
            {onApply && (
              <Button size="sm" onClick={() => onApply(template.template_text)}>
                {t('settings.template.apply')}
              </Button>
            )}
            {onDelete && template.is_builtin === 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => onDelete(template.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TemplateCreator({
  onCreated,
}: {
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('general')
  const [text, setText] = useState('')

  async function handleCreate() {
    if (!name.trim() || !text.trim()) return
    await api.createPromptTemplate(name.trim(), category, text)
    setName('')
    setText('')
    onCreated()
  }

  return (
    <div className="space-y-3 border border-border rounded-lg p-3">
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.template.name')}
        />
        <Select value={category} onValueChange={(v) => { if (v) setCategory(v) }}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="general">{t('settings.template.categoryGeneral')}</SelectItem>
            <SelectItem value="character">{t('settings.template.categoryCharacter')}</SelectItem>
            <SelectItem value="coding">{t('settings.template.categoryCoding')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('settings.template.content')}
        rows={4}
        className="resize-none font-mono text-xs"
      />
      <Button size="sm" onClick={handleCreate} disabled={!name.trim() || !text.trim()}>
        {t('common.save')}
      </Button>
    </div>
  )
}

export function TemplateGallery({
  onApply,
}: {
  onApply?: (text: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [variables, setVariables] = useState<TemplateVariable[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const isZh = i18n.language.startsWith('zh')

  const refresh = useCallback(async () => {
    const [tpls, vars] = await Promise.all([
      api.listPromptTemplates(),
      api.listTemplateVariables(),
    ])
    setTemplates(tpls)
    setVariables(vars)
  }, [])

  useEffect(() => {
    refresh().then(() => setLoading(false))
  }, [refresh])

  const handleDelete = useCallback(async (id: string) => {
    await api.deletePromptTemplate(id)
    await refresh()
  }, [refresh])

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t('common.loading')}</div>
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">{t('settings.template.title')}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t('settings.template.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-3.5 h-3.5" />
          {t('settings.template.new')}
        </Button>
      </div>

      {showCreate && (
        <TemplateCreator onCreated={() => { setShowCreate(false); refresh() }} />
      )}

      <div className="space-y-1">
        {templates.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            template={tpl}
            onApply={onApply}
            onDelete={handleDelete}
          />
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">{t('settings.template.variables')}</h3>
        <p className="text-[11px] text-muted-foreground/70">{t('settings.template.variablesHint')}</p>
        <div className="grid grid-cols-1 gap-1">
          {variables.map((v) => (
            <div key={v.name} className="flex items-center gap-2 text-xs">
              <code className="bg-accent/50 px-1.5 py-0.5 rounded font-mono text-[11px]">
                {`{{${v.name}}}`}
              </code>
              <span className="text-muted-foreground">
                {isZh ? v.description_zh : v.description_en}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
