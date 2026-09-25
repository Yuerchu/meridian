import { describe, expect, it, vi } from 'vitest'
import { invokeResponseSchemaDocument } from '@/lib/invoke-response-schema.generated'
import { hydrateBlocks } from '@/stores/conversation-store'
import type { ConversationSnapshotResponse, PreferenceKey, UsageDimension } from '@/types'
import { APPROVAL, CONV, PLAN_REVIEW_ID, PROJECT_MERIDIAN, STICKERS } from './conversations'
import { createDemoBackend, type DemoArgs } from './index'
import { DEMO_HANDLERS } from './handlers'
import { PROVIDER } from './settings'

/**
 * The fixtures are held to the same contract as the backend: every answer goes
 * through `assertInvokeResponse` inside `backend.invoke`, and every event
 * through `parseAppEventPayload` inside `emit`. So a fixture that drifts — a
 * price written as a number, a field the schema no longer has — turns this red
 * rather than turning up as a page that renders wrong.
 */

const DECIMAL_ZERO_PRICE = { input_price: null, output_price: null, cache_read_price: null, cache_write_price: null }

/** One call per handler. `reject` marks a handler whose whole job is to refuse. */
const SAMPLES: Record<string, { args?: DemoArgs; reject?: true }> = {
  list_conversations: { args: { archived: false } },
  list_conversations_by_project: { args: { request: { projectId: PROJECT_MERIDIAN, archived: false } } },
  create_conversation: { args: { request: { title: 'x', projectId: null } } },
  update_conversation_title: { args: { request: { id: CONV.rich, title: 'renamed' } } },
  set_conversation_assistant: { args: { request: { id: CONV.rich, assistantId: null } } },
  set_conversation_reasoning_prefs: { args: { request: { id: CONV.rich, thinkingLevel: 'low', fastMode: false } } },
  set_conversation_mode: { args: { request: { id: CONV.rich, mode: 'plan' } } },
  set_conversation_accept_edits: { args: { request: { id: CONV.rich, acceptEdits: true } } },
  set_conversation_project: { args: { request: { id: CONV.rich, projectId: null } } },
  toggle_pin_conversation: { args: { id: CONV.rich } },
  toggle_archive_conversation: { args: { id: CONV.rich } },
  delete_conversation: { args: { id: CONV.rich } },
  search_conversations: { args: { request: { query: '滚动', limit: 10 } } },
  conversation_snapshot: { args: { request: { conversationId: CONV.rich } } },
  switch_branch: { args: { request: { conversationId: CONV.rich, messageId: `${CONV.rich}-m6` } } },
  delete_message: { args: { request: { conversationId: CONV.rich, id: `${CONV.rich}-m6` } } },
  rate_message: { args: { request: { id: `${CONV.rich}-m4`, rating: -1 } } },
  read_message_context_item: { args: { request: { conversationId: CONV.rich, itemId: 'demo-ctx-scroller' } } },
  get_context_info: { args: { conversationId: CONV.rich } },
  get_active_todo_list: { args: { conversationId: CONV.rich } },
  compact: { args: { request: { conversationId: CONV.rich, customInstructions: null } } },
  export_conversation: { args: { request: { conversationId: CONV.rich, format: 'sft', outputPath: null } } },
  get_user_command_result: { args: { request: { conversationId: CONV.stickers, messageId: `${CONV.stickers}-m3` } } },
  active_user_shell_turn: { args: { conversationId: CONV.stickers } },
  chat: {
    args: {
      request: {
        conversationId: CONV.pinned,
        message: 'hi',
        turnId: 'demo-test-turn',
        replaces: null,
        modelOverride: null,
        providerOverride: null,
        thinkingLevel: null,
        assistantId: null,
        fast: null,
        mode: null,
        voice: null,
        contextRefs: [],
        conversationRefs: [],
      },
    },
  },
  stop_chat: { args: { request: { conversationId: CONV.pinned, turnId: null } } },
  steer_conversation: { args: { request: { conversationId: CONV.pinned, text: 'x' } }, reject: true },
  approve_tool_call: { args: { approvalId: APPROVAL.command } },
  deny_tool_call: { args: { request: { approvalId: APPROVAL.command, reason: null } } },
  respond_to_ask: { args: { request: { approvalId: APPROVAL.ask, response: '{"format":"JSON"}' } } },
  all_pending_approvals: {},
  run_user_command: {
    args: { request: { conversationId: CONV.stickers, turnId: 't', command: 'ls', retryWithoutSandbox: null } },
  },
  upload_file: { args: { request: { conversationId: CONV.rich, filePath: 'C:\\a\\b.txt' } } },
  upload_file_bytes: { args: { request: { conversationId: CONV.rich, fileName: 'a.png', dataBase64: 'AAAA' } } },
  get_composer_draft: { args: { request: { conversationId: null } } },
  save_composer_draft: {
    args: {
      request: {
        conversationId: CONV.rich,
        body: 'draft',
        attachments: [],
        conversationRefs: [CONV.pinned],
        stickerId: STICKERS.cat,
        revision: 1,
      },
    },
  },
  clear_composer_draft: { args: { request: { conversationId: CONV.rich, revision: 2 } } },
  queue_list: { args: { conversationId: CONV.rich } },
  queue_enqueue: {
    args: {
      request: {
        conversationId: CONV.rich,
        content: 'x',
        delivery: 'follow_up',
        contextRefs: null,
        conversationRefs: null,
      },
    },
  },
  queue_remove: { args: { request: { conversationId: CONV.rich, id: 'none' } } },
  get_plan_review: { args: { request: { reviewId: PLAN_REVIEW_ID } } },
  list_plan_revisions: { args: { request: { documentId: 'demo-plan-document' } } },
  get_plan_review_delivery: { args: { request: { reviewId: PLAN_REVIEW_ID } } },
  save_plan_review_draft: {
    args: { request: { reviewId: PLAN_REVIEW_ID, expectedGeneration: 0, normalizedMarkdown: '# x', globalNote: null } },
  },
  discard_plan_review_draft: { args: { request: { reviewId: PLAN_REVIEW_ID, expectedGeneration: 0 } } },
  decide_plan_review: {
    args: {
      request: {
        reviewId: PLAN_REVIEW_ID,
        decisionId: 'd',
        expectedGeneration: 0,
        expectedDraftHash: 'x',
        action: 'approve',
      },
    },
  },
  list_projects: {},
  create_project: {
    args: {
      request: { name: 'p', path: null, sourceType: 'local', sourceId: null, assistantId: null, description: null },
    },
  },
  update_project: { args: { request: { id: PROJECT_MERIDIAN, name: 'renamed' } } },
  delete_project: { args: { id: PROJECT_MERIDIAN } },
  workspace_root: { args: { request: { conversationId: CONV.rich } } },
  workspace_tree: { args: { request: { conversationId: CONV.rich, dir: null } } },
  workspace_read_file: { args: { request: { conversationId: CONV.rich, relPath: 'README.md' } } },
  workspace_probe_ref: { args: { request: { conversationId: CONV.rich, projectId: null, path: 'README.md' } } },
  workspace_resolve_ref: {
    args: {
      request: { conversationId: CONV.rich, projectId: null, path: 'README.md', lineStart: null, lineEnd: null },
    },
  },
  workspace_suggest_refs: {
    args: { request: { conversationId: CONV.rich, projectId: null, query: 'src', limit: null } },
  },
  workspace_git_status: { args: { request: { conversationId: CONV.rich } } },
  workspace_git_diff: { args: { request: { conversationId: CONV.rich, relPath: null } } },
  open_in_editor: { args: { request: { conversationId: CONV.rich, relPath: 'README.md', line: null } }, reject: true },
  list_providers: {},
  list_provider_catalog: {},
  codex_auth_status: {},
  create_provider: {
    args: {
      request: {
        name: 'n',
        providerType: 'openai',
        baseUrl: 'https://x',
        apiFormat: null,
        catalogId: null,
        authOption: null,
      },
    },
  },
  update_provider: { args: { request: { id: PROVIDER.anthropic, name: 'A', isEnabled: false } } },
  delete_provider: { args: { id: PROVIDER.relay } },
  set_provider_key: { args: { request: { providerId: PROVIDER.relay, apiKey: 'k' } } },
  get_provider_key_exists: { args: { providerId: PROVIDER.anthropic } },
  fetch_provider_models: { args: { request: { providerId: PROVIDER.anthropic, forceRefresh: null } } },
  list_cached_provider_models: { args: { request: { providerId: PROVIDER.anthropic } } },
  get_provider_capabilities: { args: { request: { providerId: PROVIDER.anthropic, modelId: 'claude-sonnet-5' } } },
  get_provider_balance: { args: { providerId: PROVIDER.deepseek } },
  list_model_configs: { args: { providerId: PROVIDER.anthropic } },
  list_model_profiles: {},
  get_model_config: { args: { request: { providerId: PROVIDER.anthropic, modelId: 'claude-sonnet-5' } } },
  save_model_config: {
    args: {
      request: {
        provider_id: PROVIDER.anthropic,
        model_id: 'claude-opus-5',
        profile: {
          id: null,
          name: 'Claude Opus 5',
          context_window: 200_000,
          compact_threshold: 160_000,
          max_output_tokens: null,
          input_price: '5',
          output_price: '25',
          cache_read_price: null,
          cache_write_price: null,
          pricing_tiers: [],
          capability_overrides: null,
        },
        overrides_pricing: false,
        ...DECIMAL_ZERO_PRICE,
        pricing_tiers: [],
        server_tools: null,
        server_tool_price: null,
      },
    },
  },
  delete_model_config: { args: { id: 'demo-model-haiku' } },
  usage_report: {
    args: { request: { dimension: 'total', sinceMs: null, untilMs: null, origin: null, conversationId: null } },
  },
  list_assistants: {},
  create_assistant: {
    args: { request: { name: 'a', systemPrompt: '', modelId: null, temperature: null, topP: null, maxTokens: null } },
  },
  update_assistant: { args: { request: { id: 'demo-assistant-default', contextLimit: 100_000 } } },
  delete_assistant: { args: { id: 'demo-assistant-writer' } },
  list_tool_categories: {},
  list_custom_tools: {},
  delete_custom_tool: { args: { id: 'demo-tool-typecheck' } },
  list_tool_presets: {},
  delete_tool_preset: { args: { id: 'demo-preset-coding' } },
  list_all_tool_names: {},
  list_skills: {},
  rescan_skills: {},
  get_skill_body: { args: { dirName: 'commit-message' } },
  update_skill: { args: { request: { dirName: 'commit-message', isEnabled: false } } },
  list_skill_bindings: { args: { request: { layer: 'global', anchorId: null } } },
  set_skill_binding: { args: { request: { layer: 'global', anchorId: null, dirName: 'commit-message', bound: true } } },
  list_template_variables: {},
  list_mcp_servers: {},
  create_mcp_server: {
    args: {
      request: { name: 'm', transportType: 'stdio', command: 'x', args: null, env: null, url: null, headers: null },
    },
  },
  update_mcp_server: { args: { request: { id: 'demo-mcp-sqlite', isEnabled: true } } },
  delete_mcp_server: { args: { id: 'demo-mcp-sqlite' } },
  connect_mcp_server: { args: { id: 'demo-mcp-sqlite' } },
  disconnect_mcp_server: { args: { id: 'demo-mcp-github' } },
  list_mcp_tools: { args: { serverId: null } },
  list_mcp_connection_statuses: {},
  list_all_memories: {},
  list_memories: { args: { projectId: PROJECT_MERIDIAN } },
  list_memory_subjects: {},
  list_memory_trash: { args: { limit: null } },
  memory_enums: {},
  save_memory_scoped: {
    args: {
      request: {
        scope: 'client_global',
        projectId: null,
        subjectScopeId: null,
        key: 'k',
        content: 'c',
        memoryType: null,
        ownerOnly: null,
      },
    },
  },
  update_memory: { args: { request: { id: 'demo-mem-1', content: 'changed' } } },
  delete_memories: { args: { ids: ['demo-mem-1'] } },
  delete_memory: { args: { id: 'demo-mem-2' } },
  restore_memories: { args: { ids: ['demo-mem-trash-1'] } },
  purge_memories: { args: { ids: ['demo-mem-trash-1'] } },
  forget_memory_subject: { args: { subjectScopeId: 'onebot:10002' } },
  set_memory_subject_flags: { args: { request: { subjectScopeId: 'onebot:10002', isPinned: true, optedOut: null } } },
  get_platform: {},
  get_window_insets: {},
  get_app_info: {},
  get_secret: { args: { request: { key: 'REMOTE_TOKEN' } } },
  get_preference: { args: { request: { key: 'shell' } } },
  set_preference: { args: { request: { key: 'autoreview.model', value: { providerId: 'p', modelId: 'm' } } } },
  get_service_key_exists: { args: { service: 'TAVILY' } },
  set_service_key: { args: { request: { service: 'FISH_AUDIO', key: 'k' } } },
  read_logs: {
    args: {
      request: {
        minLevel: 'warn',
        limit: null,
        contains: null,
        targetPrefix: null,
        conversationId: null,
        sinceTsMs: null,
        untilTsMs: null,
        cursor: null,
      },
    },
  },
  list_log_files: {},
  get_log_settings: {},
  set_log_level: { args: { request: { level: 'debug' } } },
  export_logs: { args: { request: { outputPath: 'x' } } },
  get_onebot_config: {},
  save_onebot_config: {
    args: {
      request: {
        enabled: false,
        host: '127.0.0.1',
        port: 6700,
        access_token: null,
        assistant_id: null,
        admin_users: [],
        ack_emoji_id: '124',
        voice_capture_sessions: [],
        voice_send_enabled: false,
        voice_send_groups: [],
        voice_tts_model: '',
        voice_tts_reference_id: '',
      },
    },
  },
  get_onebot_status: {},
  start_onebot: {},
  stop_onebot: {},
  get_voice_send_readiness: {},
  list_voice_corpus: {},
  voice_model_status: {},
  get_hooks_config: {},
  save_hooks_config: {
    args: {
      request: {
        enabled: false,
        host: '127.0.0.1',
        port: 1,
        token: null,
        review_model: null,
        assistant_id: null,
        timeout_secs: 10,
        max_rounds: 0,
      },
    },
  },
  get_hooks_status: {},
  get_listen_config: {},
  get_listen_status: {},
  get_listen_addresses: {},
  get_ime_status: {},
  get_ime_config: {},
  save_ime_config: {
    args: {
      request: {
        scheme: 'zhuyin',
        page_size: 5,
        punctuation: 'half_width',
        learning: false,
        private_apps: [],
        debug_log: true,
        context_apps: [],
      },
    },
  },
  list_ime_dictionaries: {},
  set_ime_dictionary_enabled: { args: { request: { file: 'tech.dict', enabled: true } } },
  get_ime_lm_status: {},
  refresh_ime_memory_hints: {},
  acp_get_config: {},
  list_emoji_packs: {},
  list_assistant_emoji_packs: { args: { assistantId: 'demo-assistant-default' } },
  list_emojis: { args: { packId: 'demo-pack-daily' } },
  search_emojis: { args: { query: '猫' } },
  get_emoji_file_url: { args: { emojiId: STICKERS.cat } },
  rename_emoji: { args: { request: { id: STICKERS.cat, newName: '猫' } } },
}

