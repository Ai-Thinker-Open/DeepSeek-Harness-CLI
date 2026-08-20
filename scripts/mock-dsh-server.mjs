#!/usr/bin/env bun
/**
 * Minimal DeepSeek Harness `/api` mock for manual development of dsh-cli.
 *
 *   bun scripts/mock-dsh-server.mjs          # listens on 127.0.0.1:3080
 *   PORT=3456 bun scripts/mock-dsh-server.mjs
 *   MOCK_SLOW=1 bun scripts/mock-dsh-server.mjs   # slower streaming
 *
 * Speaks the DSH protocol:
 *   - POST /api/<method> with a `client-request` envelope
 *   - GET  /api/events.mux (WebSocket downlink of `server-request` frames)
 *   - POST /api/respond
 *
 * Prompt "ask ..." triggers a permission question; anything else runs a
 * scripted turn with a tool call (bash / read / grep / edit, picked from the
 * prompt) so the tool card shine animation is visible across tool kinds.
 */

const PORT = Number(process.env.PORT || 3080)
const MODEL = process.env.MODEL || "DeepSeek-V4-Flash"
const SLOW = process.env.MOCK_SLOW === "1"
const sleep = (ms) => new Promise((r) => setTimeout(r, SLOW ? ms * 8 : ms))

let sessionSeq = 0
let turnSeq = 0
let seq = 0
const sockets = new Set()
const sessions = new Map()
const pendingQuestions = new Map() // rpcId -> { resolve }

function emit(method, payload) {
  const frame = JSON.stringify({ type: "server-request", rpcId: `mux-${++seq}`, method, payload })
  for (const ws of sockets) {
    try {
      ws.send(frame)
    } catch {
      /* socket gone */
    }
  }
}

function emitEvent(sessionId, event) {
  emit("session/event", { sessionId, event })
}

const ok = (value) => ({ ok: true, value })
const fail = (message, code) => ({ ok: false, error: { message, code } })

function nextSeq() {
  return ++seq
}

function askQuestion(sessionId, rpcId, question, options) {
  return new Promise((resolve) => {
    pendingQuestions.set(rpcId, { resolve })
    emit("question/requested", {
      sessionId,
      questions: [
        {
          id: `q-${rpcId}`,
          question,
          header: "权限请求",
          options: options.map((label) => ({ label })),
          intent: { kind: "permission" },
        },
      ],
    })
  })
}

/** Pick a scripted tool call from the prompt so different tool cards render. */
function pickToolCall(text) {
  if (/read|读取|查看|cat /i.test(text)) {
    return {
      name: "read",
      args: { file_path: "src/app.tsx" },
      output: "12 | const [screen, setScreen] = createSignal(\"home\")\n13 | const [toast, setToast] = createSignal(null)",
      meta: {
        card: "read",
        lines: [
          { number: 12, text: 'const [screen, setScreen] = createSignal("home")' },
          { number: 13, text: "const [toast, setToast] = createSignal(null)" },
        ],
        totalLines: 13,
      },
    }
  }
  if (/grep|搜索|查找|search/i.test(text)) {
    return {
      name: "grep",
      args: { pattern: "createSignal", path: "src" },
      output: "src/app.tsx:12: const [screen, setScreen] = createSignal(\"home\")",
      meta: {
        card: "search",
        shape: "matches",
        files: [
          {
            path: "src/app.tsx",
            matches: [{ lineNumber: 12, line: 'const [screen, setScreen] = createSignal("home")' }],
          },
        ],
        total: 1,
      },
    }
  }
  if (/edit|修改|写入|write/i.test(text)) {
    return {
      name: "edit",
      args: { file_path: "src/app.tsx", old_string: "home", new_string: "session" },
      output: "已修改 src/app.tsx",
      meta: {
        card: "diff",
        diffs: [{ path: "src/app.tsx", oldText: 'createSignal("home")', newText: 'createSignal("session")' }],
      },
    }
  }
  return {
    name: "bash",
    args: { command: "echo hello-from-mock-bash" },
    output: "hello-from-mock-bash\n第二行输出\n第三行输出\n第四行输出\n第五行输出",
  }
}

