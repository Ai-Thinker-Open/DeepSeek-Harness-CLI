import { expect, test } from "bun:test"
import type { HarnessClientLike, HostDescribe, ServerRequest, SessionEvent } from "../src/harness/client"
import { HarnessError } from "../src/harness/client"
import { createHarnessSession } from "../src/harness/session"

class FakeClient implements HarnessClientLike {
  describeResult: HostDescribe = { version: "mock", cwd: "/tmp", attachedSessions: 0, canOpenPath: true }
  failDescribe = false
  created = 0
  prompts: Array<{ sessionId: string; text: string }> = []
  responded: Array<{ rpcId: string; sessionId: string; answers: Array<{ id: string; selected: string[] }> }> = []
  private frames: ServerRequest[] = []
  private waiters: Array<(r: IteratorResult<ServerRequest>) => void> = []
  private closed = false

  async describe(): Promise<HostDescribe> {
    if (this.failDescribe) throw new Error("refused")
    return this.describeResult
  }

  async createSession() {
    this.created += 1
    return { sessionId: `s-${this.created}` }
  }

  async prompt(sessionId: string, text: string) {
    this.prompts.push({ sessionId, text })
    return { accepted: true }
  }

  async cancel() {
    return { accepted: true }
  }

  async respond(rpcIdToAnswer: string, sessionId: string, answers: Array<{ id: string; selected: string[] }>) {
    this.responded.push({ rpcId: rpcIdToAnswer, sessionId, answers })
  }

  async history() {
    return { events: [], hasMore: false }
  }

  async listSessions() {
    return { items: [] }
  }

  async commandList() {
    return []
  }

  async commandExecute() {
    return undefined
  }

  async listModels() {
    return { current: { provider: "p", model: "m" }, routable: true, groups: [], failures: [] }
  }

  async selectModel() {
    return { selected: { provider: "p", model: "m" } }
  }

  async renameSession() {
    return { title: "t" }
  }

  async forkSession() {
    return { sessionId: "s-forked" }
  }

  async skillList() {
    return { skills: [] }
  }

  async updateQueue() {
    return { accepted: true }
  }

  async *eventStream() {
    while (!this.closed) {
      if (this.frames.length) yield this.frames.shift() as ServerRequest
      else {
        const result = await new Promise<IteratorResult<ServerRequest>>((r) => this.waiters.push(r))
        if (result.done) break
        yield result.value
      }
    }
  }

  push(frame: ServerRequest): void {
    const w = this.waiters.shift()
    if (w) w({ value: frame, done: false })
    else this.frames.push(frame)
  }
}

// Chunk-driven message updates are coalesced into a per-frame flush (~32ms),
// so tests wait a full frame before reading the folded messages.
const tick = () => new Promise((resolve) => setTimeout(resolve, 40))

const ev = (type: string, data: Record<string, unknown>, seq: number, time = seq * 1000): SessionEvent => ({
  type,
  seq,
  time,
  data,
})

const frame = (method: string, payload: Record<string, unknown>, rpcId = `r-${Math.random()}`): ServerRequest => ({
  type: "server-request",
  rpcId,
  method,
  payload,
})

test("start creates a harness session and sends the first prompt", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")

  const ok = await session.start("hello")

  expect(ok).toBe(true)
  expect(client.created).toBe(1)
  expect(client.prompts).toEqual([{ sessionId: "s-1", text: "hello" }])
  expect(session.messages().map((m) => m.role)).toEqual(["user"])
  expect(session.messages()[0]?.content).toBe("hello")
  // Deep diving starts immediately on send — no intermediate "发送中" phase.
  expect(session.statusText()).toBe("Deep diving")
  // Turns are authoritative: they come from harness turn/start events.
  expect(session.stats().turns).toBe(0)
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) }))
  await tick()
  expect(session.stats().turns).toBe(1)
  expect(session.messages().map((m) => m.role)).toEqual(["user", "assistant"])
  expect(session.connected()).toBe(true)
})

