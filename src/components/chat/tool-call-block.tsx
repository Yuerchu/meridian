import { useTranslation } from 'react-i18next'
import { Wrench, Check, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/api'
import type { ToolCallDisplay } from '@/types'

export function ToolCallBlock({ data }: { data: ToolCallDisplay }) {
  const { t } = useTranslation()

  let parsedArgs: Record<string, unknown> = {}
  try {
    parsedArgs = JSON.parse(data.arguments)
  } catch {
    // ignore
  }

  return (
    <div className="my-3 border border-border rounded-lg overflow-hidden text-xs">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">{data.tool_name}</span>
        {data.status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
        {data.status === 'completed' && <Check className="w-3 h-3 text-green-500 ml-auto" />}
        {data.status === 'denied' && <X className="w-3 h-3 text-destructive ml-auto" />}
      </div>

      <div className="px-3 py-2 space-y-1 text-muted-foreground">
        {Object.entries(parsedArgs).map(([key, value]) => (
          <div key={key}>
            <span className="text-muted-foreground/60">{key}:</span>{' '}
            <span className="text-foreground">{String(value).length > 200 ? `${String(value).slice(0, 200)}...` : String(value)}</span>
          </div>
        ))}
      </div>

      {data.status === 'pending' && (
        <div className="flex gap-2 px-3 py-2 border-t border-border bg-muted/10">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={() => api.approveToolCall(data.call_id)}
          >
            <Check className="w-3 h-3" />
            {t('common.save') === '保存' ? '允许' : 'Allow'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => api.denyToolCall(data.call_id)}
          >
            <X className="w-3 h-3" />
            {t('common.save') === '保存' ? '拒绝' : 'Deny'}
          </Button>
        </div>
      )}

      {data.result && (
        <div className="px-3 py-2 border-t border-border bg-muted/10">
          <pre className="whitespace-pre-wrap text-foreground max-h-40 overflow-y-auto text-[11px]">
            {data.result.length > 1000 ? `${data.result.slice(0, 1000)}...` : data.result}
          </pre>
        </div>
      )}
    </div>
  )
}
