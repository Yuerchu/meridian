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
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        authMethods: [{ id: 'claude', name: 'Claude subscription' }],
        agentInfo: { name: 'fake-acp', version: '0.0.1' },
      },
    })
    return
  }

  if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'sess-1' } })
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