async function runTurn(sessionId, text, firstTurn) {
  // Give the client's events.mux socket time to open before emitting, so the
  // first events (injections, user/message, turn/start) are not lost.
  await sleep(150)
  const turn = ++turnSeq
  const now = () => Date.now()
  if (firstTurn) {
    // Injected context, exactly like the real harness folds it into the
    // model-visible surface before the first model call.
    emitEvent(sessionId, {
      type: "user/message",
      seq: nextSeq(),
      time: now(),
      data: {
        id: `inj-${turn}-system`,
        content: [
          {
            type: "text",
            text: "你是 DeepSeek Harness CLI 的编码助手。\n- 使用中文回复\n- 动手前先说明计划\n- 涉及文件修改时给出清晰小结",
          },
        ],
        source: { kind: "plugin", plugin: "@deepseek-ai/dsh-system-prompt", form: "instructions" },
      },
    })
    emitEvent(sessionId, {
      type: "user/message",
      seq: nextSeq(),
      time: now(),
      data: {
        id: `inj-${turn}-skills`,
        content: [
          {
            type: "text",
            text: "本会话可用技能目录：\n- bash：执行 shell 命令并读取输出\n- fs：读写与搜索工作区文件\n- web：网页搜索与内容抓取",
          },
        ],
        source: { kind: "plugin", plugin: "skill-catalog", form: "catalog" },
      },
    })
  }
  emitEvent(sessionId, { type: "turn/start", seq: nextSeq(), time: now(), data: { turn } })
  emitEvent(sessionId, {
    type: "user/message",
    seq: nextSeq(),
    time: now(),
    data: { id: `um-${turn}`, content: [{ type: "text", text }], source: { kind: "user" } },
  })
  emitEvent(sessionId, { type: "step/start", seq: nextSeq(), time: now(), data: { turn, step: 1 } })

  const reasoning = ["让我先分析一下这个问题，", "然后我会调用工具来确认结果。"]
  for (const part of reasoning) {
    emitEvent(sessionId, {
      type: "assistant/chunk",
      seq: nextSeq(),
      time: now(),
      data: { turn, step: 1, chunk: { type: "reasoning-delta", text: part } },
    })
    await sleep(120)
  }

  if (/ask/i.test(text)) {
    const answer = await askQuestion(sessionId, `q-${turn}`, "允许执行 bash 命令吗？", ["Yes", "No"])
    emitEvent(sessionId, {
      type: "assistant/chunk",
      seq: nextSeq(),
      time: now(),
      data: { turn, step: 1, chunk: { type: "text-delta", text: `你选择了「${answer}」。` } },
    })
  } else {
    const tool = pickToolCall(text)
    const argsJson = JSON.stringify(tool.args)
    emitEvent(sessionId, {
      type: "assistant/chunk",
      seq: nextSeq(),
      time: now(),
      data: { turn, step: 1, chunk: { type: "text-delta", text: "好的，我执行一条命令看看结果。" } },
    })
    await sleep(100)
    emitEvent(sessionId, {
      type: "assistant/chunk",
      seq: nextSeq(),
      time: now(),
      data: {
        turn,
        step: 1,
        chunk: {
          type: "tool-call-delta",
          index: 0,
          id: `call_${turn}`,
          name: tool.name,
          argumentsDelta: argsJson,
        },
      },
    })
    emitEvent(sessionId, {
      type: "tool/call",
      seq: nextSeq(),
      time: now(),
      data: { callId: `call_${turn}`, name: tool.name, arguments: argsJson },
    })
    await sleep(250)
    emitEvent(sessionId, {
      type: "tool/result",
      seq: nextSeq(),
      time: now(),
      data: {
        message: {
          content: [
            {
              type: "tool-result",
              toolCallId: `call_${turn}`,
              isError: false,
              content: [{ type: "text", text: tool.output }],
            },
          ],
        },
        meta: tool.meta,
      },
    })
    await sleep(100)
    emitEvent(sessionId, {
      type: "assistant/chunk",
      seq: nextSeq(),
      time: now(),
      data: { turn, step: 1, chunk: { type: "text-delta", text: "完成，工具返回了输出。" } },
    })
  }

  emitEvent(sessionId, {
    type: "assistant/chunk",
    seq: nextSeq(),
    time: now(),
    data: {
      turn,
      step: 1,
      chunk: {
        type: "usage",
        usage: { inputTokens: 42, outputTokens: 7, cacheReadTokens: 158, cacheWriteTokens: 0, reasoningTokens: 3 },
      },
    },
  })
  emitEvent(sessionId, {
    type: "assistant/message",
    seq: nextSeq(),
    time: now(),
    data: {
      turn,
      step: 1,
      message: { id: `am-${turn}` },
      usage: { inputTokens: 42, outputTokens: 7, cacheReadTokens: 158, cacheWriteTokens: 0, reasoningTokens: 3 },
    },
  })
  emitEvent(sessionId, { type: "step/end", seq: nextSeq(), time: now(), data: { turn, step: 1 } })
  emitEvent(sessionId, { type: "turn/end", seq: nextSeq(), time: now(), data: { turn, reason: { kind: "stop" } } })
}