describe('demo fixtures', () => {
  it('has a sample call for every handler', () => {
    expect(Object.keys(DEMO_HANDLERS).filter((name) => !(name in SAMPLES))).toEqual([])
    expect(Object.keys(SAMPLES).filter((name) => !(name in DEMO_HANDLERS))).toEqual([])
  })

  it('only answers commands the response schema knows', () => {
    expect(Object.keys(DEMO_HANDLERS).filter((name) => !(name in invokeResponseSchemaDocument.commands))).toEqual([])
  })

  it.each(Object.entries(SAMPLES))('%s answers within the response contract', async (command, sample) => {
    const backend = createDemoBackend()
    const call = backend.invoke(command, sample.args)
    if (sample.reject) await expect(call).rejects.toBeTypeOf('string')
    else await call
  })

  it('answers every other command with a valid empty result or DemoUnsupported', async () => {
    const backend = createDemoBackend()
    for (const command of Object.keys(invokeResponseSchemaDocument.commands)) {
      if (command in DEMO_HANDLERS) continue
      try {
        await backend.invoke(command, command === 'get_preference' ? { request: { key: 'shell' } } : {})
      } catch (error) {
        expect(error, command).toMatch(/^DemoUnsupported: /)
      }
    }
  })

  it('snapshots every conversation within the contract and the store own checks', async () => {
    const backend = createDemoBackend()
    for (const conversation of backend.state.conversations) {
      const snapshot = (await backend.invoke('conversation_snapshot', {
        request: { conversationId: conversation.id },
      })) as ConversationSnapshotResponse
      expect(() =>
        hydrateBlocks(
          snapshot.tree.messages,
          snapshot.pending_approvals,
          snapshot.turns,
          snapshot.sub_agent_runs,
          snapshot.plan_reviews,
        ),
      ).not.toThrow()
    }
  })

  it('answers every preference key and usage dimension', async () => {
    const backend = createDemoBackend()
    for (const key of Object.keys(backend.state.preferences) as PreferenceKey[]) {
      await backend.invoke('get_preference', { request: { key } })
    }
    const dimensions: UsageDimension[] = [
      'total',
      'provider',
      'model',
      'bot',
      'source',
      'conversation',
      'day',
      'hour',
      'kind',
    ]
    for (const dimension of dimensions) {
      await backend.invoke('usage_report', {
        request: { dimension, sinceMs: null, untilMs: null, origin: null, conversationId: null },
      })
    }
  })

  it('replays a turn whose every event passes the stream contract', async () => {
    vi.useFakeTimers()
    try {
      const backend = createDemoBackend()
      const events: { type: string; approval_id?: string }[] = []
      backend.subscribe('chat-stream', (event) => events.push(event.payload as { type: string }))
      await backend.invoke('chat', SAMPLES.chat.args)
      await vi.advanceTimersByTimeAsync(20_000)
      const request = events.find((e) => e.type === 'tool_approval_req')
      expect(request?.approval_id).toBeTruthy()
      expect(await backend.invoke('all_pending_approvals', undefined)).toContainEqual(
        expect.objectContaining({ approval_id: request?.approval_id }),
      )
      await backend.invoke('approve_tool_call', { approvalId: request?.approval_id })
      await vi.advanceTimersByTimeAsync(20_000)
      expect(events.at(-1)?.type).toBe('stop')
      const snapshot = (await backend.invoke('conversation_snapshot', {
        request: { conversationId: CONV.pinned },
      })) as { turns: { id: string; status: string }[] }
      expect(snapshot.turns.find((t) => t.id === 'demo-test-turn')?.status).toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })
})
