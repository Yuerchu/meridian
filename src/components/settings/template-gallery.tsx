import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, BookTemplate, Sparkles, Code, Trash2 } from 'lucide-react'
import { Button, Disclosure, Input, ListBox, Select, TextArea } from '@heroui/react'
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
  const Icon = CATEGORY_ICONS[template.category] ?? BookTemplate

  return (
    <Disclosure className="flex w-full flex-col overflow-hidden rounded-lg border border-border">
      <Disclosure.Heading>
        {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto`
            and `shrink-0`, which only mean anything inside a flex container.
            `text-start` undoes the button element's centred UA default. */}
        <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30">
          <Icon className="w-3.5 h-3.5 shrink-0 text-muted" />
          <span className="flex-1 truncate">{template.name}</span>
          {template.is_builtin === 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-default text-muted shrink-0">
              {t('settings.template.builtin')}
            </span>
          )}
          <Disclosure.Indicator className="size-4 shrink-0 text-muted" />
        </Disclosure.Trigger>
      </Disclosure.Heading>
      {/* `min-h-0` is load-bearing: the card is a flex column, and a flex item's
          default `min-height: auto` floors it at its content height. */}
      <Disclosure.Content className="min-h-0 w-full">
        {/* Body, not a plain wrapper: it is what keeps the panel measurable, so
            without it the content never collapses. */}
        <Disclosure.Body className="space-y-2">
          {template.description && (
            <p className="text-xs text-muted">{template.description}</p>
          )}
          {/* The reader is the only thing in here, so the scroller has to be its
              own tab stop — otherwise a keyboard user cannot reach the text. */}
          <pre
            data-slot="template-preview"
            tabIndex={0}
            className="max-h-40 overflow-y-auto overscroll-contain text-xs bg-default/30 rounded-md p-2.5 whitespace-pre-wrap break-words font-mono leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-focus/50"
          >
            {template.template_text}
          </pre>
          <div className="flex items-center gap-2 pt-1">
            {onApply && (
              <Button onClick={() => onApply(template.template_text)}>
                {t('settings.template.apply')}
              </Button>
            )}
            {onDelete && template.is_builtin === 0 && (
              <Button
                variant="ghost"
                className="ml-auto text-danger hover:text-danger"
                onClick={() => onDelete(template.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
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

  const categoryOptions = [
    { value: 'general', label: t('settings.template.categoryGeneral') },
    { value: 'character', label: t('settings.template.categoryCharacter') },
    { value: 'coding', label: t('settings.template.categoryCoding') },
  ]

  return (
    <div className="space-y-3 border border-border rounded-lg p-3">
      <div className="grid grid-cols-2 gap-2">
        <Input fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.template.name')}
        />
        <Select value={category} onChange={(v) => { if (v) setCategory(String(v)) }}>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {categoryOptions.map((o) => (
                <ListBox.Item key={o.value} id={o.value} textValue={o.label}>
                  {o.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <TextArea fullWidth
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('settings.template.content')}
        rows={4}
        className="resize-none font-mono text-xs"
      />
      <Button onClick={handleCreate} isDisabled={!name.trim() || !text.trim()}>
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
    return <div className="text-muted text-sm">{t('common.loading')}</div>
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">{t('settings.template.title')}</h2>
          <p className="text-xs text-muted mt-1">{t('settings.template.subtitle')}</p>
        </div>
        <Button variant="outline" onClick={() => setShowCreate(!showCreate)}>
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
        <h3 className="text-sm font-medium text-muted">{t('settings.template.variables')}</h3>
        <p className="text-xs text-muted/70">{t('settings.template.variablesHint')}</p>
        <div className="grid grid-cols-1 gap-1">
          {variables.map((v) => (
            <div key={v.name} className="flex items-center gap-2 text-xs">
              <code className="bg-default/50 px-1.5 py-0.5 rounded font-mono text-xs">
                {`{{${v.name}}}`}
              </code>
              <span className="text-muted">
                {isZh ? v.description_zh : v.description_en}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
