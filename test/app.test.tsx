/** @jsxImportSource @opentui/solid */
// Existing App-level tests exercise the startup flow after the risk gate;
// the gate itself is covered in test/directory-risk.test.tsx.
// Set the bypass in beforeEach (not at module top) so a shared test process
// never leaks it into sibling files mid-test.

import { beforeEach, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/app"
import type {
  HarnessClientLike,
  HostDescribe,
  ImageAttachmentRef,
  PromptContentPart,
  ServerRequest,
  SessionEvent,
  SessionSummary,
} from "../src/harness/client"

beforeEach(() => {
  process.env.DSH_SKIP_RISK_CONFIRM = "1"
  process.env.DSH_NO_UPDATE_CHECK = "1"
})

/** Plain text of a recorded prompt (for legacy text assertions). */
const promptText = (p: { content: PromptContentPart[] }): string =>
  p.content.filter((b) => b.type === "text").map((b) => b.text).join("")

type SpanLike = { text: string; fg: { r: number; g: number; b: number } }
type FrameLike = { captureSpans: () => { lines: Array<{ spans: SpanLike[] }> } }

function highlightedMode(app: FrameLike): string | null {
  const labels = ["Read only", "Workspace write", "Full access"]
  for (const line of app.captureSpans().lines) {
    for (const span of line.spans) {
      const label = labels.find((item) => span.text.includes(item))
      // The prompt footer renders the current mode label in primary blue (#4D6BFE)
      if (label && span.fg.b > 0.8 && span.fg.g < 0.6) return label
    }
  }
  return null
}

class FakeClient implements HarnessClientLike {
  describeResult: HostDescribe = { version: "mock", cwd: "/tmp", attachedSessions: 0, canOpenPath: true }
  failDescribe = false
  created = 0
  resumedId: string | null = null
  prompts: Array<{ sessionId: string; content: PromptContentPart[] }> = []
  commandCalls: string[] = []
  selectedModel: { provider: string; model: string } | null = null
  sessionsResult: SessionSummary[] = []
  apiKeyConfigured = true
  apiKeyUnsupported = false
  credentialsSetCalls: Array<{ ref: string; value: string }> = []
  private frames: ServerRequest[] = []
  private waiters: Array<(r: IteratorResult<ServerRequest>) => void> = []
  private closed = false

  async describe(): Promise<HostDescribe> {
    if (this.failDescribe) throw new Error("refused")
    return this.describeResult
  }

  async createSession(_cwd?: string, _agentPreset?: string, sessionId?: string) {
    if (sessionId) {
      this.resumedId = sessionId
      return { sessionId }
    }
    this.created += 1
    return { sessionId: `s-${this.created}` }
  }

  async prompt(sessionId: string, content: PromptContentPart[]) {
    this.prompts.push({ sessionId, content })
    return { accepted: true }
  }

  async readAttachment(): Promise<{ attachment: ImageAttachmentRef; data: string }> {
    throw new Error("not used in app tests")
  }

  async cancel() {
    return { accepted: true }
  }

  async respond() {}

  async respondApproval() {}

  async history() {
    return { events: [], hasMore: false }
  }

  async listSessions() {
    return { items: this.sessionsResult }
  }

  async searchSessions(_query: string) {
    return { items: [], hasMore: false }
  }

  async exportSession(_sessionId: string, _options?: { includeDescendants?: boolean }) {
    return { data: new Uint8Array([80, 75, 3, 4]), filename: "dsh-session-test.zip" }
  }

  async commandList() {
    return [{ name: "compact", description: "Compact", input: undefined }]
  }

  async commandExecute(_sessionId: string, line: string) {
    this.commandCalls.push(line)
    return { commandId: "cmd-1", result: { kind: "success" as const, text: "No goal set." } }
  }

  async listModels() {
    return {
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
    }
  }

  async selectModel(_sessionId: string, provider: string, model: string) {
    this.selectedModel = { provider, model }
    return { selected: { provider, model } }
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

  async credentialsDescribe(refs: string[]) {
    if (this.apiKeyUnsupported) throw new Error("credentials service unavailable")
    return Object.fromEntries(
      refs.map((ref) => [ref, { configured: this.apiKeyConfigured, writable: true }]),
    )
  }

  async credentialsSet(ref: string, value: string) {
    this.credentialsSetCalls.push({ ref, value })
    this.apiKeyConfigured = true
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

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

const ev = (type: string, data: Record<string, unknown>, seq: number, time = seq * 1000): SessionEvent => ({
  type,
  seq,
  time,
  data,
})

test("tab cycles permission mode and highlights the current one", async () => {
  const app = await testRender(() => <App client={new FakeClient()} />, { width: 80, height: 32 })
  await app.renderOnce()

  expect(highlightedMode(app)).toBe("Workspace write")

  app.mockInput.pressTab()
  await app.renderOnce()
  expect(highlightedMode(app)).toBe("Full access")

  app.mockInput.pressTab()
  await app.renderOnce()
  expect(highlightedMode(app)).toBe("Read only")

  app.mockInput.pressTab()
  await app.renderOnce()
  expect(highlightedMode(app)).toBe("Workspace write")

  app.mockInput.pressTab({ shift: true })
  await app.renderOnce()
  expect(highlightedMode(app)).toBe("Read only")
})

test("selecting text copies it and shows a toast", async () => {
  const app = await testRender(() => <App client={new FakeClient()} />, { width: 80, height: 32 })
  await app.renderOnce()

  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("tab 切换权限"))
  const x = lines[y]?.indexOf("tab 切换权限") ?? 0

  await app.mockMouse.drag(x, y, x + 12, y)
  await app.renderOnce()

  expect(app.captureCharFrame()).toContain("复制")
})

test("submitting on the home prompt opens the session with the first message", async () => {
  const client = new FakeClient()
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("hello")
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("hello")
  expect(frame).not.toContain("发送消息开始对话")
  expect(frame).not.toContain("esc 返回")
  expect(client.created).toBe(1)
  expect(client.prompts.map(promptText)).toEqual(["hello"])
})

test("later sends reuse the same session and append messages", async () => {
  const client = new FakeClient()
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("hello")
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  app.mockInput.typeText("world")
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  expect(client.created).toBe(1)
  expect(client.prompts.map(promptText)).toEqual(["hello", "world"])
  const frame = app.captureCharFrame()
  expect(frame).toContain("hello")
  expect(frame).toContain("world")
})

test("session streams assistant replies and tool calls from the harness", async () => {
  const client = new FakeClient()
  const app = await testRender(() => <App client={client} minToolRunningMs={0} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("hello")
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  client.push({ type: "server-request", rpcId: "m1", method: "session/event", payload: { sessionId: "s-1", event: ev("turn/start", { turn: 1 }, 5) } })
  await tick()
  client.push({ type: "server-request", rpcId: "m2", method: "session/event", payload: { sessionId: "s-1", event: ev("assistant/chunk", { turn: 1, chunk: { type: "text-delta", text: "好的" } }, 6) } })
  await tick()
  client.push(
    { type: "server-request", rpcId: "m3", method: "session/event", payload: { sessionId: "s-1", event: ev("assistant/chunk", { turn: 1, chunk: { type: "tool-call-delta", index: 0, id: "call_1", name: "bash", argumentsDelta: JSON.stringify({ command: "echo hi" }) } }, 7) } },
  )
  await tick()
  client.push({ type: "server-request", rpcId: "m4", method: "session/event", payload: { sessionId: "s-1", event: ev("tool/call", { callId: "call_1", name: "bash", arguments: JSON.stringify({ command: "echo hi" }) }, 8) } })
  await tick()
  client.push(
    { type: "server-request", rpcId: "m5", method: "session/event", payload: { sessionId: "s-1", event: ev("tool/result", { message: { content: [{ type: "tool-result", toolCallId: "call_1", isError: false, content: [{ type: "text", text: "hi from mock" }] }] } }, 9) } },
  )
  await tick()
  client.push({ type: "server-request", rpcId: "m6", method: "session/event", payload: { sessionId: "s-1", event: ev("turn/end", { turn: 1, reason: { kind: "stop" } }, 10) } })
  await tick()
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("好的")
  expect(frame).toContain("Bash · echo hi")
  // The settled tool card is collapsed; expand it to reveal the output.
  expect(frame).not.toContain("hi from mock")
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes("Bash ·"))
  const x = lines[y]?.indexOf("Bash") ?? 0
  await app.mockMouse.click(x + 1, y)
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("hi from mock")
})

test("slash commands dispatch to the harness and render the command card", async () => {
  const client = new FakeClient()
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("hello")
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  // Type "/goal": the inline slash menu filters to the command; Enter fills
  // it into the input, and a second Enter dispatches "/goal".
  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("goal")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter() // fills "/goal "
  await new Promise((r) => setTimeout(r, 50))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("/goal")
  app.mockInput.pressEnter() // submits /goal
  await new Promise((r) => setTimeout(r, 50))
  await app.renderOnce()

  expect(client.commandCalls).toContain("/goal")
  expect(app.captureCharFrame()).toContain("No goal set.")
  // /goal is transient like /plan: the summary arrives as a toast, not a
  // persistent "/goal" result panel above the composer.
  expect(app.captureCharFrame().split("\n").some((l) => l.trim() === "/goal")).toBe(false)

  // The harness emits the lifecycle events, which render the durable card.
  client.push({
    type: "server-request",
    rpcId: "m1",
    method: "session/event",
    payload: { sessionId: "s-1", event: ev("command/run", { commandId: "cmd-1", name: "goal", source: { kind: "user" } }, 11) },
  })
  await tick()
  client.push({
    type: "server-request",
    rpcId: "m2",
    method: "session/event",
    payload: { sessionId: "s-1", event: ev("command/done", { commandId: "cmd-1", kind: "success", text: "No goal set." }, 12) },
  })
  await tick()
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("/goal")
})

test("host slash command from home auto-creates a session and reaches the harness", async () => {
  const client = new FakeClient()
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  // Home screen: no session has been started yet.
  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("plan")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter() // fills "/plan "
  await new Promise((r) => setTimeout(r, 50))
  await app.renderOnce()
  app.mockInput.pressEnter() // submits /plan
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()

  expect(client.created).toBe(1)
  expect(client.commandCalls).toContain("/plan")
})

test("host /plan <task> from home switches into the session with the task", async () => {
  const client = new FakeClient()
  client.commandExecute = (async (_sessionId: string, line: string) => {
    client.commandCalls.push(line)
    return { commandId: "cmd-plan", result: { kind: "success" as const, text: "Plan mode on. Use /plan off to leave." } }
  }) as typeof client.commandExecute
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("plan 帮我看看这个项目")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter() // submits "/plan 帮我看看这个项目"
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()

  expect(client.created).toBe(1)
  expect(client.commandCalls).toContain("/plan 帮我看看这个项目")
  // The task is steered to the agent, so the app jumps into the session and
  // the mirrored task becomes the first visible message; the plan-mode notice
  // stays a transient toast (no "/plan" result panel above the composer).
  const frame = app.captureCharFrame()
  expect(frame).toContain("Plan mode on")
  expect(frame).toContain("帮我看看这个项目")
  expect(frame).not.toContain("DeepSeek Harness CLI")
  expect(frame).not.toContain("发送消息开始对话")
  expect(frame.split("\n").some((l) => l.trim() === "/plan")).toBe(false)
})

test("bare host /plan from home reports the mode toast and stays on home", async () => {
  const client = new FakeClient()
  client.commandExecute = (async (_sessionId: string, line: string) => {
    client.commandCalls.push(line)
    return { commandId: "cmd-plan", result: { kind: "success" as const, text: "Plan mode on. Use /plan off to leave." } }
  }) as typeof client.commandExecute
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("plan")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter() // fills "/plan "
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter() // submits "/plan"
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()

  expect(client.commandCalls).toContain("/plan")
  const frame = app.captureCharFrame()
  expect(frame).toContain("Plan mode on")
  expect(frame).toContain("DeepSeek Harness CLI")
})

test("generic host command result arrives as a toast instead of a panel", async () => {
  const client = new FakeClient()
  client.commandExecute = (async (_sessionId: string, line: string) => {
    client.commandCalls.push(line)
    return { commandId: "cmd-compact", result: { kind: "success" as const, text: "已压缩历史，释放 12 条消息" } }
  }) as typeof client.commandExecute
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("compact")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter() // runs /compact immediately
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()

  expect(client.commandCalls).toContain("/compact")
  const frame = app.captureCharFrame()
  expect(frame).toContain("已压缩历史，释放 12 条消息")
  expect(frame.split("\n").some((l) => l.trim() === "/compact")).toBe(false)
})

test("/sessions lists first message, time and short id", async () => {
  const client = new FakeClient()
  client.listSessions = (async () => ({
    items: [
      {
        sessionId: "s-msuixsmncjo6gs",
        updatedAt: 1_787_060_000_000,
        running: false,
        blank: false,
        cwd: process.cwd(),
      },
    ],
  })) as unknown as typeof client.listSessions
  client.history = (async (_sessionId: string) => ({
    events: [
      {
        event: {
          type: "user/message",
          seq: 1,
          time: 1_787_060_000_000,
          data: { id: "m1", content: [{ type: "text", text: "帮我看看这个项目" }], source: { kind: "user" } },
        },
      },
    ],
    hasMore: false,
  })) as unknown as typeof client.history
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("sess")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter() // run-type command executes immediately
  await tick()
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("帮我看看这个项目")
  expect(frame).toContain("msuixsmn") // session id without the `s-` prefix, first 8
})

test("clicking a session row resumes it into the session screen", async () => {
  const client = new FakeClient()
  let historyCalls = 0
  client.listSessions = (async () => ({
    items: [
      {
        sessionId: "s-msuixsmncjo6gs",
        updatedAt: 1_787_060_000_000,
        running: false,
        blank: false,
        cwd: process.cwd(),
      },
    ],
  })) as unknown as typeof client.listSessions
  client.history = (async (sessionId: string) => {
    historyCalls += 1
    return {
      events: [
        {
          event: {
            type: "user/message",
            seq: 1,
            time: 1_787_060_000_000,
            data: { id: "m1", content: [{ type: "text", text: "帮我看看这个项目" }], source: { kind: "user" } },
          },
        },
      ],
      hasMore: false,
      projections: sessionId ? {} : undefined,
    }
  }) as unknown as typeof client.history
  const app = await testRender(() => <App client={client} />, { width: 90, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("sess")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("msuixsmn"))
  const x = lines[y]?.indexOf("msuixsmn") ?? 0
  await app.mockMouse.click(x + 1, y)
  await tick()
  await app.renderOnce()

  // The session screen is shown with the resumed transcript.
  expect(app.captureCharFrame()).toContain("帮我看看这个项目")
  expect(historyCalls).toBeGreaterThanOrEqual(2) // list preview + resume replay
})

test("/model lists models and clicking a row switches the LLM", async () => {
  const client = new FakeClient()
  const app = await testRender(() => <App client={client} />, { width: 90, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("model")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter() // run-type command executes immediately
  await tick()
  await app.renderOnce()

  let frame = app.captureCharFrame()
  expect(frame).toContain("当前模型")
  expect(frame).toContain("DeepSeek-V4-Flash")

  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes("DeepSeek-V4-Flash"))
  const x = lines[y]?.indexOf("DeepSeek-V4-Flash") ?? 0
  await app.mockMouse.click(x + 1, y)
  await tick()
  await app.renderOnce()

  expect(client.selectedModel?.model).toBe("deepseek-v4-flash")
  frame = app.captureCharFrame()
  // The refreshed panel marks the new model as current.
  expect(frame).toContain("DeepSeek-V4-Flash")
})

test("/model panel navigates with arrow keys and Enter confirms", async () => {
  const client = new FakeClient()
  const app = await testRender(() => <App client={client} />, { width: 90, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("model")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  // First interactive row is the current model (DeepSeek-V4); move down to
  // DeepSeek-V4-Flash and press Enter to confirm the switch.
  app.mockInput.pressArrow("down")
  await new Promise((r) => setTimeout(r, 50))
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  expect(client.selectedModel?.model).toBe("deepseek-v4-flash")
  // Confirming closes the picker panel.
  expect(app.captureCharFrame()).not.toContain("当前模型")
})

test("/rename renames the session and /fork creates a child session", async () => {
  const client = new FakeClient()
  client.renameSession = (async (_id: string, title: string) => ({ title })) as typeof client.renameSession
  client.forkSession = (async () => ({ sessionId: "s-forked123456" })) as typeof client.forkSession
  const app = await testRender(() => <App client={client} />, { width: 90, height: 32 })
  await app.renderOnce()

  // /rename <标题> fills the input first, then submits.
  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("rename")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter() // fill "/rename "
  await new Promise((r) => setTimeout(r, 50))
  await app.renderOnce()
  app.mockInput.typeText("我的新会话")
  await new Promise((r) => setTimeout(r, 50))
  await app.renderOnce()
  app.mockInput.pressEnter() // submit /rename 我的新会话
  await tick()
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("已重命名为：我的新会话")

  // /fork runs immediately.
  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("fork")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("已创建新会话")
})

test("skills appear as slash commands and submit as messages", async () => {
  const client = new FakeClient()
  client.skillList = (async () => ({
    skills: [
      { name: "opentui", description: "Build terminal UIs with OpenTUI", modelInvocable: true },
      { name: "imagegen", description: "Generate raster images", modelInvocable: true },
    ],
  })) as typeof client.skillList
  const app = await testRender(() => <App client={client} />, { width: 90, height: 32 })
  await app.renderOnce()

  // Start a session first so the skill catalog is reachable.
  app.mockInput.typeText("hello")
  await new Promise((r) => setTimeout(r, 50))
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 120))
  await app.renderOnce()
  app.mockInput.typeText("opentui")
  await new Promise((r) => setTimeout(r, 120))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("/opentui")

  app.mockInput.pressEnter() // run-type: submits the skill line as a message
  await tick()
  await app.renderOnce()

  expect(client.prompts.some((p) => promptText(p) === "/opentui")).toBe(true)
})

test("unknown slash command shows a toast instead of a result panel", async () => {
  const client = new FakeClient()
  client.commandExecute = (async () => undefined) as unknown as typeof client.commandExecute
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("/")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.typeText("nope")
  await new Promise((r) => setTimeout(r, 80))
  await app.renderOnce()
  app.mockInput.pressEnter()
  await new Promise((r) => setTimeout(r, 50))
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("未知或无法解析的命令")
  expect(frame).not.toContain("▸ /nope")
  // The input is clear again instead of showing a command-result panel.
  expect(app.captureCharFrame().includes("给智能体发消息")).toBe(true)
})

test("connection failure shows an error toast and stays on home", async () => {
  const client = new FakeClient()
  client.failDescribe = true
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("hello")
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("无法连接 DeepSeek Harness")
  expect(frame).toContain("DeepSeek Harness CLI")
  expect(frame).not.toContain("发送消息开始对话")
})

test("continueLast resumes the newest session and jumps into it", async () => {
  const client = new FakeClient()
  client.sessionsResult = [
    { sessionId: "s-older", updatedAt: 10, running: false, blank: false },
    { sessionId: "s-newer", updatedAt: 20, running: false, blank: false },
    { sessionId: "s-blank", updatedAt: 30, running: false, blank: true },
  ]
  const app = await testRender(() => <App client={client} continueLast />, { width: 80, height: 32 })
  await app.renderOnce()
  await tick(80)
  await app.renderOnce()

  const frame = app.captureCharFrame()
  // The session screen shows the (empty) resumed conversation.
  expect(frame).toContain("发送消息开始对话")
  expect(client.resumedId).toBe("s-newer")
})

test("continueLast opens the session screen immediately without a home flash", async () => {
  const client = new FakeClient()
  client.sessionsResult = [
    { sessionId: "s-newer", updatedAt: 20, running: false, blank: false, cwd: process.cwd() },
  ]
  const app = await testRender(() => <App client={client} continueLast />, { width: 80, height: 32 })
  await app.renderOnce()

  // The very first frame is already the session screen, not the home page.
  expect(app.captureCharFrame()).toContain("发送消息开始对话")
  expect(app.captureCharFrame()).not.toContain("DeepSeek Harness CLI")
  await tick(80)
  await app.renderOnce()
  expect(client.resumedId).toBe("s-newer")
})

test("continueLast without sessions stays on home with a toast", async () => {
  const client = new FakeClient()
  const app = await testRender(() => <App client={client} continueLast />, { width: 80, height: 32 })
  await app.renderOnce()
  await tick(80)
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("DeepSeek Harness CLI")
  expect(frame).not.toContain("发送消息开始对话")
  expect(frame).toContain("没有可继续的会话")
})

test("continueLast failure toast includes the underlying reason", async () => {
  const client = new FakeClient()
  client.listSessions = (async () => {
    throw new Error("harness unreachable: fetch failed")
  }) as typeof client.listSessions
  const app = await testRender(() => <App client={client} continueLast />, { width: 80, height: 32 })
  await app.renderOnce()
  await tick(80)
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("继续上次会话失败")
  expect(frame).toContain("harness unreachable")
  expect(frame).toContain("DeepSeek Harness CLI")
})

test("missing API key opens the masked input modal with the gray placeholder", async () => {
  const client = new FakeClient()
  client.apiKeyConfigured = false
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()
  await tick(80)
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("DeepSeek API Key")
  expect(frame).toContain("请输入DeepSeek API Key")
  // The modal blocks the home screen and no key is saved yet.
  expect(frame).not.toContain("给智能体发消息")
  expect(client.credentialsSetCalls).toHaveLength(0)
})

test("entering a key and confirming saves it and closes the modal", async () => {
  const client = new FakeClient()
  client.apiKeyConfigured = false
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()
  await tick(80)
  await app.renderOnce()

  app.mockInput.typeText("sk-abc123")
  await app.renderOnce()
  app.mockInput.pressEnter()
  await tick()
  await app.renderOnce()

  expect(client.credentialsSetCalls).toEqual([{ ref: "DEEPSEEK_API_KEY", value: "sk-abc123" }])
  const frame = app.captureCharFrame()
  expect(frame).not.toContain("请输入DeepSeek API Key")
  expect(frame).toContain("给智能体发消息")
})

test("escaping the API key prompt skips it and continues startup", async () => {
  const client = new FakeClient()
  client.apiKeyConfigured = false
  client.sessionsResult = [
    { sessionId: "s-last", updatedAt: 20, running: false, blank: false, cwd: process.cwd() },
  ]
  const app = await testRender(() => <App client={client} continueLast />, { width: 80, height: 32 })
  await app.renderOnce()
  await tick(80)
  await app.renderOnce()

  expect(app.captureCharFrame()).toContain("请输入DeepSeek API Key")
  app.mockInput.pressEscape()
  await tick(80)
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).not.toContain("DeepSeek API Key")
  // Resume still runs after skipping: the session screen opens.
  expect(frame).toContain("发送消息开始对话")
  expect(client.resumedId).toBe("s-last")
  expect(client.credentialsSetCalls).toHaveLength(0)
})

test("API key prompt is skipped when the credentials service is unavailable", async () => {
  const client = new FakeClient()
  client.apiKeyUnsupported = true
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
  await app.renderOnce()
  await tick(80)
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).not.toContain("请输入DeepSeek API Key")
  expect(frame).toContain("给智能体发消息")
})