async function handleRpc(req) {
  const body = await req.json().catch(() => ({}))
  const method = typeof body.method === "string" ? body.method : ""
  const payload = body.payload ?? {}
  const rpcId = typeof body.rpcId === "string" ? body.rpcId : "rpc-unknown"

  const respond = (result) =>
    new Response(JSON.stringify({ type: "server-response", rpcId, result }), {
      headers: { "content-type": "application/json" },
    })

  if (body.type === "client-response") {
    const value = body.result?.value ?? {}
    const pending = pendingQuestions.get(rpcId)
    if (pending) {
      const choice = value.answer?.answers?.[0]?.selected?.[0] ?? "Yes"
      pending.resolve(choice)
      pendingQuestions.delete(rpcId)
    }
    return respond(ok({}))
  }

  switch (method) {
    case "host.describe":
      return respond(ok({ version: "mock", cwd: process.cwd(), provider: "deepseek", model: MODEL, attachedSessions: sessions.size, canOpenPath: true }))
    case "session.create": {
      // Resume when a sessionId is supplied (the TUI's `-c`/continue flow),
      // matching the real harness's attach semantics.
      const requested = String(payload.sessionId ?? "")
      const sessionId = requested || `mock-${++sessionSeq}`
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, { events: [], cwd: payload.cwd ?? process.cwd() })
      }
      return respond(ok({ sessionId, agentPreset: "build" }))
    }
    case "session.list":
      return respond(
        ok({
          items: [...sessions.entries()].map(([sessionId, s]) => ({
            sessionId,
            updatedAt: Date.now(),
            running: false,
            blank: s.events.length === 0,
            cwd: s.cwd,
          })),
        }),
      )
    case "session.history": {
      const s = sessions.get(String(payload.sessionId ?? ""))
      return respond(ok({ events: (s?.events ?? []).map((event) => ({ event })), hasMore: false }))
    }
    case "session.prompt": {
      const sessionId = String(payload.sessionId ?? "")
      const text = String(payload.content?.[0]?.text ?? "")
      const s = sessions.get(sessionId)
      if (!s) return respond(fail(`session ${sessionId} not found`, "not-found"))
      const firstTurn = s.events.length === 0
      s.events.push({
        type: "user/message",
        seq: nextSeq(),
        time: Date.now(),
        data: { id: `um-q`, content: [{ type: "text", text }], source: { kind: "user" } },
      })
      void runTurn(sessionId, text, firstTurn)
      return respond(ok({ accepted: true }))
    }
    case "session.cancel":
      return respond(ok({ accepted: true }))
    case "session.rename":
      return respond(ok({}))
    case "session.models":
      console.log(`[dsh-mock] session.models`)
      return respond(
        ok({
          current: { provider: "deepseek", model: "deepseek-v4" },
          routable: true,
          groups: [
            {
              id: "deepseek",
              name: "DeepSeek",
              models: [
                { id: "deepseek-v4", name: "DeepSeek-V4" },
                { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
              ],
            },
          ],
          failures: [],
        }),
      )
    case "session.selectModel":
      console.log(`[dsh-mock] selectModel provider=${payload.provider} model=${payload.model}`)
      return respond(ok({ selected: { provider: payload.provider, model: payload.model } }))
    case "skill.list":
      return respond(ok({ skills: [] }))
    default:
      return respond(fail(`unknown method ${method}`, "unknown"))
  }
}

const server = Bun.serve({
  port: PORT,
  websocket: {
    open(ws) {
      sockets.add(ws)
      console.log(`[dsh-mock] client connected (${sockets.size} total)`)
    },
    message() {
      // mux is downlink-only
    },
    close(ws) {
      sockets.delete(ws)
      console.log(`[dsh-mock] client disconnected (${sockets.size} total)`)
    },
  },
  fetch(req, serverInstance) {
    const url = new URL(req.url)
    if (req.method === "GET" && url.pathname === "/api/events.mux") {
      if (serverInstance.upgrade(req)) return
      return new Response("upgrade failed", { status: 500 })
    }
    if (req.method === "POST") return handleRpc(req)
    return new Response("not found", { status: 404 })
  },
})

console.log(`[dsh-mock] DeepSeek Harness mock on ws/http://127.0.0.1:${server.port} (model ${MODEL})`)
console.log(`[dsh-mock] DSH_URL=http://127.0.0.1:${server.port} bun run dev`)