test("plan mode follows the session projection and plan/mode events", async () => {
  const client = new FakeClient()
  client.history = (async () => ({
    events: [],
    hasMore: false,
    projections: { plan: { active: true, pending: false } },
  })) as unknown as typeof client.history
  const session = createHarnessSession(client, "/tmp")

  await session.ensureSession()
  await tick()

  // Seeded from the durable projection right after the session is created.
  expect(session.planMode()).toBe(true)
  expect(session.planPending()).toBe(false)

  // The committed switch arrives as a live plan/mode event.
  client.push(frame("session/event", { sessionId: "s-1", event: ev("plan/mode", { active: false }, 6) }))
  await tick()
  expect(session.planMode()).toBe(false)
  expect(session.planPending()).toBe(false)

  // /plan off while a later snapshot still reports the old projection: the
  // live event wins and the badge reflects the harness's committed state.
  client.push(frame("session/event", { sessionId: "s-1", event: ev("plan/mode", { active: true }, 7) }))
  await tick()
  expect(session.planMode()).toBe(true)
})

test("reconnect clears the interrupted status once frames flow again", async () => {
  const client = new FakeClient()
  const original = client.eventStream.bind(client)
  let calls = 0
  client.eventStream = (async function* (signal?: AbortSignal) {
    calls += 1
    if (calls === 1) throw new Error("simulated drop")
    yield* original()
  }) as typeof client.eventStream

  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")
  await tick()

  // The first stream attempt failed; after the reconnect delay a live frame
  // clears whatever stale status was showing (连接中断 or Deep diving).
  client.push(frame("session/event", { sessionId: "s-1", event: ev("step/start", { step: 1 }, 5) }))
  await new Promise((resolve) => setTimeout(resolve, 1_700))
  expect(session.statusText()).toBe("")
  expect(calls).toBeGreaterThanOrEqual(2)
})

test("a wedged stream recovers: the watchdog re-syncs from durable history", async () => {
  const client = new FakeClient()
  client.history = (async () => ({
    events: [
      { event: ev("user/message", { id: "m1", content: [{ type: "text", text: "hello" }] }, 1) },
      {
        event: ev(
          "assistant/message",
          { message: { id: "a1", content: [{ type: "text", text: "finalized reply" }] } },
          2,
        ),
      },
    ],
    hasMore: false,
  })) as unknown as typeof client.history
  // The first stream yields one turn/start frame, then wedges silently — no
  // close, no error — which would otherwise leave the ▍ cursor forever.
  let calls = 0
  client.eventStream = (async function* (signal?: AbortSignal) {
    calls += 1
    if (calls === 1) {
      yield frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) })
    }
    await new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true }))
  }) as typeof client.eventStream

  const session = createHarnessSession(client, "/tmp", { stallResyncMs: 150 })
  await session.start("hello")
  await tick()

  // Turn started and the message is stuck streaming.
  expect(session.statusText()).toBe("Deep diving")
  expect(session.messages().some((m) => m.streaming)).toBe(true)

  // After the silence threshold the watchdog reconnects and history wins.
  await new Promise((resolve) => setTimeout(resolve, 350))
  expect(session.messages().map((m) => m.content)).toEqual(["hello", "finalized reply"])
  expect(session.messages().some((m) => m.streaming)).toBe(false)
  expect(session.statusText()).toBe("")
  session.dispose()
})

test("tool-call-delta indices that reset per step fold into distinct cards", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) }))
  await tick()

  for (let step = 1; step <= 3; step++) {
    client.push(
      frame("session/event", {
        sessionId: "s-1",
        event: ev("assistant/chunk", { turn: 1, step, chunk: { type: "tool-call-delta", index: 0, id: `c${step}`, name: "read" } }, 5 + step),
      }),
    )
    await tick()
    client.push(
      frame("session/event", {
        sessionId: "s-1",
        event: ev(
          "assistant/chunk",
          { turn: 1, step, chunk: { type: "tool-call-delta", index: 0, argumentsDelta: JSON.stringify({ file_path: `f${step}.ts` }) } },
          10 + step,
        ),
      }),
    )
    await tick()
  }

  const last = session.messages()[session.messages().length - 1]
  expect(last?.toolCalls?.length).toBe(3)
  expect(last?.toolCalls?.map((c) => c.name)).toEqual(["read", "read", "read"])
  expect(last?.toolCalls?.map((c) => c.args)).toEqual([
    { file_path: "f1.ts" },
    { file_path: "f2.ts" },
    { file_path: "f3.ts" },
  ])
})

