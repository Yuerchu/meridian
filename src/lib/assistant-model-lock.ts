/** Ways an assistant override can exceed the model it is bound to. */
export type BoundAssistantConflict = 'context' | 'thinking' | 'output'

export function boundAssistantConflicts(input: {
  contextLimit: number
  thinkingEnabled: boolean
  maxTokens: number | null
  modelWindow: number | null
  maxOutput: number | null
  supportsThinking: boolean | null
}): BoundAssistantConflict[] {
  const conflicts: BoundAssistantConflict[] = []
  if (input.modelWindow !== null && input.contextLimit > 0 && input.contextLimit > input.modelWindow) {
    conflicts.push('context')
  }
  if (
    input.maxOutput !== null &&
    input.maxTokens !== null &&
    input.maxTokens > 0 &&
    input.maxTokens > input.maxOutput
  ) {
    conflicts.push('output')
  }
  if (input.supportsThinking === false && input.thinkingEnabled) {
    conflicts.push('thinking')
  }
  return conflicts
}

export interface BoundAssistantConflicts<T> {
  assistant: T
  conflicts: BoundAssistantConflict[]
}

/**
 * Every assistant bound to this provider and model that the proposed model
 * settings would leave unsupported, with the reasons.
 */
export function assistantsWithModelConflicts<
  T extends {
    provider_id: string | null
    model_id: string | null
    context_limit: number
    thinking_enabled: boolean
    max_tokens: number | null
  },
>(
  assistants: T[],
  providerId: string,
  modelId: string,
  next: {
    contextWindow: number
    maxOutput: number | null
    supportsThinking: boolean | null
  },
): BoundAssistantConflicts<T>[] {
  return assistants.flatMap((assistant) => {
    if (assistant.provider_id !== providerId || assistant.model_id !== modelId) return []
    const conflicts = boundAssistantConflicts({
      contextLimit: assistant.context_limit,
      thinkingEnabled: assistant.thinking_enabled,
      maxTokens: assistant.max_tokens,
      modelWindow: next.contextWindow,
      maxOutput: next.maxOutput,
      supportsThinking: next.supportsThinking,
    })
    return conflicts.length > 0 ? [{ assistant, conflicts }] : []
  })
}

export function assistantsUnsupportedByModel<
  T extends {
    provider_id: string | null
    model_id: string | null
    context_limit: number
    thinking_enabled: boolean
    max_tokens: number | null
  },
>(
  assistants: T[],
  providerId: string,
  modelId: string,
  next: {
    contextWindow: number
    maxOutput: number | null
    supportsThinking: boolean | null
  },
): T[] {
  return assistantsWithModelConflicts(assistants, providerId, modelId, next).map((entry) => entry.assistant)
}
