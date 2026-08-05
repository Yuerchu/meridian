import * as React from "react"
import { Disclosure } from "@heroui/react"
import { cva, type VariantProps } from "class-variance-authority"
import {
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
  "flex w-full flex-col overflow-hidden rounded-xl border bg-surface/30 text-xs",
  {
    variants: {
      state: {
        "input-streaming": "border-border",
        "input-available": "border-border",
        "output-available": "border-border",
        "output-error": "border-danger/40",
        "requires-action": "border-warning/40",
      },
    },
    defaultVariants: {
      state: "input-available",
    },
  }
)

interface ChatToolProps
  extends React.ComponentProps<typeof Disclosure>,
    VariantProps<typeof chatToolVariants> {}

function ChatTool({ state, className, ...props }: ChatToolProps) {
  return (
    <ChatToolStateContext.Provider value={state ?? "input-available"}>
      <Disclosure
        data-slot="chat-tool"
        className={cn(chatToolVariants({ state }), className)}
        {...props}
      />
    </ChatToolStateContext.Provider>
  )
}

interface ChatToolTriggerProps
  extends Omit<React.ComponentProps<typeof Disclosure.Trigger>, "children"> {
  /**
   * Pinned to the right edge, just left of the chevron — a progress count, a
   * duration, a badge. Use this rather than an `ml-auto` child: the label row
   * already absorbs the free space, and a second auto margin would split it
   * between the two instead of pushing everything over.
   */
  endContent?: React.ReactNode
  // Narrower than HeroUI's, which also accepts a render function: this trigger
  // lays its children out in a label row, and a function has nothing to lay out.
  children?: React.ReactNode
}

function ChatToolTrigger({ className, children, endContent, ...props }: ChatToolTriggerProps) {
  return (
    <Disclosure.Heading>
      {/* `flex` is not optional: HeroUI styles the indicator with `ms-auto` and
          `shrink-0`, which only mean anything inside a flex container. */}
      <Disclosure.Trigger
        data-slot="chat-tool-trigger"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30",
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
        <Disclosure.Indicator className="size-3.5 shrink-0 text-muted" />
      </Disclosure.Trigger>
    </Disclosure.Heading>
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
          className={cn("size-3.5 shrink-0 animate-spin text-muted", className)}
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
          className={cn("size-3.5 shrink-0 text-danger", className)}
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

function ChatToolContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Disclosure.Content>) {
  return (
    // `min-h-0` is load-bearing: the card is a flex column, and a flex item's
    // default `min-height: auto` floors it at its content height — so the panel
    // would take `height: 0` and still render full size.
    <Disclosure.Content data-slot="chat-tool-content" className="min-h-0 w-full" {...props}>
      {/* Body, not a plain div: it is what keeps the panel measurable, so
          without it the content never collapses — it just loses its
          `aria-expanded`. */}
      <Disclosure.Body className={cn("flex flex-col gap-2 px-2.5 pb-2.5", className)}>
        {children}
      </Disclosure.Body>
    </Disclosure.Content>
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
      className={cn("max-h-40 overflow-auto rounded-lg bg-default/40 px-3 py-2", className)}
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
      className={cn("max-h-60 overflow-auto rounded-lg bg-default/40 px-3 py-2", className)}
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
      className={cn("px-0.5 whitespace-pre-wrap text-danger", className)}
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

function ChatToolGroup({ className, ...props }: React.ComponentProps<typeof Disclosure>) {
  return (
    <Disclosure
      data-slot="chat-tool-group"
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface/30 text-xs",
        className
      )}
      {...props}
    />
  )
}

function ChatToolGroupTrigger({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Disclosure.Trigger>, "children"> & {
  children?: React.ReactNode
}) {
  return (
    <Disclosure.Heading>
      <Disclosure.Trigger
        data-slot="chat-tool-group-trigger"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-foreground transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30",
          className
        )}
        {...props}
      >
        {children}
        {/* The indicator carries `ms-auto` of its own, which is what the hand-
            written chevron used `ml-auto` for. */}
        <Disclosure.Indicator className="size-3.5 shrink-0 text-muted" />
      </Disclosure.Trigger>
    </Disclosure.Heading>
  )
}

function ChatToolGroupContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Disclosure.Content>) {
  return (
    <Disclosure.Content data-slot="chat-tool-group-content" className="min-h-0 w-full" {...props}>
      <Disclosure.Body className={cn("flex flex-col gap-2 px-2.5 pb-2.5", className)}>
        {children}
      </Disclosure.Body>
    </Disclosure.Content>
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