test("Deep diving status survives tool execution without being overwritten", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp", { minToolRunningMs: 0 })
  await session.start("hello")
  expect(session.statusText()).toBe("Deep diving")

  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) }))
  await tick()
  expect(session.statusText()).toBe("Deep diving")

  client.push(
    frame("session/event", { sessionId: "s-1", event: ev("tool/call", { turn: 1, step: 1, callId: "c1", name: "read", arguments: "{}" }, 6) }),
  )
  await tick()
  expect(session.statusText()).toBe("Deep diving")

  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev(
        "tool/result",
        { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId: "c1", isError: false, content: [{ type: "text", text: "ok" }] }] } },
        7,
      ),
    }),
  )
  await tick()
  expect(session.statusText()).toBe("Deep diving")
})

test("fast tool results hold the running shine window before settling", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp", { minToolRunningMs: 60 })
  await session.start("hello")

  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) }))
  await tick()
  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev("tool/call", { turn: 1, step: 1, callId: "c1", name: "read", arguments: "{}" }, 6, 6000),
    }),
  )
  await tick()
  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev(
        "tool/result",
        { turn: 1, step: 1, message: { content: [{ type: "tool-result", toolCallId: "c1", isError: false, content: [{ type: "text", text: "ok" }] }] } },
        7,
        6010,
      ),
    }),
  )
  // The result arrived 10ms after the call — inside the shine window, so the
  // card must still read "running" (the sweep is still visible).
  await new Promise((resolve) => setTimeout(resolve, 20))
  const stillRunning = session.messages().flatMap((m) => m.toolCalls ?? []).find((c) => c.id === "c1")
  expect(stillRunning?.status).toBe("running")
  expect(stillRunning?.finishedAt).toBeUndefined()

  // Once the window elapses, the call settles with the real result time.
  await new Promise((resolve) => setTimeout(resolve, 80))
  const settled = session.messages().flatMap((m) => m.toolCalls ?? []).find((c) => c.id === "c1")
  expect(settled?.status).toBe("ok")
  expect(settled?.finishedAt).toBe(6010)
  expect(
    session
      .messages()
      .flatMap((m) => m.toolResults ?? [])
      .some((r) => r.toolCallId === "c1" && r.output === "ok"),
  ).toBe(true)
  session.dispose()
})

test("listSessions only surfaces sessions in the current workspace", async () => {
  const client = new FakeClient()
  client.listSessions = (async () => ({
    items: [
      { sessionId: "s-here", updatedAt: 30, running: false, blank: false, cwd: "/tmp" },
      { sessionId: "s-elsewhere", updatedAt: 50, running: false, blank: false, cwd: "/other/workspace" },
      { sessionId: "s-legacy", updatedAt: 10, running: false, blank: false },
      { sessionId: "s-blank", updatedAt: 60, running: false, blank: true, cwd: "/tmp" },
    ],
  })) as typeof client.listSessions
  const session = createHarnessSession(client, "/tmp")
  const items = await session.listSessions()
  expect(items.map((s) => s.sessionId).sort()).toEqual(["s-here", "s-legacy"])
})

