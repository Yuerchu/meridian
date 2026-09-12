#!/usr/bin/env node
//
// A minimal ACP agent, for exercising the client end to end without a model.
//
// It speaks the same JSON-RPC-over-stdio the real adapter does and produces one
// of every update the client knows how to draw, plus one it does not. The
// interesting part is the middle of a turn: it asks for permission and *keeps
// streaming while it waits*, which is the property the reader is built around
// and the one that cannot be tested without a real pipe.
//
// Driven by `acp::peer`'s `against_a_real_adapter` tests. Not shipped.

import readline from 'node:readline'

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const note = (m) => process.stderr.write(m + '\n')
let nextId = 1000

note('fake adapter up')

// Stay alive even after stdin closes. Without this node exits on its own once
// the readline interface ends, and a test asking "did `stop` actually kill the
// child" would pass because the child had wandered off by itself.
setInterval(() => {}, 1 << 30)

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    note('unparseable: ' + line)
    return
  }

  // A reply to the question we asked.
  if (msg.id !== undefined && msg.method === undefined) {
    note('permission answer: ' + JSON.stringify(msg.result))
    globalThis.__answer?.(msg.result)
    return
  }

  if (msg.method === 'initialize') {
    // Whether the client opted into the AIR `sessionFailure` extension, which
    // changes what a failed prompt looks like — see the `air-*` prompts below.
    const air = msg.params?.clientCapabilities?._meta?.jetbrains?.air
    globalThis.__air = Array.isArray(air?.capabilities) && air.capabilities.includes('sessionFailure')
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: 1,
        // `loadSession` is top-level and `list` is a session capability —
        // separate switches by the schema's own admission, so a client has to
        // ask both.
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
        authMethods: [{ id: 'claude', name: 'Claude subscription' }],
        agentInfo: { name: 'fake-acp', version: '0.0.1' },
        // The steering extension is advertised here, at the top level, beside
        // `agentCapabilities` rather than inside it. A client looking in the
        // wrong place reads every adapter as not supporting it.
        _meta: { steering: { supported: true } },
      },
    })
    return
  }

  // Put a message into the turn that is already running. Answers the three
  // outcomes the real adapter does, including the one that depends on what the
  // client asked for: with no turn to join, `promptRequired` hands the message
  // back only if the request opted into it, and otherwise the older behaviour
  // detaches a turn of its own.
  if (msg.method === '_session/steering') {
    const text = msg.params?.prompt?.[0]?.text ?? ''
    if (globalThis.__steer) {
      note('steered into the running turn: ' + text)
      globalThis.__steer(text)
      send({ jsonrpc: '2.0', id: msg.id, result: { outcome: 'injected' } })
    } else if (msg.params?._meta?.steering?.idleBehavior === 'promptRequired') {
      send({ jsonrpc: '2.0', id: msg.id, result: { outcome: 'promptRequired', reason: 'noRunningTurn' } })
    } else {
      send({ jsonrpc: '2.0', id: msg.id, result: { outcome: 'startedNewTurn' } })
    }
    return
  }

  if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'sess-1' } })
    return
  }

  // What is on disk. One page, no cursor — which is what the real adapter does
  // too: it ignores the `cursor` parameter and answers with everything.
  if (msg.method === 'session/list') {
    const all = [
      {
        sessionId: 'sess-7',
        cwd: '/work/meridian',
        title: 'REPLAYED session',
        updatedAt: '2026-08-20T11:00:00.000Z',
      },
      // No title and no timestamp: both are optional and a session missing
      // them is still one worth offering.
      { sessionId: 'sess-8', cwd: '/work/other' },
    ]
    const cwd = msg.params?.cwd
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { sessions: cwd ? all.filter((s) => s.cwd === cwd) : all },
    })
    return
  }

  // Picking a session back up. Three things the client has to get right are
  // modelled here: the history comes back as ordinary `session/update`
  // notifications *before* the reply; the reply names whichever session was
  // actually recovered, which is deliberately not the one that was asked for;
  // and the chunks carry `messageId`, which is the only thing marking where one
  // message ends and the next begins.
  if (msg.method === 'session/load') {
    if (msg.params?.sessionId === 'sess-gone') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'no such session' } })
      return
    }
    // What the *schema* allows, as opposed to what this adapter happens to
    // send. `LoadSessionResponse` has no required field, so `result: null` is a
    // conforming success — and a client that reads it as a missing member
    // waits for ever. The generous reply below is the reason that has never
    // been noticed.
    if (msg.params?.sessionId === 'sess-terse') {
      send({ jsonrpc: '2.0', id: msg.id, result: null })
      return
    }
    const sid = msg.params.sessionId
    const upd = (update) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update } })

    upd({ sessionUpdate: 'user_message_chunk', messageId: 'u-1', content: { type: 'text', text: 'REPLAYED question' } })
    // Two chunks of one message, which must not become two rows.
    upd({ sessionUpdate: 'agent_message_chunk', messageId: 'm-1', content: { type: 'text', text: 'REPLAYED ' } })
    upd({ sessionUpdate: 'agent_message_chunk', messageId: 'm-1', content: { type: 'text', text: 'answer' } })
    upd({ sessionUpdate: 'tool_call', toolCallId: 'r1', title: 'Replayed', kind: 'execute', status: 'pending' })
    // A different message, so a new row — and the result of the call above
    // arrives *after* it, the way a parallel call comes back.
    upd({ sessionUpdate: 'agent_message_chunk', messageId: 'm-2', content: { type: 'text', text: 'and done' } })
    upd({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'r1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'replayed output' } }],
    })
    upd({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u-2',
      content: { type: 'text', text: 'REPLAYED follow-up' },
    })
    upd({ sessionUpdate: 'agent_message_chunk', messageId: 'm-3', content: { type: 'text', text: 'REPLAYED again' } })

    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: `${sid}-resumed` } })
    return
  }

  if (msg.method === 'session/cancel') {
    note('cancel received')
    return
  }

  if (msg.method === 'session/prompt') {
    const sid = msg.params.sessionId
    const upd = (update) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update } })
    const asked = msg.params.prompt?.[0]?.text ?? ''

    // More updates than the client's queue holds, as fast as they can be
    // written. Drives the overflow path, which must not end as a clean turn.
    if (asked === 'flood') {
      for (let i = 0; i < 4000; i++) {
        upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `chunk ${i} ` } })
      }
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    // The AIR `sessionFailure` extension, in the three shapes the real adapter
    // (0.76.0) produces. `failure` is the record as `sessionFailureMeta`
    // spells it; a warning rides a `session_info_update` that carries nothing
    // but `_meta`, and a turn-terminal failure rides the prompt's own reply —
    // as an ordinary `end_turn`, with the JSON-RPC error suppressed — only
    // when the client opted in. Without the opt-in the legacy rejection is
    // what a failure looks like.
    const failure = (record) => ({ jetbrains: { air: { version: 1, sessionFailure: record } } })
    if (asked === 'air-warn') {
      upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial ' } })
      upd({
        sessionUpdate: 'session_info_update',
        _meta: failure({
          id: 'turn-1:error',
          revision: 1,
          category: 'limit',
          severity: 'warning',
          title: 'Retrying Claude, attempt 1 of 5.',
          actions: [],
        }),
      })
      upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }
    if (asked === 'air-fail') {
      if (!globalThis.__air) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'Claude could not complete the request.' } })
        return
      }
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 1 },
          _meta: {
            quota: { token_count: { inputTokens: 1 }, model_usage: [] },
            ...failure({
              id: 'turn-1:error',
              revision: 2,
              category: 'service',
              severity: 'error',
              title: 'Claude could not complete the request.',
              actions: ['retry'],
            }),
          },
        },
      })
      return
    }
    // Authentication is the one failure that still rejects: the JSON-RPC
    // error is what starts a client's sign-in flow. The typed record arrives
    // beside it, session-scoped.
    if (asked === 'air-auth') {
      if (globalThis.__air) {
        upd({
          sessionUpdate: 'session_info_update',
          _meta: failure({
            id: 'sess-1:session-error:1:1',
            revision: 1,
            category: 'access',
            severity: 'error',
            title: 'Sign in to continue using Claude.',
            details: 'Claude request failed.',
            actions: ['login'],
          }),
        })
      }
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Authentication required' } })
      return
    }

    // The title frame, exactly as `session-titles.ts` publishes it at the
    // end of the turn that generated it.
    if (asked === 'title') {
      upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'named' } })
      upd({ sessionUpdate: 'session_info_update', title: 'Fix the flaky title test', updatedAt: '2026-09-12T02:00:00.000Z' })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    // A `Write` over an existing file, in the three frames the real adapter
    // sends: the optimistic announcement (`oldText: null`, no line), the
    // PostToolUse refinement — no status, `content` replaced by one diff per
    // hunk with a location per hunk — and the completion, which carries no
    // diff at all.
    if (asked === 'write-diff') {
      const path = '/work/meridian/src/lib.rs'
      upd({
        sessionUpdate: 'tool_call',
        toolCallId: 'toolu_write',
        _meta: { claudeCode: { toolName: 'Write' } },
        title: 'Write src/lib.rs',
        kind: 'edit',
        status: 'pending',
        rawInput: { file_path: path, content: 'line1\nNEW line2\nline3' },
        content: [{ type: 'diff', path, oldText: null, newText: 'line1\nNEW line2\nline3' }],
        locations: [{ path }],
      })
      upd({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'toolu_write',
        _meta: { claudeCode: { toolName: 'Write', toolResponse: { type: 'update' } } },
        content: [{ type: 'diff', path, oldText: 'line1\nold line2\nline3', newText: 'line1\nNEW line2\nline3' }],
        locations: [{ path, line: 1 }],
      })
      upd({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'toolu_write',
        _meta: { claudeCode: { toolName: 'Write' } },
        status: 'completed',
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    // A turn that runs until it is steered. The point of it is the window: a
    // client can only test mid-turn delivery against a turn that is reliably
    // still going when the steer arrives.
    if (asked === 'hold') {
      const steered = new Promise((resolve) => {
        globalThis.__steer = resolve
      })
      upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working...' } })
      const injected = await steered
      globalThis.__steer = undefined
      upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ` heard: ${injected}` } })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking...' } })
    upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } })
    upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'from ACP.' } })
    upd({
      sessionUpdate: 'plan',
      entries: [
        { content: 'read the code', status: 'completed' },
        { content: 'run the tests', status: 'in_progress' },
      ],
    })
    // An update kind the client has never heard of. Must not be fatal.
    upd({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })
    upd({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Run npm test',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'npm test' },
    })

    const askId = nextId++
    const answered = new Promise((resolve) => {
      globalThis.__answer = resolve
    })
    send({
      jsonrpc: '2.0',
      id: askId,
      method: 'session/request_permission',
      params: {
        sessionId: sid,
        toolCall: { toolCallId: 't1', title: 'Run npm test', kind: 'execute', rawInput: { command: 'npm test' } },
        options: [
          { optionId: 'allow-always', name: 'Always', kind: 'allow_always' },
          { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'No', kind: 'reject_once' },
        ],
      },
    })
    // Sent while the question is still open: if the client handled inbound
    // requests inline, this would not arrive until after the answer.
    upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' (still streaming)' } })

    const outcome = await answered
    const allowed = outcome?.outcome?.outcome === 'selected' && outcome.outcome.optionId.startsWith('allow')
    upd({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: allowed ? 'completed' : 'failed',
      content: [{ type: 'content', content: { type: 'text', text: allowed ? '3 passed' : 'denied' } }],
    })
    upd({ sessionUpdate: 'usage_update', used: 1234, size: 200000, cost: { amount: 0.01, currency: 'USD' } })
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
    return
  }

  if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no such method: ' + msg.method } })
  }
})
