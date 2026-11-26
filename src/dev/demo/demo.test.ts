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
  list_conversations: { args: { request: { archived: false, project_id: null } } },
  create_conversation: { args: { request: { title: 'x', project_id: null } } },
  update_conversation: {
    args: {
      request: {
        id: CONV.rich,
        title: 'renamed',
        is_pinned: true,
        is_archived: false,
        mode: 'plan',
        assistant_id: null,
        thinking_level: 'low',
        fast_mode: false,
        accept_edits: true,
        project_id: null,
      },
    },
  },
  delete_conversation: { args: { request: { id: CONV.rich } } },
  search_conversations: { args: { request: { query: '滚动', limit: 10 } } },
  get_conversation_snapshot: { args: { request: { conversation_id: CONV.rich } } },
  switch_message_branch: { args: { request: { conversation_id: CONV.rich, message_id: `${CONV.rich}-m6` } } },
  delete_message: { args: { request: { conversation_id: CONV.rich, id: `${CONV.rich}-m6` } } },
  update_message_rating: { args: { request: { id: `${CONV.rich}-m4`, rating: -1 } } },
  read_message_context_item: { args: { request: { conversation_id: CONV.rich, item_id: 'demo-ctx-scroller' } } },
  get_conversation_context: { args: { request: { conversation_id: CONV.rich } } },
  get_todo_list: { args: { request: { conversation_id: CONV.rich } } },
  invoke_conversation_compaction: {
    args: { request: { conversation_id: CONV.rich, custom_instructions: null } },
  },
  export_conversation: { args: { request: { conversation_id: CONV.rich, format: 'sft', output_path: null } } },
  get_user_command_result: { args: { request: { conversation_id: CONV.stickers, message_id: `${CONV.stickers}-m3` } } },
  get_active_user_command: { args: { request: { conversation_id: CONV.stickers } } },
  start_chat: {
    args: {
      request: {
        conversation_id: CONV.pinned,
        message: 'hi',
        turn_id: 'demo-test-turn',
        replaces: null,
        model_override: null,
        provider_override: null,
        thinking_level: null,
        assistant_id: null,
        fast: null,
        mode: null,
        voice: null,
        context_refs: [],
        conversation_refs: [],
      },
    },
  },
  stop_chat: { args: { request: { conversation_id: CONV.pinned, turn_id: null } } },
  send_conversation_steer: { args: { request: { conversation_id: CONV.pinned, text: 'x' } }, reject: true },
  submit_approval_decision: { args: { request: { approval_id: APPROVAL.command, decision: { kind: 'approve' } } } },
  list_pending_approvals: {},
  invoke_user_command: {
    args: { request: { conversation_id: CONV.stickers, turn_id: 't', command: 'ls', retry_without_sandbox: null } },
  },
  upload_message_file: { args: { request: { conversation_id: CONV.rich, file_path: 'C:\\a\\b.txt' } } },
  read_local_image_preview: { args: { request: { file_path: 'C:\\a\\photo.png' } } },
  get_composer_draft: { args: { request: { conversation_id: null } } },
  set_composer_draft: {
    args: {
      request: {
        conversation_id: CONV.rich,
        body: 'draft',
        attachments: [],
        conversation_refs: [CONV.pinned],
        sticker_id: STICKERS.cat,
        revision: 1,
      },
    },
  },
  delete_composer_draft: { args: { request: { conversation_id: CONV.rich, revision: 2 } } },
  list_queued_prompts: { args: { request: { conversation_id: CONV.rich } } },
  list_background_tasks: { args: { request: { conversation_id: CONV.rich } } },
  list_background_task_counts: {},
  stop_background_task: { args: { request: { conversation_id: CONV.rich, id: 'b1a2c3d4' } } },
  read_background_task_output: { args: { request: { conversation_id: CONV.rich, id: 'b1a2c3d4', offset: 0 } } },
  create_queued_prompt: {
    args: {
      request: {
        conversation_id: CONV.rich,
        content: 'x',
        delivery: 'follow_up',
        context_refs: null,
        conversation_refs: null,
      },
    },
  },
  delete_queued_prompt: { args: { request: { conversation_id: CONV.rich, id: 'none' } } },
  get_plan_review: { args: { request: { review_id: PLAN_REVIEW_ID } } },
  list_plan_revisions: { args: { request: { document_id: 'demo-plan-document' } } },
  set_plan_review_draft: {
    args: {
      request: { review_id: PLAN_REVIEW_ID, expected_generation: 0, normalized_markdown: '# x', global_note: null },
    },
  },
  delete_plan_review_draft: { args: { request: { review_id: PLAN_REVIEW_ID, expected_generation: 0 } } },
  submit_plan_review_decision: {
    args: {
      request: {
        review_id: PLAN_REVIEW_ID,
        decision_id: 'd',
        expected_generation: 0,
        expected_draft_hash: 'x',
        action: 'approve',
        approval_mode: 'default',
        clear_context: false,
      },
    },
  },
  list_board_tasks: {},
  create_board_task: {
    args: { request: { project_id: PROJECT_MERIDIAN, title: '修登录循环', request: null, stage: 'backlog' } },
  },
  update_board_task: {
    args: {
      request: { id: 'demo-card-csv', title: '导出 CSV', request: null, position: { stage: 'running', index: 0 } },
    },
  },
  start_board_task: { args: { request: { id: 'demo-card-csv', agent_kind: 'native' } } },
  // A fresh board has no card with a worktree to remove.
  delete_board_task_worktree: { args: { request: { id: 'demo-card-csv' } }, reject: true },
  delete_board_task: { args: { request: { id: 'demo-card-virtual' } } },
  list_projects: {},
  create_project: {
    args: {
      request: { name: 'p', path: null, source_type: 'local', source_id: null, assistant_id: null, description: null },
    },
  },
  update_project: { args: { request: { id: PROJECT_MERIDIAN, name: 'renamed' } } },
  delete_project: { args: { request: { id: PROJECT_MERIDIAN } } },
  get_workspace_root: { args: { request: { conversation_id: CONV.rich } } },
  list_workspace_entries: { args: { request: { conversation_id: CONV.rich, dir: null } } },
  read_workspace_file: { args: { request: { conversation_id: CONV.rich, rel_path: 'README.md' } } },
  test_workspace_ref: { args: { request: { conversation_id: CONV.rich, project_id: null, path: 'README.md' } } },
  resolve_workspace_ref: {
    args: {
      request: { conversation_id: CONV.rich, project_id: null, path: 'README.md', line_start: null, line_end: null },
    },
  },
  search_workspace_refs: {
    args: { request: { conversation_id: CONV.rich, project_id: null, query: 'src', limit: null } },
  },
  get_workspace_git_status: { args: { request: { conversation_id: CONV.rich } } },
  get_workspace_git_diff: { args: { request: { conversation_id: CONV.rich, rel_path: null } } },
  open_workspace_editor: {
    args: { request: { conversation_id: CONV.rich, rel_path: 'README.md', line: null } },
    reject: true,
  },
  list_providers: {},
  test_local_model: {
    args: { request: { model_path: 'C:/Models/custom-gpu.litertlm', backend: 'auto', force_refresh: true } },
  },
  get_provider_local_model: {
    args: { request: { provider_id: PROVIDER.anthropic, force_refresh: false } },
    reject: true,
  },
  list_provider_catalog: {},
  get_codex_auth_status: {},
  create_provider: {
    args: {
      request: {
        name: 'n',
        provider_type: 'openai',
        base_url: 'https://x',
        api_format: null,
        catalog_id: null,
        auth_option: null,
        local_backend: null,
      },
    },
  },
  update_provider: { args: { request: { id: PROVIDER.anthropic, name: 'A', is_enabled: false } } },
  delete_provider: { args: { request: { id: PROVIDER.relay } } },
  set_provider_key: { args: { request: { provider_id: PROVIDER.relay, api_key: 'k' } } },
  test_provider_key: { args: { request: { provider_id: PROVIDER.anthropic } } },
  list_provider_models: { args: { request: { provider_id: PROVIDER.anthropic, fetch_policy: 'cached' } } },
  get_provider_capabilities: { args: { request: { provider_id: PROVIDER.anthropic, model_id: 'claude-sonnet-5' } } },
  get_provider_balance: { args: { request: { provider_id: PROVIDER.deepseek } } },
  list_model_configs: { args: { request: { provider_id: PROVIDER.anthropic } } },
  list_model_profiles: {},
  get_model_config: { args: { request: { provider_id: PROVIDER.anthropic, model_id: 'claude-sonnet-5' } } },
  set_model_config: {
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
  delete_model_config: { args: { request: { id: 'demo-model-haiku' } } },
  list_logical_models: {},
  create_logical_model: {
    args: {
      request: {
        name: 'Standalone Model',
        canonical_id: null,
        capability_domain: 'chat',
        family: null,
        icon: null,
        routing_policy: 'sticky_manual',
        context_window: 128_000,
        compact_threshold: 100_000,
        max_output_tokens: null,
        ...DECIMAL_ZERO_PRICE,
        pricing_tiers: [],
        capability_overrides: null,
      },
    },
  },
  update_logical_model: {
    args: { request: { id: 'demo-profile-sonnet', routing_policy: 'user_opt_in_failover' } },
  },
  delete_logical_model: {
    args: { request: { id: 'demo-profile-haiku', cascade_deployments: true } },
  },
  attach_model_deployment: {
    args: {
      request: {
        provider_id: PROVIDER.anthropic,
        model_id: 'claude-opus-5',
        display_name: 'Claude Opus 5',
        profile_id: null,
        protocol_override: null,
        priority: 50,
      },
    },
  },
  update_model_deployment: {
    args: { request: { id: 'demo-model-sonnet', priority: 10, is_enabled: true } },
  },
  switch_model_deployment_profile: {
    args: {
      request: {
        deployment_id: 'demo-model-sonnet',
        target_profile_id: null,
        new_profile_name: 'Claude Sonnet Split',
      },
    },
  },
  delete_model_deployment: { args: { request: { id: 'demo-model-ds-reasoner' } } },
  get_usage_report: {
    args: { request: { dimension: 'total', since_ms: null, until_ms: null, origin: null, conversation_id: null } },
  },
  list_usage_gaps: { args: { request: { since_ms: null, until_ms: null, origin: null, conversation_id: null } } },
  get_usage_cache_misses: {
    args: { request: { since_ms: null, until_ms: null, origin: null, conversation_id: null } },
  },
  list_assistants: {},
  create_assistant: {
    args: {
      request: { name: 'a', system_prompt: '', model_id: null, temperature: null, top_p: null, max_tokens: null },
    },
  },
  update_assistant: { args: { request: { id: 'demo-assistant-default', context_limit: 100_000 } } },
  delete_assistant: { args: { request: { id: 'demo-assistant-writer' } } },
  list_tool_categories: {},
  list_custom_tools: {},
  create_custom_tool: {
    args: {
      request: {
        name: 'test',
        description: 'test',
        command: '',
        category_id: null,
        parameters_schema: null,
        args_template: null,
        working_directory: null,
        timeout_ms: null,
        permission: null,
        execution: { kind: 'executable', program: 'echo', args: [{ kind: 'json' }] },
      },
    },
  },
  update_custom_tool: { args: { request: { id: 'demo-tool-typecheck', description: 'updated' } } },
  delete_custom_tool: { args: { request: { id: 'demo-tool-typecheck' } } },
  list_tool_presets: {},
  delete_tool_preset: { args: { request: { id: 'demo-preset-coding' } } },
  list_tools: {},
  list_skills: {},
  invoke_skill_rescan: {},
  read_skill_body: { args: { request: { dir_name: 'commit-message' } } },
  update_skill: { args: { request: { dir_name: 'commit-message', is_enabled: false } } },
  list_skill_bindings: { args: { request: { layer: 'global', anchor_id: null } } },
  set_skill_binding: {
    args: { request: { layer: 'global', anchor_id: null, dir_name: 'commit-message', bound: true } },
  },
  list_mcp_servers: {},
  create_mcp_server: {
    args: {
      request: { name: 'm', transport_type: 'stdio', command: 'x', args: null, env: null, url: null, headers: null },
    },
  },
  update_mcp_server: { args: { request: { id: 'demo-mcp-sqlite', is_enabled: true } } },
  delete_mcp_server: { args: { request: { id: 'demo-mcp-sqlite' } } },
  connect_mcp_server: { args: { request: { id: 'demo-mcp-sqlite' } } },
  set_mcp_tool_enabled: {
    args: { request: { server_id: 'demo-mcp-github', tool_name: 'create_pull_request', enabled: false } },
  },
  disconnect_mcp_server: { args: { request: { id: 'demo-mcp-github' } } },
  list_mcp_tools: { args: { request: { server_id: null } } },
  list_mcp_connection_statuses: {},
  list_memories: { args: { request: { filter: { kind: 'project', project_id: PROJECT_MERIDIAN } } } },
  list_memory_subjects: {},
  get_memory_enums: {},
  create_memory: {
    args: {
      request: {
        scope: 'client_global',
        project_id: null,
        subject_scope_id: null,
        key: 'k',
        content: 'c',
        memory_type: null,
        owner_only: null,
      },
    },
  },
  update_memory: { args: { request: { id: 'demo-mem-1', content: 'changed' } } },
  delete_memories: { args: { request: { ids: ['demo-mem-1'], permanent: false } } },
  restore_memories: { args: { request: { ids: ['demo-mem-trash-1'] } } },
  delete_memory_subject: { args: { request: { subject_scope_id: 'onebot:10002' } } },
  update_memory_subject: {
    args: { request: { subject_scope_id: 'onebot:10002', is_pinned: true, opted_out: null } },
  },
  get_platform: {},
  list_system_fonts: {},
  get_window_insets: {},
  get_app_info: {},
  get_secret: { args: { request: { key: 'REMOTE_TOKEN' } } },
  get_preference: { args: { request: { key: 'shell' } } },
  set_preference: { args: { request: { key: 'autoreview.model', value: { provider_id: 'p', model_id: 'm' } } } },
  test_service_key: { args: { request: { service: 'tavily' } } },
  set_service_key: { args: { request: { service: 'fish_audio', key: 'k' } } },
  read_logs: {
    args: {
      request: {
        min_level: 'warn',
        limit: null,
        contains: null,
        target_prefix: null,
        conversation_id: null,
        since_ts_ms: null,
        until_ts_ms: null,
        cursor: null,
      },
    },
  },
  list_log_files: {},
  get_log_settings: {},
  set_log_level: { args: { request: { level: 'debug' } } },
  export_logs: { args: { request: { output_path: 'x' } } },
  get_onebot_config: {},
  set_onebot_config: {
    args: {
      request: {
        enabled: false,
        host: '127.0.0.1',
        port: 6700,
        access_token: null,
        assistant_id: null,
        admin_users: [],
        ack_emoji_id: '124',
        private_media_origins: [],
        voice_capture_sessions: [],
        voice_send_enabled: false,
        voice_send_groups: [],
        voice_tts_model: '',
        voice_tts_reference_id: '',
        replies: {
          empty_reply: [],
          busy: [],
          server_error: [],
          ack_approved: [],
          ack_denied: [],
        },
      },
    },
  },
  get_onebot_status: {},
  start_onebot: {},
  stop_onebot: {},
  get_onebot_voice_readiness: {},
  list_voice_corpus: {},
  get_voice_model_status: {},
  get_hooks_config: {},
  set_hooks_config: {
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
  get_remote_config: {},
  set_remote_config: { args: { request: { enabled: true, host: '127.0.0.1', port: 8787 } } },
  get_remote_status: {},
  start_remote: {},
  stop_remote: {},
  reset_remote_token: {},
  list_remote_addresses: {},
  get_ime_status: {},
  get_ime_config: {},
  set_ime_config: {
    args: {
      request: {
        scheme: 'zhuyin',
        page_size: 5,
        punctuation: 'half_width',
        learning: false,
        private_apps: [],
        debug_log: true,
        context_apps: [],
        prediction: false,
      },
    },
  },
  list_ime_dictionaries: {},
  list_system_notices: {},
  get_ime_learning: {},
  delete_ime_learning: { args: { request: { word: '你好' } } },
  export_ime_learning: { args: { request: { dest: null } } },
  import_ime_learning: { args: { request: { path: '/tmp/learn.zip', mode: 'add' } } },
  take_launch_request: {},
  cancel_ime_dictionary_staging: { args: { request: { staging_id: 'none' } } },
  delete_system_notice: { args: { request: { id: 'none' } } },
  set_ime_dictionary_enabled: { args: { request: { file: 'tech.dict', enabled: true } } },
  get_ime_lm_status: {},
  invoke_ime_memory_hints_refresh: {},
  get_acp_config: {},
  list_emoji_packs: { args: { request: { assistant_id: null } } },
  set_emoji_pack_assignment: {
    args: { request: { assistant_id: 'demo-assistant-default', pack_id: 'demo-pack-daily', assigned: true } },
  },
  list_emojis: { args: { request: { filter: { kind: 'pack', pack_id: 'demo-pack-daily' } } } },
  get_emoji_file_url: { args: { request: { emoji_id: STICKERS.cat } } },
  update_emoji: { args: { request: { id: STICKERS.cat, action: { kind: 'rename', name: '猫' } } } },
}

describe('demo fixtures', () => {
  it('keeps legacy custom tools editable and rejects unsafe enablement atomically', async () => {
    const backend = createDemoBackend()
    const legacy = backend.state.customTools[0]
    legacy.execution = null
    legacy.is_enabled = false
    legacy.command = "  printf '%s'  "
    legacy.args_template = '"{{input}}"'
    await backend.invoke('update_custom_tool', { request: { id: legacy.id, description: 'edited' } })
    await expect(
      backend.invoke('update_custom_tool', { request: { id: legacy.id, is_enabled: true, command: 'changed' } }),
    ).rejects.toThrow(/Legacy/)
    expect(backend.state.customTools[0].command).toBe("  printf '%s'  ")
    expect(backend.state.customTools[0].args_template).toBe('"{{input}}"')
    expect(backend.state.customTools[0].is_enabled).toBe(false)
    await backend.invoke('update_custom_tool', {
      request: {
        id: legacy.id,
        is_enabled: true,
        execution: { kind: 'script', script: 'printf "%s" "$1"', args: [{ kind: 'parameter', name: 'input' }] },
      },
    })
    expect(backend.state.customTools[0].is_enabled).toBe(true)
    await expect(backend.invoke('update_custom_tool', { request: { id: legacy.id, execution: null } })).rejects.toThrow(
      /Legacy/,
    )
    expect(backend.state.customTools[0].execution?.kind).toBe('script')
  })

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

  // The backend's rules, kept by the fixture: a started card has a
  // conversation and a worktree, its worktree must go before it does, and it
  // goes with its conversation.
  it('takes a board card from start to removal to deletion', async () => {
    const backend = createDemoBackend()
    const started = (await backend.invoke('start_board_task', {
      request: { id: 'demo-card-csv', agent_kind: 'claude_code' },
    })) as { task: { stage: string; conversation_id: string; worktree_path: string | null } }
    expect(started.task.stage).toBe('running')
    const conversationId = started.task.conversation_id
    expect(backend.state.conversations.some((c) => c.id === conversationId)).toBe(true)
    await expect(backend.invoke('delete_board_task', { request: { id: 'demo-card-csv' } })).rejects.toMatch(/worktree/)

    const removed = (await backend.invoke('delete_board_task_worktree', { request: { id: 'demo-card-csv' } })) as {
      stage: string
      worktree_path: string | null
    }
    expect([removed.stage, removed.worktree_path]).toEqual(['done', null])

    const seen: { channel: string; payload: unknown }[] = []
    backend.subscribe('board-updated', (event) => seen.push({ channel: 'board-updated', payload: event.payload }))
    backend.subscribe('conversation-updated', (event) =>
      seen.push({ channel: 'conversation-updated', payload: event.payload }),
    )
    await backend.invoke('delete_board_task', { request: { id: 'demo-card-csv' } })
    expect(backend.state.boardTasks.some((t) => t.id === 'demo-card-csv')).toBe(false)
    expect(backend.state.conversations.some((c) => c.id === conversationId)).toBe(false)
    expect(seen).toEqual([
      { channel: 'board-updated', payload: { task_id: null } },
      { channel: 'conversation-updated', payload: { conversation_id: conversationId } },
    ])
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
      const snapshot = (await backend.invoke('get_conversation_snapshot', {
        request: { conversation_id: conversation.id },
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
      await backend.invoke('get_usage_report', {
        request: { dimension, since_ms: null, until_ms: null, origin: null, conversation_id: null },
      })
    }
  })

  it('replays a turn whose every event passes the stream contract', async () => {
    vi.useFakeTimers()
    try {
      const backend = createDemoBackend()
      const events: { type: string; approval_id?: string }[] = []
      backend.subscribe('chat-stream', (event) => events.push(event.payload as { type: string }))
      await backend.invoke('start_chat', SAMPLES.start_chat.args)
      await vi.advanceTimersByTimeAsync(20_000)
      const request = events.find((e) => e.type === 'tool_approval_req')
      expect(request?.approval_id).toBeTruthy()
      expect(await backend.invoke('list_pending_approvals', undefined)).toContainEqual(
        expect.objectContaining({ approval_id: request?.approval_id }),
      )
      await backend.invoke('submit_approval_decision', {
        request: { approval_id: request?.approval_id, decision: { kind: 'approve' } },
      })
      await vi.advanceTimersByTimeAsync(20_000)
      expect(events.at(-1)?.type).toBe('stop')
      const snapshot = (await backend.invoke('get_conversation_snapshot', {
        request: { conversation_id: CONV.pinned },
      })) as { turns: { id: string; status: string }[] }
      expect(snapshot.turns.find((t) => t.id === 'demo-test-turn')?.status).toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })
})