test("resumeSession renders the listing-preview transcript immediately", async () => {
  const client = new FakeClient()
  let historyCalls = 0
  client.listSessions = (async () => ({
    items: [{ sessionId: "s-1", updatedAt: 1, running: false, blank: false, cwd: "/tmp" }],
  })) as typeof client.listSessions
  client.history = (async () => {
    historyCalls += 1
    if (historyCalls === 1) {
      return {
        events: [
          {
            event: {
              type: "user/message",
              seq: 1,
              time: 1,
              data: { id: "m1", content: [{ type: "text", text: "历史消息" }], source: { kind: "user" } },
            },
          },
        ],
        hasMore: false,
      }
    }
    return { events: [], hasMore: false }
  }) as typeof client.history
  const session = createHarnessSession(client, "/tmp")
  const items = await session.listSessions()
  expect(items).toHaveLength(1)

  // The second history call (during resume re-sync) is empty, so the only way
  // the transcript shows is the listing preview seed.
  expect(await session.resumeSession(items[0]!.sessionId)).toBe(true)
  expect(session.messages().map((m) => m.content)).toContain("历史消息")
  expect(historyCalls).toBeGreaterThanOrEqual(2)
  session.dispose()
})

test("resumeLastSession fast-paths to the newest workspace session", async () => {
  const client = new FakeClient()
  client.listSessions = (async () => ({
    items: [
      { sessionId: "s-old", updatedAt: 10, running: false, blank: false, cwd: "/tmp" },
      { sessionId: "s-new", updatedAt: 20, running: false, blank: false, cwd: "/tmp" },
      { sessionId: "s-elsewhere", updatedAt: 30, running: false, blank: false, cwd: "/other" },
      { sessionId: "s-blank", updatedAt: 40, running: false, blank: true, cwd: "/tmp" },
    ],
  })) as typeof client.listSessions
  client.history = (async () => ({
    events: [
      {
        event: {
          type: "user/message",
          seq: 1,
          time: 1,
          data: { id: "m1", content: [{ type: "text", text: "上次的对话" }], source: { kind: "user" } },
        },
      },
    ],
    hasMore: false,
  })) as typeof client.history
  const session = createHarnessSession(client, "/tmp")

  expect(await session.resumeLastSession()).toBe("ok")
  expect(session.messages().map((m) => m.content)).toContain("上次的对话")
  session.dispose()
})

test("resumeLastSession reports none when the workspace has no sessions", async () => {
  const client = new FakeClient()
  client.listSessions = (async () => ({
    items: [
      { sessionId: "s-blank", updatedAt: 40, running: false, blank: true, cwd: "/tmp" },
      { sessionId: "s-elsewhere", updatedAt: 30, running: false, blank: false, cwd: "/other" },
    ],
  })) as typeof client.listSessions
  const session = createHarnessSession(client, "/tmp")
  expect(await session.resumeLastSession()).toBe("none")
  session.dispose()
})

test("late tool events attach to their turn's message instead of spawning a stray bottom card", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) }))
  await tick()
  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev("assistant/message", { message: { id: "a1", content: [{ type: "text", text: "final" }] } }, 6),
    }),
  )
  await tick()
  const before = session.messages().length

  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev("tool/call", { turn: 1, step: 1, callId: "c1", name: "read", arguments: JSON.stringify({ file_path: "x.ts" }) }, 7),
    }),
  )
  await tick()

  expect(session.messages().length).toBe(before)
  const last = session.messages()[session.messages().length - 1]
  expect(last?.toolCalls?.length).toBe(1)
  expect(last?.content).toBe("final")
})

test("slash commands fold into message cards via command/run and command/done", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev("command/run", { commandId: "cmd-1", name: "compact", source: { kind: "user" } }, 6),
    }),
  )
  await tick()
  let last = session.messages()[session.messages().length - 1]
  expect(last?.command?.name).toBe("compact")
  expect(last?.command?.status).toBe("running")
  expect(last?.content).toBe("/compact")

  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev("command/done", { commandId: "cmd-1", kind: "success", text: "已压缩" }, 7),
    }),
  )
  await tick()
  last = session.messages()[session.messages().length - 1]
  expect(last?.command?.status).toBe("ok")
  expect(last?.command?.resultText).toBe("已压缩")

  // Idempotent: a replayed command/run never appends a duplicate card.
  const before = session.messages().length
  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev("command/run", { commandId: "cmd-1", name: "compact", source: { kind: "user" } }, 8),
    }),
  )
  await tick()
  expect(session.messages().length).toBe(before)
})

