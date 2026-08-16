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

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

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
  expect(frame).toContain("bash")
  expect(frame).toContain("✓")
  expect(frame).toContain("hi from mock")
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
