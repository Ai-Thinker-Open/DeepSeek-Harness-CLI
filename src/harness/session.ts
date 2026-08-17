import { createSignal } from "solid-js"
import {
  DEEP_DIVING_STATUS,
  EMPTY_STATS,
  type ChatMessage,
  type HarnessQuestion,
  type SessionStats,
  type ToolCallRecord,
  type ToolResultRecord,
} from "../session"
import {
  HarnessClient,
  type CommandDescriptor,
  type HarnessClientLike,
  type ServerRequest,
  type SessionEvent,
  type SessionSummary,
} from "./client"
import {
  assistantBlocksToMessage,
  blockText,
  foldHistory,
  injectSourceTitle,
  isInjectedSource,
  MAX_INJECT_CHARS,
  MAX_CONTENT_CHARS,
  MAX_THINKING_CHARS,
  MAX_TOOL_OUTPUT_CHARS,
  summaryFor,
  truncateText,
  tryParseArgs,
  type Block,
  type UserMessageSource,
} from "./fold"

export interface HarnessSessionApi {
  messages: () => ChatMessage[]
  stats: () => SessionStats
  busy: () => boolean
  statusText: () => string
  commands: () => CommandDescriptor[]
  commandsLoading: () => boolean
  refreshCommands: () => Promise<void>
  runCommand: (line: string) => Promise<{ ok: boolean; text?: string }>
  listSessions: () => Promise<SessionSummary[]>
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
  options: { stallResyncMs?: number } = {},
): HarnessSessionApi {
  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [stats, setStats] = createSignal<SessionStats>(EMPTY_STATS)
  const [busy, setBusy] = createSignal(false)
  const [statusText, setStatusText] = createSignal("")
  const [question, setQuestion] = createSignal<HarnessQuestion | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [connected, setConnected] = createSignal(false)
  const [modelName, setModelName] = createSignal("DeepSeek-V4-Flash")
  const [commands, setCommands] = createSignal<CommandDescriptor[]>([])
  const [commandsLoading, setCommandsLoading] = createSignal(false)

  let sessionId: string | null = null
  let listening = false
  let abortController = new AbortController()
  let model: ChatMessage[] = []
  let statsModel: SessionStats = { ...EMPTY_STATS }
  let messageSeq = 0
  let turnStartAt: number | null = null
  let stepStartAt: number | null = null
  let turnStepEnds = 0
  let streamTurn: string | null = null
  let promptSentAt = 0
  let firstTokenDone = true
  /** Silence watchdog: while a message is streaming, no frame for this long
   *  means the downlink is wedged (or the turn died) — force a reconnect and
   *  re-sync from durable history so a stuck ▍ cursor can never persist. */
  const stallResyncMs = options.stallResyncMs ?? 20_000
  const stallCheckMs = Math.min(5_000, Math.max(50, Math.floor(stallResyncMs / 3)))
  let lastFrameAt = 0
  let lastResyncAt = 0
  let streamAbort: AbortController | null = null
  let stallTimer: ReturnType<typeof setInterval> | undefined
  const usageByStep = new Map<string, { in: number; out: number; cr: number; cw: number; re: number }>()

  // Solid's <For> memoizes items by object identity. To make only the touched
  // message re-render (and not the whole conversation on every stream chunk),
  // pushes/removals replace the array with the same object references, while
  // in-place mutations go through `touch`, which hands out a fresh copy of
  // just that one message (and its tool rows).
  const cloneMessage = (m: ChatMessage): ChatMessage => ({
    ...m,
    toolCalls: m.toolCalls ? m.toolCalls.map((c) => ({ ...c })) : undefined,
    toolResults: m.toolResults ? m.toolResults.map((r) => ({ ...r })) : undefined,
  })
  // Chunk streams can arrive far faster than the 30fps renderer. Instead of
  // pushing a fresh array (and re-rendering the touched message) for every
  // chunk, in-place mutations are collected and flushed once per frame so the
  // event loop is not saturated during heavy reasoning bursts.
  let dirty = new Set<ChatMessage>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const flushTouchedNow = () => {
    if (flushTimer != null) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    if (dirty.size === 0) return
    const targets = dirty
    dirty = new Set()
    setMessages(model.map((m) => (targets.has(m) ? cloneMessage(m) : m)))
  }
  const touch = (target: ChatMessage) => {
    dirty.add(target)
    if (flushTimer == null) flushTimer = setTimeout(flushTouchedNow, 32)
  }
  const syncAll = () => {
    flushTouchedNow()
    setMessages([...model])
  }
  const syncStats = () => setStats({ ...statsModel })

  function appendUserMessage(text: string): void {
    model.push({
      id: `user-${++messageSeq}`,
      role: "user",
      content: text,
      createdAt: Date.now(),
    })
    syncAll()
    syncStats()
  }

  function rollbackLastUserMessage(): void {
    const last = model[model.length - 1]
    if (last?.role === "user") {
      model.pop()
      syncAll()
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
      turn: typeof ev.data.turn === "number" ? ev.data.turn : undefined,
      createdAt: ev.time,
      streaming: true,
    }
    model.push(m)
    if (turnStartAt == null) turnStartAt = ev.time
    syncAll()
    return m
  }

  interface NormalizedUsage {
    in: number
    out: number
    cr: number
    cw: number
    re: number
  }

  function normalizeUsage(u: Record<string, unknown>): NormalizedUsage {
    return {
      in: Number(u.inputTokens ?? u.prompt_tokens ?? 0) || 0,
      out: Number(u.outputTokens ?? u.completion_tokens ?? 0) || 0,
      cr: Number(u.cacheReadTokens ?? 0) || 0,
      cw: Number(u.cacheWriteTokens ?? 0) || 0,
      re: Number(u.reasoningTokens ?? 0) || 0,
    }
  }

  /** Fold one step's token usage into the totals without double counting when
   *  both the usage chunk and the assembled assistant/message carry it. */
  function addUsage(norm: NormalizedUsage, turn?: number, step?: number): void {
    const key = turn != null && step != null ? `${turn}:${step}` : null
    const prev = key ? usageByStep.get(key) : undefined
    const delta = key
      ? {
          in: norm.in - (prev?.in ?? 0),
          out: norm.out - (prev?.out ?? 0),
          cr: norm.cr - (prev?.cr ?? 0),
          cw: norm.cw - (prev?.cw ?? 0),
          re: norm.re - (prev?.re ?? 0),
        }
      : norm
    if (key) usageByStep.set(key, norm)
    statsModel.inTokens = Math.max(0, statsModel.inTokens + delta.in)
    statsModel.outTokens = Math.max(0, statsModel.outTokens + delta.out)
    statsModel.cacheReadTokens = Math.max(0, statsModel.cacheReadTokens + delta.cr)
    statsModel.cacheWriteTokens = Math.max(0, statsModel.cacheWriteTokens + delta.cw)
    statsModel.reasoningTokens = Math.max(0, statsModel.reasoningTokens + delta.re)
  }

  function recordFirstToken(ev: SessionEvent): void {
    const base = stepStartAt ?? (promptSentAt > 0 ? promptSentAt : null)
    if (base == null) return
    statsModel.firstTokenSumMs += Math.max(0, ev.time - base)
    statsModel.firstTokenCount += 1
    statsModel.firstTokenMs = Math.round(statsModel.firstTokenSumMs / statsModel.firstTokenCount)
  }

  // ── live event folding ──────────────────────────────────────────────

  function onSessionEvent(ev: SessionEvent): void {
    switch (ev.type) {
      case "user/message": {
        const data = ev.data as unknown as { id?: string; content?: Block[]; source?: UserMessageSource }
        if (isInjectedSource(data.source)) {
          const title = injectSourceTitle(data.source)
          const { text, truncated } = truncateText(blockText(data.content), MAX_INJECT_CHARS)
          const id = `msg-${data.id ?? ev.seq}`
          if (!model.some((m) => m.inject && m.id === id)) {
            model.push({
              id,
              role: "user",
              content: truncated ? `${text}\n… (内容已截断)` : text,
              inject: {
                source: title || "unknown",
                form: data.source?.form,
                summary: data.source?.summary,
              },
              createdAt: ev.time,
            })
            syncAll()
          }
        }
        // Direct user messages are appended locally on send; skip live echoes.
        break
      }
      case "turn/start": {
        turnStartAt = ev.time
        turnStepEnds = 0
        statsModel.turns += 1
        streamTurn = ev.data.turn != null ? String(ev.data.turn) : null
        firstTokenDone = false
        setBusy(true)
        setStatusText(DEEP_DIVING_STATUS)
        model.push({
          id: `stream-${ev.seq}`,
          role: "assistant",
          content: "",
          turn: ev.data.turn != null ? Number(ev.data.turn) : undefined,
          createdAt: ev.time,
          streaming: true,
        })
        syncAll()
        syncStats()
        break
      }
      case "step/start": {
        stepStartAt = ev.time
        firstTokenDone = false
        statsModel.steps += 1
        syncStats()
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
      case "step/end": {
        if (stepStartAt != null) {
          statsModel.llmMs += Math.max(0, ev.time - stepStartAt)
          stepStartAt = null
          turnStepEnds += 1
        }
        syncStats()
        break
      }
      case "turn/end": {
        // Fallback for harnesses that do not emit step/end: charge the whole
        // turn to the LLM only when no step completed during it.
        if (turnStartAt != null && turnStepEnds === 0) {
          statsModel.llmMs += Math.max(0, ev.time - turnStartAt)
        }
        turnStartAt = null
        stepStartAt = null
        streamTurn = null
        const last = model[model.length - 1]
        const wasStreaming = Boolean(last?.streaming)
        if (last?.streaming) last.streaming = false
        setBusy(false)
        setStatusText("")
        if (wasStreaming) touch(last as ChatMessage)
        syncStats()
        break
      }
      case "request/context": {
        const ctx = ev.data as { provider?: string; model?: string }
        const name = ctx.model ?? ctx.provider
        if (name) setModelName(name)
        break
      }
      case "command/run": {
        const data = ev.data as { commandId?: string; name?: string; args?: string }
        if (!data.commandId || !data.name) break
        if (!model.some((m) => m.command?.commandId === data.commandId)) {
          model.push({
            id: `cmd-${data.commandId}`,
            role: "user",
            content: `/${data.name}${data.args ?? ""}`,
            command: { commandId: data.commandId, name: data.name, args: data.args, status: "running" },
            createdAt: ev.time,
          })
          syncAll()
        }
        break
      }
      case "command/done": {
        const data = ev.data as { commandId?: string; kind?: "success" | "error"; text?: string }
        if (!data.commandId) break
        const msg = model.find((m) => m.command?.commandId === data.commandId)
        if (msg?.command) {
          msg.command.status = data.kind === "success" ? "ok" : "error"
          if (data.text) msg.command.resultText = data.text
          touch(msg)
        }
        break
      }
      default:
        break
    }
  }

  function onChunk(ev: SessionEvent): void {
    const chunkTurn = ev.data.turn != null ? String(ev.data.turn) : null
    const chunkStep = ev.data.step != null ? Number(ev.data.step) : undefined
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
        if (!firstTokenDone) {
          recordFirstToken(ev)
          firstTokenDone = true
          syncStats()
        }
        const delta = chunk.text ?? ""
        if (last.content.length < MAX_CONTENT_CHARS) last.content += delta
        touch(last)
        break
      }
      case "reasoning-delta":
        if ((last.thinking?.length ?? 0) < MAX_THINKING_CHARS) {
          last.thinking = (last.thinking ?? "") + (chunk.text ?? "")
        }
        touch(last)
        break
      case "tool-call-delta":
        appendStreamToolCallDelta(last, chunk, chunkStep ?? null)
        touch(last)
        break
      case "usage": {
        const u = chunk.usage as Record<string, unknown> | undefined
        if (u) {
          addUsage(normalizeUsage(u), chunkTurn != null ? Number(chunkTurn) : undefined, chunkStep)
          syncStats()
        }
        break
      }
    }
  }

  function appendStreamToolCallDelta(
    m: ChatMessage,
    delta: { index?: number; id?: string; name?: string; argumentsDelta?: string },
    step: number | null,
  ): void {
    m.toolCalls = m.toolCalls ?? []
    const index = delta.index ?? 0
    // Stream indices reset at every model step, so a slot is only reusable
    // within the same step; a later step reusing index 0 gets its own call.
    let call = m.toolCalls.find((c) => c.index === index && c.step === step)
    if (!call) {
      call = { id: delta.id ?? `stream-tc-${index}`, name: "", args: {}, status: "running", step, index }
      m.toolCalls.push(call)
    }
    if (delta.name) call.name = delta.name
    if (delta.id) call.id = delta.id
    if (delta.argumentsDelta) {
      call.args = mergeArgs(call.args as Record<string, unknown>, delta.argumentsDelta)
      call.summary = summaryFor(call.name, call.args as Record<string, unknown>)
    }
  }

  function finalizeAssistant(ev: SessionEvent): void {
    const data = ev.data as {
      message?: { id?: string; content?: Block[] }
      usage?: Record<string, unknown>
      turn?: number
      step?: number
    }
    const blocks = data.message?.content
    const { content, thinking, toolCalls } = assistantBlocksToMessage(blocks ?? [], `ev-${ev.seq}`)
    const boundedContent = truncateText(content, MAX_CONTENT_CHARS)
    const boundedThinking = truncateText(thinking, MAX_THINKING_CHARS)
    const finalContent = boundedContent.truncated ? `${boundedContent.text}\n… (内容过长，已截断)` : boundedContent.text
    const finalThinking = boundedThinking.truncated
      ? `${boundedThinking.text}\n… (推理过长，已截断)`
      : boundedThinking.text
    if (data.usage) {
      addUsage(normalizeUsage(data.usage), data.turn, data.step)
      syncStats()
    }
    const last = model[model.length - 1]
    const msgId = `msg-${data.message?.id ?? ev.seq}`
    const existing = model.find((m) => m.id === msgId)
    if (existing) {
      // Idempotent finalize (survives a history re-sync racing the live event).
      existing.streaming = false
      if (content) existing.content = finalContent
      if (thinking) existing.thinking = finalThinking || undefined
      for (const tc of toolCalls) {
        if (!existing.toolCalls?.some((c) => c.id === tc.id)) {
          existing.toolCalls = [...(existing.toolCalls ?? []), tc]
        }
      }
      touch(existing)
    } else if (last?.streaming) {
      last.streaming = false
      if (content) last.content = finalContent
      if (thinking) last.thinking = finalThinking
      for (const tc of toolCalls) {
        const live = last.toolCalls?.find((c) => c.id === tc.id)
        if (!live) {
          last.toolCalls = last.toolCalls ?? []
          last.toolCalls.push(tc)
        }
      }
      touch(last)
    } else if (content || thinking || toolCalls.length) {
      model.push({
        id: msgId,
        role: "assistant",
        content: finalContent,
        thinking: finalThinking || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        turn: data.turn,
        createdAt: ev.time,
      })
      syncAll()
    }
  }

  function onToolCall(ev: SessionEvent): void {
    const data = ev.data as { callId?: string; name?: string; arguments?: string; step?: number; turn?: number }
    if (process.env.DSH_DEBUG) console.error("[dsh] tool/call", JSON.stringify(data))
    if (!data.callId || !data.name) return
    const args = tryParseArgs(data.arguments ?? "")
    const last = model[model.length - 1]
    const evTurn = typeof data.turn === "number" ? data.turn : undefined
    let target: ChatMessage | undefined
    if (last?.streaming) {
      target = last
    } else if (last?.role === "assistant" && last.turn === evTurn) {
      // Late tool events (arriving after assistant/message finalized the turn,
      // or replayed after a reconnect) belong to that turn's message — attach
      // instead of spawning a stray card-only message at the bottom.
      target = last
    } else {
      target = ensureStreamingAssistant(ev)
    }
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
    if (existing) {
      Object.assign(existing, call)
    } else {
      // The stream may have created a placeholder with a synthetic id; adopt
      // it so we don't end up with two cards for one call.
      const placeholder = target.toolCalls.find(
        (c) => c.id.startsWith("stream-tc-") && c.name === call.name && c.step === (data.step ?? null),
      )
      if (placeholder) Object.assign(placeholder, call)
      else target.toolCalls.push(call)
    }
    touch(target)
    syncStats()
  }

  function onToolResult(ev: SessionEvent): void {
    const block = (ev.data as { message?: { content?: Block[] } }).message?.content?.[0]
    if (process.env.DSH_DEBUG) console.error("[dsh] tool/result", JSON.stringify(ev.data))
    if (!block || block.type !== "tool-result" || !block.toolCallId) return
    const { text, truncated } = truncateText(blockText(block.content), MAX_TOOL_OUTPUT_CHARS)
    const result: ToolResultRecord = {
      toolCallId: block.toolCallId,
      ok: !block.isError,
      output: text,
      truncated,
      meta: (ev.data as { meta?: unknown }).meta,
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
    if (target) touch(target)
  }

  // ── mux frames ──────────────────────────────────────────────────────

  function onFrame(frame: ServerRequest): void {
    const payload = frame.payload as { sessionId?: string; [k: string]: unknown }
    if (frame.method !== "host/remote-event" && (!payload.sessionId || payload.sessionId !== sessionId)) return
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
      case "host/remote-event":
        if ((payload as { event?: string }).event === "commands/change") {
          void refreshCommands()
        }
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

  /** Watch for a wedged downlink while a turn is streaming. */
  function startStallWatchdog(): void {
    if (stallTimer) return
    stallTimer = setInterval(() => {
      if (abortController.signal.aborted) return
      const streaming = model.some((m) => m.streaming)
      if (!streaming) return
      const now = Date.now()
      if (lastFrameAt > 0 && now - lastFrameAt > stallResyncMs && now - lastResyncAt > stallResyncMs) {
        lastResyncAt = now
        setStatusText("长时间无响应，正在恢复…")
        streamAbort?.abort()
        void resyncFromHistory()
      }
    }, stallCheckMs)
  }

  /** Rebuild the conversation from durable history after a stall/reconnect. */
  async function resyncFromHistory(): Promise<void> {
    if (!sessionId) return
    try {
      const { events } = await client.history(sessionId)
      const fresh = foldHistory(events.map((e) => e.event))
      if (fresh.length === 0) return
      model = fresh
      streamTurn = null
      firstTokenDone = true
      // If the stalled turn completed durably, drop the busy/streaming state.
      if (!model.some((m) => m.streaming)) {
        setBusy(false)
        setStatusText("")
      }
      syncAll()
    } catch {
      // Keep the live view; the reconnect loop keeps trying.
    }
  }

  async function listenLoop(): Promise<void> {
    while (!abortController.signal.aborted) {
      const streamAbortController = new AbortController()
      streamAbort = streamAbortController
      lastFrameAt = Date.now()
      try {
        for await (const frame of client.eventStream(streamAbortController.signal)) {
          lastFrameAt = Date.now()
          // First frame after a drop: the link is alive again — clear the
          // "连接中断，重连中…" status that would otherwise linger forever.
          if (!connected()) {
            setConnected(true)
            setStatusText("")
          }
          try {
            onFrame(frame)
          } catch (err) {
            // A malformed or unexpected frame must never be mistaken for a
            // dropped downlink: log and keep consuming instead of reconnecting.
            console.error("dsh-cli: failed to process frame", frame.method, err)
          }
        }
      } catch {
        if (abortController.signal.aborted) break
      }
      // Both a clean close and an error mean the downlink is gone; reconnect.
      if (abortController.signal.aborted) break
      setConnected(false)
      // If the watchdog already re-synced from history and the conversation is
      // healthy again, don't flash a stale "连接中断" status on top of it.
      const justResynced = Date.now() - lastResyncAt < stallResyncMs
      if (!justResynced || model.some((m) => m.streaming)) {
        setStatusText("连接中断，重连中…")
      }
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS))
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
        startStallWatchdog()
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
    setStatusText(DEEP_DIVING_STATUS)
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

  /** Refresh the host slash-command directory for this session. */
  async function refreshCommands(): Promise<void> {
    if (!sessionId) return
    setCommandsLoading(true)
    try {
      const list = await client.commandList(sessionId)
      if (process.env.DSH_DEBUG) console.error("[dsh] command.list", JSON.stringify(list))
      setCommands(list)
    } catch (e) {
      if (process.env.DSH_DEBUG) console.error("[dsh] command.list failed", e)
      // Keep the last known directory; a reconnect or commands/change will retry.
    } finally {
      setCommandsLoading(false)
    }
  }

  /** Execute a host slash-command line; the lifecycle renders via events. */
  async function runCommand(line: string): Promise<{ ok: boolean; text?: string }> {
    if (!sessionId) return { ok: false, text: "还没有可用的会话" }
    try {
      const execution = await client.commandExecute(sessionId, line)
      if (!execution) return { ok: false, text: `未知或无法解析的命令：${line}` }
      return { ok: true, text: execution.result.text }
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : String(e) }
    }
  }

  /** List persisted sessions on the host (read-only query). */
  async function listSessions(): Promise<SessionSummary[]> {
    try {
      const res = await client.listSessions()
      return res.items
    } catch {
      return []
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
    if (stallTimer) {
      clearInterval(stallTimer)
      stallTimer = undefined
    }
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
    commands,
    commandsLoading,
    refreshCommands,
    runCommand,
    listSessions,
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