test("command directory refresh and host dispatch", async () => {
  const client = new FakeClient()
  client.commandList = (async () => [{ name: "compact", description: "压缩历史", input: { hint: "" } }]) as unknown as typeof client.commandList
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  await session.refreshCommands()
  expect(session.commands()).toEqual([{ name: "compact", description: "压缩历史", input: { hint: "" } }])

  let executed = ""
  client.commandExecute = (async (_sessionId: string, line: string) => {
    executed = line
    return { commandId: "x", result: { kind: "success", text: "done" } }
  }) as unknown as typeof client.commandExecute
  const res = await session.runCommand("/compact")
  expect(res.ok).toBe(true)
  expect(executed).toBe("/compact")

  client.commandExecute = (async () => undefined) as unknown as typeof client.commandExecute
  const miss = await session.runCommand("/nope")
  expect(miss.ok).toBe(false)
})

test("/plan degrades to a plan-first message when the commands service is missing", async () => {
  const client = new FakeClient()
  client.commandExecute = (async () => {
    throw new HarnessError("harness endpoint /api/commands.execute not found — is this a DSH web instance?", "not-found")
  }) as unknown as typeof client.commandExecute
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  const res = await session.runCommand("/plan 重构模块 A")
  expect(res.ok).toBe(true)
  expect(res.text).toContain("commands 服务")
  expect(client.prompts.at(-1)?.text).toContain("重构模块 A")
  expect(client.prompts.at(-1)?.text).toContain("先只读探查")
})

test("/plan off degrades to an exit-plan-mode message when the commands service is missing", async () => {
  const client = new FakeClient()
  client.commandExecute = (async () => {
    throw new HarnessError("endpoint not found", "not-found")
  }) as unknown as typeof client.commandExecute
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  const res = await session.runCommand("/plan off")
  expect(res.ok).toBe(true)
  expect(client.prompts.at(-1)?.text).toContain("退出计划模式")
  expect(client.prompts.at(-1)?.text).toContain("exit_plan_mode")
})

test("bare /plan asks the agent to plan from the next step when the commands service is missing", async () => {
  const client = new FakeClient()
  client.commandExecute = (async () => {
    throw new HarnessError("endpoint not found", "not-found")
  }) as unknown as typeof client.commandExecute
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  const res = await session.runCommand("/plan")
  expect(res.ok).toBe(true)
  expect(res.text).toContain("从下一步开始按计划模式执行")
  expect(client.prompts).toHaveLength(2)
  expect(client.prompts.at(-1)?.text).toContain("从下一步开始按计划模式执行")
})

test("/plan degrades too when the commands service reports it unknown", async () => {
  const client = new FakeClient()
  client.commandExecute = (async () => undefined) as unknown as typeof client.commandExecute
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  const res = await session.runCommand("/plan 写测试")
  expect(res.ok).toBe(true)
  expect(client.prompts.at(-1)?.text).toContain("写测试")

  // Non-plan commands still report an unknown line instead of degrading.
  const miss = await session.runCommand("/nope")
  expect(miss.ok).toBe(false)
  expect(miss.text).toContain("未知或无法解析的命令")
})

test("session/queue frames fold into the pending-message dock", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  client.push({
    type: "server-request",
    rpcId: "q",
    method: "session/queue",
    payload: {
      sessionId: "s-1",
      items: [
        { id: "item-1", message: { id: "m-1", content: [{ type: "text", text: "排队消息" }] }, placement: "queued" },
        { id: "item-2", message: { id: "m-2", content: [{ type: "image", id: "i" }] }, placement: "steering" },
      ],
    },
  })
  await tick()
  const queue = session.queue()
  expect(queue.length).toBe(2)
  expect(queue[0]?.preview).toBe("排队消息")
  expect(queue[0]?.text).toBe("排队消息")
  expect(queue[1]?.text).toBeNull()
  expect(queue[1]?.preview).toContain("image")
})

