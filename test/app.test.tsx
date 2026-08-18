/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/app"
import type { HarnessClientLike, HostDescribe, ServerRequest, SessionEvent } from "../src/harness/client"

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
  prompts: Array<{ sessionId: string; text: string }> = []
  commandCalls: string[] = []
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

  async respond() {}

  async history() {
    return { events: [], hasMore: false }
  }

  async listSessions() {
    return { items: [] }
  }

  async commandList() {
    return [{ name: "compact", description: "Compact", input: undefined }]
  }

  async commandExecute(_sessionId: string, line: string) {
    this.commandCalls.push(line)
    return { commandId: "cmd-1", result: { kind: "success" as const, text: "No goal set." } }
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
  expect(client.prompts.map((p) => p.text)).toEqual(["hello"])
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
  expect(client.prompts.map((p) => p.text)).toEqual(["hello", "world"])
  const frame = app.captureCharFrame()
  expect(frame).toContain("hello")
  expect(frame).toContain("world")
})

test("session streams assistant replies and tool calls from the harness", async () => {
  const client = new FakeClient()
  const app = await testRender(() => <App client={client} />, { width: 80, height: 32 })
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

test("host /plan with a task from home mirrors the message and opens the session", async () => {
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
  // The task message is mirrored as a user message and the session screen is shown.
  expect(app.captureCharFrame()).toContain("帮我看看这个项目")
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
