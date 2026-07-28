import * as React from "react"
import { Collapsible } from "@base-ui/react/collapsible"
import { cva, type VariantProps } from "class-variance-authority"
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  Loader2Icon,
} from "lucide-react"
import hljs from "highlight.js/lib/core"
import jsonLang from "highlight.js/lib/languages/json"

import { cn } from "@/lib/utils"

hljs.registerLanguage("json", jsonLang)

type ChatToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "requires-action"

const ChatToolStateContext = React.createContext<ChatToolState>("input-available")

const chatToolVariants = cva(
  "flex w-full flex-col overflow-hidden rounded-xl border bg-card/30 text-xs",
  {
    variants: {
      state: {
        "input-streaming": "border-border",
        "input-available": "border-border",
        "output-available": "border-border",
        "output-error": "border-destructive/40",
        "requires-action": "border-warning/40",
      },
    },
    defaultVariants: {
      state: "input-available",
    },
  }
)

interface ChatToolProps
  extends Collapsible.Root.Props,
    VariantProps<typeof chatToolVariants> {}

function ChatTool({ state, className, ...props }: ChatToolProps) {
  return (
    <ChatToolStateContext.Provider value={state ?? "input-available"}>
      <Collapsible.Root
        data-slot="chat-tool"
        className={cn(chatToolVariants({ state }), className)}
        {...props}
      />
    </ChatToolStateContext.Provider>
  )
}

interface ChatToolTriggerProps extends Collapsible.Trigger.Props {
  /**
   * Pinned to the right edge, just left of the chevron — a progress count, a
   * duration, a badge. Use this rather than an `ml-auto` child: the label row
   * already absorbs the free space, and a second auto margin would split it
   * between the two instead of pushing everything over.
   */
  endContent?: React.ReactNode
}

function ChatToolTrigger({ className, children, endContent, ...props }: ChatToolTriggerProps) {
  return (
    <Collapsible.Trigger
      data-slot="chat-tool-trigger"
      className={cn(
        "group/chat-tool-trigger flex w-full items-center gap-2 px-3 py-2 text-left transition-colors outline-none hover:bg-muted/30 focus-visible:bg-muted/30",
        className
      )}
      {...props}
    >
      <div
        data-slot="chat-tool-trigger-label"
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        {children}
      </div>
      {endContent}
      <ChevronDownIcon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/chat-tool-trigger:rotate-180"
      />
    </Collapsible.Trigger>
  )
}

function ChatToolStatusIcon({ className }: { className?: string }) {
  const state = React.useContext(ChatToolStateContext)
  switch (state) {
    case "input-streaming":
    case "input-available":
      return (
        <Loader2Icon
          aria-hidden
          className={cn("size-3.5 shrink-0 animate-spin text-muted-foreground", className)}
        />
      )
    case "output-available":
      return (
        <CircleCheckIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-success", className)}
        />
      )
    case "output-error":
      return (
        <CircleXIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-destructive", className)}
        />
      )
    case "requires-action":
      return (
        <CircleAlertIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-warning", className)}
        />
      )
  }
}

function ChatToolContent({ className, children, ...props }: Collapsible.Panel.Props) {
  return (
    <Collapsible.Panel
      data-slot="chat-tool-content"
      className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0"
      {...props}
    >
      <div className={cn("flex flex-col gap-2 px-2.5 pb-2.5", className)}>{children}</div>
    </Collapsible.Panel>
  )
}

// hljs escapes non-token text itself, so the highlighted HTML is safe to inject.
function JsonCode({ code }: { code: string }) {
  const html = React.useMemo(
    () => hljs.highlight(code, { language: "json", ignoreIllegals: true }).value,
    [code]
  )
  return <code dangerouslySetInnerHTML={{ __html: html }} />
}

interface ChatToolPayloadProps extends React.ComponentProps<"div"> {
  // Structured value, rendered as JSON.
  value?: unknown
  // Preformatted text, useful while streaming partial JSON. Takes precedence.
  text?: string
}

function ChatToolArgs({ value, text, className, children, ...props }: ChatToolPayloadProps) {
  const code = text ?? (value !== undefined ? JSON.stringify(value) : undefined)
  return (
    <div
      data-slot="chat-tool-args"
      className={cn("max-h-40 overflow-auto rounded-lg bg-muted/40 px-3 py-2", className)}
      {...props}
    >
      {children ??
        (code !== undefined && (
          <pre className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-foreground/90">
            <JsonCode code={code} />
          </pre>
        ))}
    </div>
  )
}

function ChatToolResult({ value, text, className, children, ...props }: ChatToolPayloadProps) {
  const code = text ?? (value !== undefined ? JSON.stringify(value, null, 2) : undefined)
  return (
    <div
      data-slot="chat-tool-result"
      className={cn("max-h-60 overflow-auto rounded-lg bg-muted/40 px-3 py-2", className)}
      {...props}
    >
      {children ??
        (code !== undefined && (
          <pre className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-foreground/90">
            <JsonCode code={code} />
          </pre>
        ))}
    </div>
  )
}

function ChatToolError({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chat-tool-error"
      className={cn("px-0.5 whitespace-pre-wrap text-destructive", className)}
      {...props}
    />
  )
}

function ChatToolApproval({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chat-tool-approval"
      className={cn("flex items-center justify-end gap-2 pt-1", className)}
      {...props}
    />
  )
}

function ChatToolGroup({ className, ...props }: Collapsible.Root.Props) {
  return (
    <Collapsible.Root
      data-slot="chat-tool-group"
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card/30 text-xs",
        className
      )}
      {...props}
    />
  )
}

function ChatToolGroupTrigger({ className, children, ...props }: Collapsible.Trigger.Props) {
  return (
    <Collapsible.Trigger
      data-slot="chat-tool-group-trigger"
      className={cn(
        "group/chat-tool-group-trigger flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-foreground transition-colors outline-none hover:bg-muted/30 focus-visible:bg-muted/30",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden
        className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/chat-tool-group-trigger:rotate-180"
      />
    </Collapsible.Trigger>
  )
}

function ChatToolGroupContent({ className, children, ...props }: Collapsible.Panel.Props) {
  return (
    <Collapsible.Panel
      data-slot="chat-tool-group-content"
      className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0"
      {...props}
    >
      <div className={cn("flex flex-col gap-2 px-2.5 pb-2.5", className)}>{children}</div>
    </Collapsible.Panel>
  )
}

export {
  ChatTool,
  ChatToolTrigger,
  ChatToolStatusIcon,
  ChatToolContent,
  ChatToolArgs,
  ChatToolResult,
  ChatToolError,
  ChatToolApproval,
  ChatToolGroup,
  ChatToolGroupTrigger,
  ChatToolGroupContent,
  chatToolVariants,
  type ChatToolState,
}