test("queue actions dispatch edit/remove/steer to the harness", async () => {
  const client = new FakeClient()
  const calls: Array<{ itemId: string; action: unknown }> = []
  client.updateQueue = (async (_sessionId: string, itemId: string, action: never) => {
    calls.push({ itemId, action })
    return { accepted: true }
  }) as typeof client.updateQueue
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  expect(await session.updateQueueItem("q1", { kind: "remove" })).toBe(true)
  expect(await session.updateQueueItem("q2", { kind: "edit", content: [{ type: "text", text: "改" }] })).toBe(true)
  expect(await session.updateQueueItem("q3", { kind: "steer" })).toBe(true)
  expect(calls.map((c) => c.itemId)).toEqual(["q1", "q2", "q3"])
  expect(calls[1]?.action).toEqual({ kind: "edit", content: [{ type: "text", text: "改" }] })
})

test("session streams assistant text, reasoning and tool call results", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp", { minToolRunningMs: 0 })
  await session.start("hello")

  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("step/start", { turn: 1, step: 1 }, 6) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("assistant/chunk", { turn: 1, step: 1, chunk: { type: "reasoning-delta", text: "思考中" } }, 7) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("assistant/chunk", { turn: 1, step: 1, chunk: { type: "text-delta", text: "你好" } }, 8) }))
  await tick()
  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev("assistant/chunk", { turn: 1, step: 1, chunk: { type: "tool-call-delta", index: 0, id: "call_1", name: "bash", argumentsDelta: JSON.stringify({ command: "echo hi" }) } }, 9),
    }),
  )
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("tool/call", { callId: "call_1", name: "bash", arguments: JSON.stringify({ command: "echo hi" }) }, 10) }))
  await tick()
  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev(
        "tool/result",
        { message: { content: [{ type: "tool-result", toolCallId: "call_1", isError: false, content: [{ type: "text", text: "hi from mock" }] }] } },
        11,
      ),
    }),
  )
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("step/end", { turn: 1, step: 1 }, 12) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/end", { turn: 1, reason: { kind: "stop" } }, 13) }))
  await tick()

  const messages = session.messages()
  expect(messages).toHaveLength(2)
  const assistant = messages[1]
  expect(assistant?.role).toBe("assistant")
  expect(assistant?.thinking).toBe("思考中")
  expect(assistant?.content).toBe("你好")
  expect(assistant?.streaming).toBe(false)
  expect(assistant?.toolCalls?.[0]).toMatchObject({ id: "call_1", name: "bash", status: "ok", summary: "echo hi" })
  expect(assistant?.toolResults?.[0]).toMatchObject({ toolCallId: "call_1", ok: true, output: "hi from mock" })
  expect(session.stats().steps).toBe(1)
  expect(session.stats().llmMs).toBe(6_000)
  expect(session.stats().turns).toBe(1)
  expect(session.stats().toolMs).toBe(1_000)
  expect(session.busy()).toBe(false)
})

test("usage chunks accumulate canonical token stats without double counting", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  client.push(frame("session/event", { sessionId: "s-1", event: ev("user/message", { id: "echo", content: [{ type: "text", text: "hello" }] }, 5) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 6) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("step/start", { turn: 1, step: 1 }, 7) }))
  await tick()
  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev("assistant/chunk", { turn: 1, step: 1, chunk: { type: "usage", usage: { inputTokens: 100, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 5, reasoningTokens: 4 } } }, 8),
    }),
  )
  await tick()
  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev("assistant/message", { turn: 1, step: 1, message: { id: "am-1" }, usage: { inputTokens: 100, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 5, reasoningTokens: 4 } }, 9),
    }),
  )
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/end", { turn: 1, reason: { kind: "stop" } }, 10) }))
  await tick()

  expect(session.messages().filter((m) => m.role === "user")).toHaveLength(1)
  expect(session.stats().inTokens).toBe(100)
  expect(session.stats().outTokens).toBe(25)
  expect(session.stats().cacheReadTokens).toBe(50)
  expect(session.stats().cacheWriteTokens).toBe(5)
  expect(session.stats().reasoningTokens).toBe(4)
  expect(session.stats().turns).toBe(1)
  expect(session.stats().steps).toBe(1)
})

