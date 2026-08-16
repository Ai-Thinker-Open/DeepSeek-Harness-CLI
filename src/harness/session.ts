import { createSignal } from "solid-js"
import {
  EMPTY_STATS,
  type ChatMessage,
  type HarnessQuestion,
  type SessionStats,
  type ToolCallRecord,
  type ToolResultRecord,
} from "../session"
import { HarnessClient, type HarnessClientLike, type ServerRequest, type SessionEvent } from "./client"
import { assistantBlocksToMessage, blockText, summaryFor, tryParseArgs, type Block } from "./fold"

export interface HarnessSessionApi {
  messages: () => ChatMessage[]
  stats: () => SessionStats
  busy: () => boolean
  statusText: () => string
  question: () => HarnessQuestion | null
  error: () => string | null
  connected: () => boolean
  modelName: () => string
  start: (text: string) => Promise<boolean>
  send: (text: string) => Promise<boolean>
  answer: (choice: string) => Promise<void>
  cancelQuestion: () => Promise<void>
  abort: () => Promise<void>
  clearError: () => void
  dispose: () => void
}

const RECONNECT_DELAY_MS = 1500

export function describeHarnessError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return `无法连接 DeepSeek Harness：${message}`
}

export function createHarnessSession(
  client: HarnessClientLike = new HarnessClient(process.env.DSH_URL ?? "http://127.0.0.1:3080"),
  cwd = process.cwd(),
): HarnessSessionApi {
  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [stats, setStats] = createSignal<SessionStats>(EMPTY_STATS)
  const [busy, setBusy] = createSignal(false)
  const [statusText, setStatusText] = createSignal("")
  const [question, setQuestion] = createSignal<HarnessQuestion | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [connected, setConnected] = createSignal(false)
  const [modelName, setModelName] = createSignal("DeepSeek-V4-Flash")

  let sessionId: string | null = null
  let listening = false
  let abortController = new AbortController()
  let model: ChatMessage[] = []
  let statsModel: SessionStats = { ...EMPTY_STATS }
  let messageSeq = 0
  let turnStartMs: number | null = null
  let streamTurn: string | null = null
  let promptSentAt = 0
  let firstTokenDone = true

  // Solid's <For> memoizes items by object identity, so each sync must hand
  // out fresh message/tool objects or streaming updates would never re-render.
  const sync = () =>
    setMessages(
      model.map((m) => ({
        ...m,
        toolCalls: m.toolCalls ? m.toolCalls.map((c) => ({ ...c })) : undefined,
        toolResults: m.toolResults ? m.toolResults.map((r) => ({ ...r })) : undefined,
      })),
    )
  const syncStats = () => setStats({ ...statsModel })

  function appendUserMessage(text: string): void {
    model.push({
      id: `user-${++messageSeq}`,
      role: "user",
      content: text,
      createdAt: Date.now(),
    })
    statsModel.turns += 1
    sync()
    syncStats()
  }

  function rollbackLastUserMessage(): void {
    const last = model[model.length - 1]
    if (last?.role === "user") {
      model.pop()
      statsModel.turns = Math.max(0, statsModel.turns - 1)
      sync()
      syncStats()
    }
  }

  function lastAssistantMessage(): ChatMessage | undefined {
    return [...model].reverse().find((m) => m.role === "assistant")
  }

  /**
   * Return the streaming assistant message for the current turn, creating one
   * if turn/start was lost (the mux socket may not be open yet when the harness
   * starts emitting, so early events can be dropped).
   */
  function ensureStreamingAssistant(ev: SessionEvent): ChatMessage {
    const last = model[model.length - 1]
    if (last?.streaming) return last
    const m: ChatMessage = {
      id: `stream-${ev.seq}`,
      role: "assistant",
      content: "",
      createdAt: ev.time,
      streaming: true,
    }
    model.push(m)
    if (turnStartMs == null) turnStartMs = ev.time
    sync()
    return m
  }

  // ── live event folding ──────────────────────────────────────────────

  function onSessionEvent(ev: SessionEvent): void {
    switch (ev.type) {
      case "user/message":
        // User messages are appended locally on send; skip live echoes.
        break
      case "turn/start": {
        turnStartMs = ev.time
        streamTurn = ev.data.turn != null ? String(ev.data.turn) : null
        firstTokenDone = false
        setBusy(true)
        setStatusText("思考中…")
        model.push({
          id: `stream-${ev.seq}`,
          role: "assistant",
          content: "",
          createdAt: ev.time,
          streaming: true,
        })
        sync()
        break
      }
      case "assistant/chunk":
        onChunk(ev)
        break
      case "assistant/message":
        finalizeAssistant(ev)
        break
      case "tool/call":
        onToolCall(ev)
        break
      case "tool/result":
        onToolResult(ev)
        break
      case "turn/end": {
        if (turnStartMs != null) {
          statsModel.llmMs += Math.max(0, ev.time - turnStartMs)
          turnStartMs = null
          syncStats()
        }
        streamTurn = null
        const last = model[model.length - 1]
        if (last?.streaming) last.streaming = false
        setBusy(false)
        setStatusText("")
        sync()
        break
      }
      default:
        break
    }
  }

  function onChunk(ev: SessionEvent): void {
    const chunkTurn = ev.data.turn != null ? String(ev.data.turn) : null
    let last = model[model.length - 1]
    if (last?.streaming) {
      if (streamTurn != null && chunkTurn != null && chunkTurn !== streamTurn) return
    } else {
      if (streamTurn != null && chunkTurn != null && chunkTurn !== streamTurn) return
      last = ensureStreamingAssistant(ev)
      if (chunkTurn != null) streamTurn = chunkTurn
    }
    const chunk = ev.data.chunk as {
      type?: string
      index?: number
      text?: string
      id?: string
      name?: string
      argumentsDelta?: string
      usage?: unknown
    }
    if (!chunk?.type) return
    switch (chunk.type) {
      case "text-delta": {
        if (!firstTokenDone && promptSentAt > 0) {
          statsModel.firstTokenMs = Math.max(0, ev.time - promptSentAt)
          firstTokenDone = true
          syncStats()
        }
        last.content += chunk.text ?? ""
        sync()
        break
      }
      case "reasoning-delta":
        last.thinking = (last.thinking ?? "") + (chunk.text ?? "")
        sync()
        break
      case "tool-call-delta":
        appendStreamToolCallDelta(last, chunk)
        sync()
        break
      case "usage": {
        const u = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
        if (u) {
          statsModel.inTokens += u.prompt_tokens ?? 0
          statsModel.outTokens += u.completion_tokens ?? 0
          syncStats()
        }
        break
      }
    }
  }

  function appendStreamToolCallDelta(
    m: ChatMessage,
    delta: { index?: number; id?: string; name?: string; argumentsDelta?: string },
  ): void {
    m.toolCalls = m.toolCalls ?? []
    const index = delta.index ?? 0
    let call = m.toolCalls[index]
    if (!call) {
      call = { id: delta.id ?? `stream-tc-${index}`, name: "", args: {}, status: "running" }
      m.toolCalls[index] = call
    }
    if (delta.name) call.name += delta.name
    if (delta.id) call.id = delta.id
    if (delta.argumentsDelta) {
      call.args = mergeArgs(call.args as Record<string, unknown>, delta.argumentsDelta)
      const first = Object.values(call.args as Record<string, unknown>)[0]
      call.summary = String(typeof first === "string" ? first : call.name).slice(0, 80)
    }
  }

  function finalizeAssistant(ev: SessionEvent): void {
    const data = ev.data as { message?: { id?: string; content?: Block[] } }
    const blocks = data.message?.content
    const { content, thinking, toolCalls } = assistantBlocksToMessage(blocks ?? [], `ev-${ev.seq}`)
    const last = model[model.length - 1]
    if (last?.streaming) {
      last.streaming = false
      if (content) last.content = content
      if (thinking) last.thinking = thinking
      for (const tc of toolCalls) {
        const live = last.toolCalls?.find((c) => c.id === tc.id)
        if (!live) {
          last.toolCalls = last.toolCalls ?? []
          last.toolCalls.push(tc)
        }
      }
      sync()
    } else if (content || thinking || toolCalls.length) {
      model.push({
        id: `msg-${data.message?.id ?? ev.seq}`,
        role: "assistant",
        content,
        thinking: thinking || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        createdAt: ev.time,
      })
      sync()
    }
  }

  function onToolCall(ev: SessionEvent): void {
    const data = ev.data as { callId?: string; name?: string; arguments?: string }
    if (!data.callId || !data.name) return
    const args = tryParseArgs(data.arguments ?? "")
    const last = model[model.length - 1]
    const target = last?.streaming ? last : ensureStreamingAssistant(ev)
    target.toolCalls = target.toolCalls ?? []
    const call: ToolCallRecord = {
      id: data.callId,
      name: data.name,
      args,
      summary: summaryFor(data.name, args),
      status: "running",
      startedAt: ev.time,
    }
    const existing = target.toolCalls.find((c) => c.id === call.id)
    if (existing) Object.assign(existing, call)
    else target.toolCalls.push(call)
    statsModel.steps += 1
    setStatusText(`执行 ${data.name}…`)
    sync()
    syncStats()
  }

  function onToolResult(ev: SessionEvent): void {
    const block = (ev.data as { message?: { content?: Block[] } }).message?.content?.[0]
    if (!block || block.type !== "tool-result" || !block.toolCallId) return
    const result: ToolResultRecord = {
      toolCallId: block.toolCallId,
      ok: !block.isError,
      output: blockText(block.content),
    }
    const target = [...model].reverse().find((m) => m.toolCalls?.some((c) => c.id === block.toolCallId))
    if (target) {
      target.toolResults = target.toolResults ?? []
      const existing = target.toolResults.find((r) => r.toolCallId === block.toolCallId)
      if (existing) Object.assign(existing, result)
      else target.toolResults.push(result)
      const call = target.toolCalls?.find((c) => c.id === block.toolCallId)
      if (call) {
        call.status = result.ok ? "ok" : "error"
        call.finishedAt = ev.time
        if (call.startedAt != null) {
          statsModel.toolMs += Math.max(0, ev.time - call.startedAt)
          syncStats()
        }
      }
    }
    setStatusText("")
    sync()
  }

  // ── mux frames ──────────────────────────────────────────────────────

  function onFrame(frame: ServerRequest): void {
    const payload = frame.payload as { sessionId?: string; [k: string]: unknown }
    if (!payload.sessionId || payload.sessionId !== sessionId) return
    switch (frame.method) {
      case "session/event":
        onSessionEvent((payload as unknown as { event: SessionEvent }).event)
        break
      case "question/requested":
        onQuestionRequested(frame)
        break
      case "host/session-status":
        setBusy(Boolean((payload as { running?: boolean }).running))
        break
      case "host/agent-error":
        setError(String(payload.message ?? "agent error"))
        setBusy(false)
        setStatusText("")
        break
    }
  }

  function onQuestionRequested(frame: ServerRequest): void {
    const payload = frame.payload as {
      sessionId: string
      questions: Array<{
        id: string
        question: string
        header?: string
        detail?: string
        options?: Array<{ label: string; description?: string }>
        intent?: { kind: "plan-review"; approve: string }
      }>
    }
    const q = payload.questions[0]
    if (!q) return
    const options = q.options?.length ? q.options.map((o) => o.label) : ["Yes", "No"]
    const kind: HarnessQuestion["kind"] =
      q.intent?.kind === "plan-review"
        ? "plan-approval"
        : /allow|permission|deny|允许/i.test(`${q.header ?? ""} ${q.question} ${options.join(" ")}`)
          ? "permission"
          : "ask-user"
    setQuestion({
      rpcId: frame.rpcId,
      id: q.id,
      title: q.question,
      detail: q.detail ?? q.header,
      options,
      kind,
    })
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  function startListening(): void {
    if (listening) return
    listening = true
    void listenLoop()
  }

  async function listenLoop(): Promise<void> {
    while (!abortController.signal.aborted) {
      try {
        for await (const frame of client.eventStream(abortController.signal)) {
          onFrame(frame)
        }
        break // stream ended cleanly
      } catch {
        if (abortController.signal.aborted) break
        setConnected(false)
        setStatusText("连接中断，重连中…")
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS))
      }
    }
    listening = false
  }

  async function start(text: string): Promise<boolean> {
    if (!sessionId) {
      try {
        const info = await client.describe()
        setConnected(true)
        if (info.model) setModelName(info.model)
        const created = await client.createSession(cwd)
        sessionId = created.sessionId
        startListening()
      } catch (e) {
        setConnected(false)
        setError(describeHarnessError(e))
        return false
      }
    }
    return sendToSession(text)
  }

  async function send(text: string): Promise<boolean> {
    if (!sessionId) return start(text)
    return sendToSession(text)
  }

  async function sendToSession(text: string): Promise<boolean> {
    appendUserMessage(text)
    setBusy(true)
    setStatusText("发送中…")
    promptSentAt = Date.now()
    try {
      const res = await client.prompt(sessionId as string, text)
      if (!res.accepted) {
        rollbackLastUserMessage()
        setBusy(false)
        setStatusText("")
        setError("Harness 未接受这条消息")
        return false
      }
      return true
    } catch (e) {
      rollbackLastUserMessage()
      setBusy(false)
      setStatusText("")
      setError(describeHarnessError(e))
      return false
    }
  }

  async function answer(choice: string): Promise<void> {
    const q = question()
    if (!q || !sessionId) return
    setQuestion(null)
    setStatusText("")
    try {
      await client.respond(q.rpcId, sessionId, [{ id: q.id, selected: [choice] }])
    } catch {
      // answering is best-effort; the harness will time out if it fails
    }
  }

  async function cancelQuestion(): Promise<void> {
    const q = question()
    if (q?.options.length) await answer(q.options[q.options.length - 1] as string)
    else setQuestion(null)
  }

  async function abort(): Promise<void> {
    if (sessionId) {
      try {
        await client.cancel(sessionId)
      } catch {
        /* best-effort */
      }
    }
    setBusy(false)
    setStatusText("")
  }

  function clearError(): void {
    setError(null)
  }

  function dispose(): void {
    abortController.abort()
  }

  return {
    messages,
    stats,
    busy,
    statusText,
    question,
    error,
    connected,
    modelName,
    start,
    send,
    answer,
    cancelQuestion,
    abort,
    clearError,
    dispose,
  }
}

function mergeArgs(current: Record<string, unknown>, delta: string): Record<string, unknown> {
  try {
    return { ...current, ...JSON.parse(delta) }
  } catch {
    return current
  }
}