test("injected user/message echoes render as context-injection blocks", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  client.push(
    frame("session/event", {
      sessionId: "s-1",
      event: ev(
        "user/message",
        {
          id: "inj-1",
          content: [{ type: "text", text: "技能目录：\n- bash" }],
          source: { kind: "plugin", plugin: "skill-catalog", form: "catalog" },
        },
        5,
      ),
    }),
  )
  await tick()

  const injected = session.messages().find((m) => m.inject)
  expect(injected?.inject).toMatchObject({ source: "skill-catalog", form: "catalog" })
  expect(session.messages().filter((m) => m.role === "user" && !m.inject)).toHaveLength(1)

  // Direct user echoes stay skipped (the send path renders them locally).
  client.push(frame("session/event", { sessionId: "s-1", event: ev("user/message", { id: "um-1", content: [{ type: "text", text: "hello" }], source: { kind: "user" } }, 6) }))
  await tick()
  expect(session.messages().filter((m) => m.role === "user" && !m.inject)).toHaveLength(1)
})

test("first token latency averages across steps", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("step/start", { turn: 1, step: 1 }, 6) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("assistant/chunk", { turn: 1, step: 1, chunk: { type: "text-delta", text: "一" } }, 7) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("step/end", { turn: 1, step: 1 }, 8) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("step/start", { turn: 1, step: 2 }, 9) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("assistant/chunk", { turn: 1, step: 2, chunk: { type: "text-delta", text: "二" } }, 10) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("step/end", { turn: 1, step: 2 }, 11) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/end", { turn: 1, reason: { kind: "stop" } }, 12) }))
  await tick()

  // (7000-6000) + (10000-9000) / 2 = 1000ms average
  expect(session.stats().firstTokenMs).toBe(1000)
  expect(session.stats().firstTokenCount).toBe(2)
  expect(session.stats().llmMs).toBe(4_000)
  expect(session.stats().steps).toBe(2)
})

test("questions are surfaced and answers are sent back to the harness", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")
  await session.start("hello")

  client.push(
    frame("question/requested", {
      sessionId: "s-1",
      questions: [{ id: "q1", question: "允许执行 bash 吗？", options: [{ label: "Yes" }, { label: "No" }] }],
    }),
  )
  await tick()
  expect(session.question()?.kind).toBe("permission")
  expect(session.question()?.options).toEqual(["Yes", "No"])

  await session.answer("Yes")
  expect(client.responded).toEqual([{ rpcId: expect.any(String), sessionId: "s-1", answers: [{ id: "q1", selected: ["Yes"] }] }])
  expect(session.question()).toBeNull()
})

test("connection failure reports an error and keeps the session empty", async () => {
  const client = new FakeClient()
  client.failDescribe = true
  const session = createHarnessSession(client, "/tmp")

  const ok = await session.start("hello")

  expect(ok).toBe(false)
  expect(session.error()).toContain("无法连接")
  expect(session.messages()).toEqual([])
  expect(session.connected()).toBe(false)
})

test("second send reuses the same session", async () => {
  const client = new FakeClient()
  const session = createHarnessSession(client, "/tmp")

  await session.start("first")
  await session.send("second")
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/end", { turn: 1, reason: { kind: "stop" } }, 6) }))
  await tick()
  client.push(frame("session/event", { sessionId: "s-1", event: ev("turn/start", { turn: 2 }, 7) }))
  await tick()

  expect(client.created).toBe(1)
  expect(client.prompts.map((p) => p.text)).toEqual(["first", "second"])
  expect(session.stats().turns).toBe(2)
  expect(session.messages().filter((m) => m.role === "user").map((m) => m.content)).toEqual(["first", "second"])
})
