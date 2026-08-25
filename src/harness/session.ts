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
  type HistoryEntry,
  type ModelCatalog,
  type QueueAction,
  type QueueItem,
  type ServerRequest,
  type SessionEvent,
  type SkillEntry,
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
  hasSession: () => boolean
  ensureSession: () => Promise<boolean>
  resumeSession: (sessionId: string) => Promise<boolean>
  /** Fast `-c` path: attach to the newest workspace session and show its
   *  transcript without hydrating previews for every other session. */
  resumeLastSession: () => Promise<ResumeResult>
  /** Startup gate: whether the harness has a configured DeepSeek API key. */
  checkApiKey: () => Promise<"configured" | "missing" | "unsupported">
  /** Persist a DeepSeek API key through the harness credentials service. */
  saveApiKey: (value: string) => Promise<boolean>
  queue: () => QueueItem[]
  updateQueueItem: (itemId: string, action: QueueAction) => Promise<boolean>
  refreshCommands: () => Promise<void>
  runCommand: (line: string) => Promise<{ ok: boolean; text?: string }>
  /** Mirror a task message the harness already received via a command (e.g. `/plan <任务>`). */
  mirrorUserMessage: (text: string) => void
  listSessions: () => Promise<SessionSummary[]>
  listModels: () => Promise<ModelCatalog | null>
  selectModel: (provider: string, model: string, reasoningEffort?: string) => Promise<boolean>
  renameSession: (title: string) => Promise<boolean>
  forkSession: () => Promise<string | null>
  listSkills: () => Promise<SkillEntry[]>
  question: () => HarnessQuestion | null
  error: () => string | null
  connected: () => boolean
  modelName: () => string
  planMode: () => boolean
  planPending: () => boolean
  start: (text: string) => Promise<boolean>
  send: (text: string) => Promise<boolean>
  answer: (choice: string) => Promise<void>
  answerPermission: (checkedIds: string[]) => Promise<void>
  answerApproval: (outcome: "allowed-once" | "rejected") => Promise<void>
  answerApprovalAllowSession: () => Promise<void>
  cancelQuestion: () => Promise<void>
  abort: () => Promise<void>
  clearError: () => void
  dispose: () => void
}

/** Outcome of resuming the most recently used session on startup. */
export type ResumeResult =
  | { status: "ok" }
  | { status: "none" }
  | { status: "failed"; reason: string }

const RECONNECT_DELAY_MS = 1500

export function describeHarnessError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return `无法连接 DeepSeek Harness：${message}`
}

export function createHarnessSession(
  client: HarnessClientLike = new HarnessClient(process.env.DSH_URL ?? "http://127.0.0.1:3080"),
  cwd = process.env.DSH_CWD ?? process.cwd(),
  options: { stallResyncMs?: number; minToolRunningMs?: number } = {},
): HarnessSessionApi {
  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [stats, setStats] = createSignal<SessionStats>(EMPTY_STATS)
  const [busy, setBusy] = createSignal(false)
  const [statusText, setStatusText] = createSignal("")
  const [question, setQuestion] = createSignal<HarnessQuestion | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [connected, setConnected] = createSignal(false)
  const [modelName, setModelName] = createSignal("DeepSeek-V4-Flash")
  const [planMode, setPlanMode] = createSignal(false)
  const [planPending, setPlanPending] = createSignal(false)
  const [commands, setCommands] = createSignal<CommandDescriptor[]>([])
  const [commandsLoading, setCommandsLoading] = createSignal(false)
  const [queue, setQueue] = createSignal<QueueItem[]>([])

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
  /** Quick tools (read/grep/edit…) settle in a single frame; hold their
   *  running state at least this long so the shine sweep is visible. */
  const minToolRunningMs = options.minToolRunningMs ?? 600
  let lastFrameAt = 0
  let lastResyncAt = 0
  let streamAbort: AbortController | null = null
  let stallTimer: ReturnType<typeof setInterval> | undefined
  /** Transcripts fetched while listing sessions, keyed by session id, so a
   *  resume can render the conversation immediately instead of waiting for
   *  the attach/history round-trips. */
  const seededHistory = new Map<string, { events: HistoryEntry[]; projections?: Record<string, unknown> }>()
  /** Settle timers for tool results held back by `minToolRunningMs`. */
  const pendingSettles = new Map<string, { result: ToolResultRecord; at: number; timer: ReturnType<typeof setTimeout> }>()
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
      case "plan/mode": {
        // The plan-mode plugin logs the session-wide mode switch; the badge
        // follows the committed value and clears any pending transition.
        setPlanMode(Boolean((ev.data as { active?: boolean }).active))
        setPlanPending(false)
        break
      }
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
    const callId = block.toolCallId
    if (pendingSettles.has(callId)) return
    const { text, truncated } = truncateText(blockText(block.content), MAX_TOOL_OUTPUT_CHARS)
    const result: ToolResultRecord = {
      toolCallId: callId,
      ok: !block.isError,
      output: text,
      truncated,
      meta: (ev.data as { meta?: unknown }).meta,
    }
    const target = [...model].reverse().find((m) => m.toolCalls?.some((c) => c.id === callId))
    if (!target) return
    const call = target.toolCalls?.find((c) => c.id === callId)
    if (!call) {
      // A result without a live call (replay edge) still attaches to history.
      target.toolResults = target.toolResults ?? []
      const existing = target.toolResults.find((r) => r.toolCallId === callId)
      if (existing) Object.assign(existing, result)
      else target.toolResults.push(result)
      touch(target)
      return
    }
    const elapsed = call.startedAt != null ? Math.max(0, ev.time - call.startedAt) : minToolRunningMs
    const remaining = minToolRunningMs - elapsed
    if (remaining > 0) {
      pendingSettles.set(callId, {
        result,
        at: ev.time,
        timer: setTimeout(() => settleToolResult(callId, ev.time), remaining),
      })
    } else {
      settleToolResult(callId, ev.time, result)
    }
  }

  /** Flip a settled call to ok/error once its minimum shine window has passed. */
  function settleToolResult(callId: string, at: number, directResult?: ToolResultRecord): void {
    const pending = pendingSettles.get(callId)
    const result = directResult ?? pending?.result
    if (pending) {
      clearTimeout(pending.timer)
      pendingSettles.delete(callId)
    }
    if (!result) return
    const target = [...model].reverse().find((m) => m.toolCalls?.some((c) => c.id === callId))
    if (!target) return
    const call = target.toolCalls?.find((c) => c.id === callId)
    if (call) {
      call.status = result.ok ? "ok" : "error"
      call.finishedAt = at
      if (call.startedAt != null) {
        statsModel.toolMs += Math.max(0, at - call.startedAt)
        syncStats()
      }
    }
    target.toolResults = target.toolResults ?? []
    const existing = target.toolResults.find((r) => r.toolCallId === callId)
    if (existing) Object.assign(existing, result)
    else target.toolResults.push(result)
    touch(target)
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
      case "approval/requested":
        onApprovalRequested(frame)
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
      case "session/queue": {
        const items = (payload.items as Array<Record<string, unknown>> | undefined) ?? []
        setQueue(
          items.map((item) => {
            const message = (item.message ?? {}) as Record<string, unknown>
            const content = (message.content ?? []) as Array<{ type?: string; text?: string }>
            const text = content.every((b) => b.type === "text")
              ? content.map((b) => b.text ?? "").join("")
              : null
            const preview = text ?? content.map((b) => (b.type === "text" ? b.text ?? "" : `[${b.type}]`)).join(" ").trim()
            return {
              id: String(item.id ?? ""),
              messageId: String(message.id ?? ""),
              placement: (item.placement as QueueItem["placement"]) ?? "queued",
              text: text ?? null,
              preview: preview.slice(0, 200),
            }
          }),
        )
        break
      }
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
    const questions = payload.questions
    const q = questions[0]
    if (!q) return
    const options = q.options?.length ? q.options.map((o) => o.label) : ["Yes", "No"]
    const kind: HarnessQuestion["kind"] =
      q.intent?.kind === "plan-review"
        ? "plan-approval"
        : /allow|permission|deny|允许/i.test(`${q.header ?? ""} ${q.question} ${options.join(" ")}`)
          ? "permission"
          : "ask-user"
    if (kind === "permission") {
      // Permission questions carry one selectable request per harness question:
      // surface them all (mimo code shows every pending request in one dialog)
      // instead of dropping everything after the first one.
      setQuestion({
        rpcId: frame.rpcId,
        id: q.id,
        title: q.header ?? "权限请求",
        options: ["Allow", "Deny"],
        kind,
        requests: questions.map((item) => ({
          id: item.id,
          label: item.question,
          detail: item.detail ?? item.options?.[0]?.description ?? item.header,
          suggested: true,
          options: item.options,
        })),
      })
      return
    }
    setQuestion({
      rpcId: frame.rpcId,
      id: q.id,
      title: q.question,
      detail: q.detail ?? q.header,
      options,
      kind,
    })
  }

  function onApprovalRequested(frame: ServerRequest): void {
    // Sandbox-escalation approvals arrive as their own answerable frame
    // (`approval/requested`), separate from `question/requested`. Surfacing
    // them as a permission prompt is what lets the harness's Bash tool stop
    // waiting forever on a user decision (the tool only runs after the
    // approval/decided outcome is recorded).
    const payload = frame.payload as {
      sessionId: string
      approvalId: string
      toolName?: string
      callId?: string
      reason?: string
    }
    if (!payload.approvalId) return
    setQuestion({
      rpcId: frame.rpcId,
      id: payload.approvalId,
      title: "权限确认",
      detail: [payload.toolName, payload.reason].filter(Boolean).join(" · "),
      options: ["允许本次", "当前会话允许", "拒绝"],
      kind: "permission",
      approval: { id: payload.approvalId, toolName: payload.toolName, callId: payload.callId },
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
      const { events, projections } = await client.history(sessionId)
      applyPlanProjection(projections)
      applyHistoryStats(projections, events)
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
    if (!(await ensureSession())) return false
    return sendToSession(text)
  }

  /** Create the session if it does not exist yet (no prompt is sent). */
  async function ensureSession(): Promise<boolean> {
    if (sessionId) return true
    try {
      const info = await client.describe()
      setConnected(true)
      if (info.model) setModelName(info.model)
      const created = await client.createSession(cwd)
      sessionId = created.sessionId
      startListening()
      startStallWatchdog()
      // Seed the plan badge from the durable projection (covers a resumed
      // session that is already in plan mode before the live stream emits).
      void seedPlanFromHistory()
      return true
    } catch (e) {
      setConnected(false)
      setError(describeHarnessError(e))
      return false
    }
  }

  /** Attach to an existing session (resume) so its history streams into the UI. */
  async function resumeSession(target: string): Promise<boolean> {
    if (!target) return false
    try {
      // Show the durable transcript right away from the listing's preview
      // fetch, before the attach round-trip completes.
      const seed = seededHistory.get(target)
      if (seed && seed.events.length > 0) {
        seededHistory.delete(target)
        applyHistoryStats(seed.projections, seed.events)
        applyPlanProjection(seed.projections)
        const fresh = foldHistory(seed.events.map((e) => e.event))
        if (fresh.length > 0) {
          model = fresh
          streamTurn = null
          firstTokenDone = true
          setBusy(false)
          setStatusText("")
          syncAll()
        }
      }
      if (!sessionId) {
        const info = await client.describe()
        setConnected(true)
        if (info.model) setModelName(info.model)
      }
      const created = await client.createSession(cwd, undefined, target)
      sessionId = created.sessionId
      if (!listening) startListening()
      startStallWatchdog()
      // Rebuild the transcript from durable history so the resumed session
      // shows its existing conversation instead of an empty window.
      await resyncFromHistory()
      void seedPlanFromHistory()
      return true
    } catch (e) {
      setConnected(false)
      setError(describeHarnessError(e))
      return false
    }
  }

  /** Resume the most recently used session in the current workspace. */
  async function resumeLastSession(): Promise<ResumeResult> {
    try {
      const res = await client.listSessions()
      const last = [...res.items]
        .filter((s) => !s.blank && (s.cwd === undefined || s.cwd === cwd))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (!last) return { status: "none" }
      // Fetch only the chosen session's transcript so the records render as
      // soon as the attach completes (the seed is consumed by resumeSession).
      try {
        const { events, projections } = await client.history(last.sessionId, 50)
        if (events.length > 0) seededHistory.set(last.sessionId, { events, projections })
      } catch {
        // The seed is an optimization; resume re-syncs history anyway.
      }
      const ok = await resumeSession(last.sessionId)
      return ok ? { status: "ok" } : { status: "failed", reason: error() ?? "请检查 harness 连接" }
    } catch (e) {
      return { status: "failed", reason: describeHarnessError(e) }
    }
  }

  /** Credential reference the DeepSeek provider reads (`apiKeyEnv`). */
  const API_KEY_REF = "DEEPSEEK_API_KEY"

  /**
   * Ask the harness whether `DEEPSEEK_API_KEY` is configured. When the
   * credentials service is absent (mock server, older harness) the check is
   * skipped rather than blocking startup.
   */
  async function checkApiKey(): Promise<"configured" | "missing" | "unsupported"> {
    try {
      const views = await client.credentialsDescribe([API_KEY_REF])
      const view = views[API_KEY_REF]
      if (!view) return "unsupported"
      if (view.configured) return "configured"
      return view.writable ? "missing" : "unsupported"
    } catch {
      return "unsupported"
    }
  }

  /** Persist the key through the harness so it lands in the managed store. */
  async function saveApiKey(value: string): Promise<boolean> {
    const trimmed = value.trim()
    if (!trimmed) return false
    try {
      await client.credentialsSet(API_KEY_REF, trimmed)
      return true
    } catch {
      return false
    }
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
      const message = e instanceof Error ? e.message : String(e)
      if (/not found|404/i.test(message) && !process.env.DSH_DEBUG) {
        // A harness without the commands service exposes no /api/commands.*.
        setCommands([])
        return
      }
      if (process.env.DSH_DEBUG) console.error("[dsh] command.list failed", e)
      // Keep the last known directory; a reconnect or commands/change will retry.
    } finally {
      setCommandsLoading(false)
    }
  }

  /** Execute a host slash-command line; the lifecycle renders via events. */
  async function runCommand(line: string): Promise<{ ok: boolean; text?: string }> {
    if (!sessionId) return { ok: false, text: "请先开始一个会话（发一条消息），再使用该命令" }
    try {
      const execution = await client.commandExecute(sessionId, line)
      if (!execution) {
        // The commands service exists but this command is not registered
        // (e.g. the plan-mode plugin is missing) — degrade /plan instead of
        // pretending the line was simply misspelled.
        const plan = await runPlanFallback(line)
        if (plan) return plan
        return { ok: false, text: `未知或无法解析的命令：${line}` }
      }
      // `/plan` and `/plan off` change session mode; the projection snapshot
      // confirms the committed/pending state even when the live event was
      // missed (fresh mux socket, resume, plugin-side commit timing).
      if (/^\/plan(?:\s|$)/i.test(line.trim())) void seedPlanFromHistory()
      return { ok: true, text: execution.result.text }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/not found|404/i.test(message)) {
        const plan = await runPlanFallback(line)
        if (plan) return plan
        return { ok: false, text: "当前 harness 未启用 commands 服务（版本过旧或未加载命令插件），host 命令不可用" }
      }
      return { ok: false, text: message }
    }
  }

  /** Projection values ride under `values` on the wire (`{asOfSeq, values}`). */
  function projectionValues(projections: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!projections) return {}
    const nested = (projections as { values?: Record<string, unknown> }).values
    return nested ?? projections
  }

  /** Fold the harness's `plan` projection (`{active, pending}`) into signals. */
  function applyPlanProjection(projections: Record<string, unknown> | undefined): void {
    const plan = projectionValues(projections).plan as { active?: boolean; pending?: boolean } | undefined
    if (plan === undefined || typeof plan !== "object") return
    if (typeof plan.active === "boolean") setPlanMode(plan.active)
    if (typeof plan.pending === "boolean") setPlanPending(plan.pending)
  }

  /** Restore the durable `sessionStats`/`tokenUsage` projections on resume. */
  function applyStatsProjections(projections: Record<string, unknown> | undefined): void {
    const values = projectionValues(projections)
    const s = values.sessionStats as Record<string, number> | undefined
    const usage = values.tokenUsage as Record<string, unknown> | undefined
    const totals =
      usage && typeof usage.totals === "object" && usage.totals !== null
        ? (usage.totals as Record<string, number>)
        : (usage as Record<string, number> | undefined)
    if (!s && !totals) return
    const ttftSteps = typeof s?.ttftSteps === "number" ? s.ttftSteps : 0
    const ttftMs = typeof s?.ttftMs === "number" ? s.ttftMs : 0
    statsModel = {
      turns: typeof s?.turns === "number" ? s.turns : statsModel.turns,
      steps: typeof s?.steps === "number" ? s.steps : statsModel.steps,
      llmMs: typeof s?.llmMs === "number" ? s.llmMs : statsModel.llmMs,
      toolMs: typeof s?.toolMs === "number" ? s.toolMs : statsModel.toolMs,
      inTokens: typeof totals?.uncachedInputTokens === "number" ? totals.uncachedInputTokens : statsModel.inTokens,
      outTokens: typeof totals?.outputTokens === "number" ? totals.outputTokens : statsModel.outTokens,
      cacheReadTokens: typeof totals?.cacheReadTokens === "number" ? totals.cacheReadTokens : statsModel.cacheReadTokens,
      cacheWriteTokens: typeof totals?.cacheWriteTokens === "number" ? totals.cacheWriteTokens : statsModel.cacheWriteTokens,
      reasoningTokens: statsModel.reasoningTokens,
      firstTokenMs: ttftSteps > 0 ? ttftMs / ttftSteps : null,
      firstTokenSumMs: ttftMs || statsModel.firstTokenSumMs,
      firstTokenCount: ttftSteps || statsModel.firstTokenCount,
    }
    syncStats()
  }

  /** Derive session stats from a history event list (no projection needed). */
  function statsFromEvents(entries: HistoryEntry[]): SessionStats {
    const usageByStep = new Map<string, { in: number; out: number; cr: number; cw: number }>()
    const stepStart = new Map<string, number>()
    const stepFirstToken = new Map<string, number>()
    let turns = 0
    let steps = 0
    let llmMs = 0
    let firstTokenSumMs = 0
    let firstTokenCount = 0
    for (const entry of entries) {
      const ev = entry.event
      const turn = ev.data?.turn
      const step = ev.data?.step
      const key = step !== undefined ? `${turn}:${step}` : undefined
      switch (ev.type) {
        case "turn/start":
          turns++
          break
        case "step/start":
          steps++
          if (key) stepStart.set(key, ev.time)
          break
        case "step/end":
          if (key && stepStart.has(key)) {
            llmMs += Math.max(0, ev.time - (stepStart.get(key) as number))
            stepStart.delete(key)
          }
          break
        case "assistant/chunk": {
          const chunk = ev.data?.chunk as { type?: string } | undefined
          if (key && stepStart.has(key) && !stepFirstToken.has(key) && chunk?.type) {
            stepFirstToken.set(key, ev.time)
            firstTokenSumMs += Math.max(0, ev.time - (stepStart.get(key) as number))
            firstTokenCount++
          }
          const usage = (chunk as { usage?: Record<string, number> } | undefined)?.usage
          if (usage && key) {
            usageByStep.set(key, {
              in: usage.inputTokens ?? 0,
              out: usage.outputTokens ?? 0,
              cr: usage.cacheReadTokens ?? 0,
              cw: usage.cacheWriteTokens ?? 0,
            })
          }
          break
        }
        case "assistant/message": {
          const usage = (ev.data as { usage?: Record<string, number> }).usage
          if (usage && key) {
            // The final message sample replaces the step's earlier sample.
            usageByStep.set(key, {
              in: usage.inputTokens ?? 0,
              out: usage.outputTokens ?? 0,
              cr: usage.cacheReadTokens ?? 0,
              cw: usage.cacheWriteTokens ?? 0,
            })
          }
          break
        }
      }
    }
    let inTokens = 0
    let outTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    for (const u of usageByStep.values()) {
      inTokens += u.in
      outTokens += u.out
      cacheReadTokens += u.cr
      cacheWriteTokens += u.cw
    }
    return {
      turns,
      steps,
      llmMs,
      toolMs: 0,
      inTokens,
      outTokens,
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens: 0,
      firstTokenMs: firstTokenCount > 0 ? firstTokenSumMs / firstTokenCount : null,
      firstTokenSumMs,
      firstTokenCount,
    }
  }

  /** Restore stats from projections, filling any gaps from the event list. */
  function applyHistoryStats(projections: Record<string, unknown> | undefined, entries: HistoryEntry[]): void {
    applyStatsProjections(projections)
    const derived = statsFromEvents(entries)
    if (process.env.DSH_DEBUG) console.error("[dsh] stats restore", JSON.stringify({ projected: statsModel, derived }))
    statsModel = {
      turns: statsModel.turns > 0 ? statsModel.turns : derived.turns,
      steps: statsModel.steps > 0 ? statsModel.steps : derived.steps,
      llmMs: statsModel.llmMs > 0 ? statsModel.llmMs : derived.llmMs,
      toolMs: statsModel.toolMs > 0 ? statsModel.toolMs : derived.toolMs,
      inTokens: statsModel.inTokens > 0 ? statsModel.inTokens : derived.inTokens,
      outTokens: statsModel.outTokens > 0 ? statsModel.outTokens : derived.outTokens,
      cacheReadTokens: statsModel.cacheReadTokens > 0 ? statsModel.cacheReadTokens : derived.cacheReadTokens,
      cacheWriteTokens: statsModel.cacheWriteTokens > 0 ? statsModel.cacheWriteTokens : derived.cacheWriteTokens,
      reasoningTokens: statsModel.reasoningTokens > 0 ? statsModel.reasoningTokens : derived.reasoningTokens,
      firstTokenMs:
        statsModel.firstTokenCount > 0
          ? statsModel.firstTokenMs
          : derived.firstTokenCount > 0
            ? derived.firstTokenMs
            : null,
      firstTokenSumMs: statsModel.firstTokenSumMs > 0 ? statsModel.firstTokenSumMs : derived.firstTokenSumMs,
      firstTokenCount: statsModel.firstTokenCount > 0 ? statsModel.firstTokenCount : derived.firstTokenCount,
    }
    syncStats()
  }

  /** Re-read the durable `plan` projection for the current session. */
  async function seedPlanFromHistory(): Promise<void> {
    if (!sessionId) return
    try {
      const { projections } = await client.history(sessionId, 1)
      applyPlanProjection(projections)
    } catch {
      // The projection seam may be absent on old harnesses; the badge simply
      // stays hidden and the live `plan/mode` event path remains available.
    }
  }

  /**
   * Degrade `/plan` when the harness has no commands service (or the
   * plan-mode command plugin is not loaded). Plan mode is switched remotely
   * only through the commands channel — the official web UI runs `/plan off`
   * through it too — so the best available fallback is a plan-first ordinary
   * message, and for `off` an ask to exit through the agent's own
   * `exit_plan_mode` tool (which still raises the plan-review question).
   */
  async function runPlanFallback(line: string): Promise<{ ok: boolean; text?: string } | null> {
    const match = /^\/plan(?:\s+(.*))?$/i.exec(line.trim())
    if (!match) return null
    const args = (match[1] ?? "").trim()
    const unavailable =
      "harness 未启用 commands 服务，无法真正切换计划模式（升级 harness 或加载命令插件后 /plan 才会直接生效）"
    if (args === "off") {
      const sent = await sendToSession(
        "请退出计划模式：如果已生成计划，请通过 exit_plan_mode 提交审批；否则直接退出计划模式。如果当前不在计划模式，请忽略本条。",
      )
      return sent
        ? { ok: true, text: `${unavailable}；已请模型退出计划模式（通过 exit_plan_mode 提交审批）。` }
        : { ok: false, text: `${unavailable}，且退出消息发送失败，请检查 harness 连接` }
    }
    // Bare /plan and /plan <任务> both ask the agent to plan first; a task
    // rides along as the next message, mirroring the host command's flow.
    const task = args ? `\n\n任务：${args}` : ""
    const sent = await sendToSession(
      `请从下一步开始按计划模式执行：先只读探查，给出完整的实施计划（含具体改动），等我批准后再修改代码或执行命令。${task}`,
    )
    return sent
      ? {
          ok: true,
          text: `${unavailable}；已${args ? "把任务作为下一条消息提交" : "请求从下一步开始按计划模式执行"}，模型会先规划并等待你的批准。`,
        }
      : { ok: false, text: `${unavailable}，且消息发送失败，请检查 harness 连接` }
  }

  /** List persisted sessions on the host (read-only query). */
  async function listSessions(): Promise<SessionSummary[]> {
    try {
      const res = await client.listSessions()
      // Blank sessions have no conversation to show; skip them entirely.
      // Sessions are workspace-scoped: the harness refuses to attach to a
      // session whose stored cwd differs from the one passed to session.create
      // (session-conflict), so only surface rows for this workspace (legacy
      // rows without a cwd field stay visible).
      const items = res.items.filter((s) => !s.blank && (s.cwd === undefined || s.cwd === cwd))
      // Each row carries the first user message so the list reads as a
      // conversation directory: `<首轮对话内容>  时间  会话ID前8位`.
      await Promise.all(
        items.map(async (s) => {
          try {
            const { events, projections } = await client.history(s.sessionId, 50)
            if (events.length > 0) seededHistory.set(s.sessionId, { events, projections })
            const firstUser = foldHistory(events.map((e) => e.event)).find((m) => m.role === "user" && !m.inject)
            if (firstUser) s.preview = firstUser.content.trim().slice(0, 80)
          } catch {
            // A history read failure leaves the preview empty; the row still lists.
          }
        }),
      )
      return items
    } catch {
      return []
    }
  }

  /** Read the session's model directory (current + available groups). */
  async function listModels(): Promise<ModelCatalog | null> {
    if (!sessionId) return null
    try {
      return await client.listModels(sessionId)
    } catch {
      return null
    }
  }

  /** Switch the session's LLM model; returns false on failure. */
  async function selectModel(provider: string, model: string, reasoningEffort?: string): Promise<boolean> {
    if (!sessionId) return false
    try {
      const res = await client.selectModel(sessionId, provider, model, reasoningEffort)
      if (res.selected.model) setModelName(res.selected.model)
      return true
    } catch {
      return false
    }
  }

  /** Rename the session title. */
  async function renameSession(title: string): Promise<boolean> {
    if (!sessionId || !title.trim()) return false
    try {
      await client.renameSession(sessionId, title.trim())
      return true
    } catch {
      return false
    }
  }

  /** Fork the current session into a new one and switch to it. */
  async function forkSession(): Promise<string | null> {
    if (!sessionId) return null
    try {
      const { sessionId: childId } = await client.forkSession(sessionId)
      sessionId = childId
      setMessages([])
      setPlanMode(false)
      setPlanPending(false)
      void resyncFromHistory()
      void seedPlanFromHistory()
      return childId
    } catch {
      return null
    }
  }

  /** Read the session's user-invocable skill catalog. */
  async function listSkills(): Promise<SkillEntry[]> {
    if (!sessionId) return []
    try {
      const res = await client.skillList(sessionId)
      return res.skills
    } catch {
      return []
    }
  }

  /** Edit/remove/steer one pending queue occurrence. */
  async function updateQueueItem(itemId: string, action: QueueAction): Promise<boolean> {
    if (!sessionId) return false
    try {
      const res = await client.updateQueue(sessionId, itemId, action)
      return res.accepted
    } catch {
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

  /** Answer a permission question: `checkedIds` are the requests the user allowed. */
  async function answerPermission(checkedIds: string[]): Promise<void> {
    const q = question()
    if (!q || !sessionId) return
    setQuestion(null)
    setStatusText("")
    const checked = new Set(checkedIds)
    // The harness expects one answer entry per question id, using the option
    // labels it advertised. Allowed rows keep the first label; denied rows the
    // second (or the same label when only one option was given).
    const answers = (q.requests ?? []).map((r) => {
      const opts = r.options ?? []
      const allowLabel = opts[0]?.label ?? "Yes"
      const denyLabel = opts[1]?.label ?? allowLabel
      return { id: r.id, selected: [checked.has(r.id) ? allowLabel : denyLabel] }
    })
    try {
      await client.respond(q.rpcId, sessionId, answers)
    } catch {
      // answering is best-effort; the harness will time out if it fails
    }
  }

  /** Decide a pending sandbox-escalation approval (`approval/requested`). */
  async function answerApproval(outcome: "allowed-once" | "rejected"): Promise<void> {
    const q = question()
    if (!q?.approval || !sessionId) return
    setQuestion(null)
    setStatusText("")
    try {
      await client.respondApproval(q.rpcId, sessionId, q.approval.id, outcome)
    } catch {
      // answering is best-effort; the harness will time out if it fails
    }
  }

  /** Allow for the whole session: raise the preset, then approve this call. */
  async function answerApprovalAllowSession(): Promise<void> {
    // `/permission danger-full-access` (dsh-permission-presets) switches the
    // session to full sandbox access with approval "never", so later
    // escalations stop prompting. Best-effort: approving the pending call is
    // what unblocks the current one.
    await runCommand("/permission danger-full-access")
    await answerApproval("allowed-once")
  }

  async function cancelQuestion(): Promise<void> {
    const q = question()
    if (q?.approval) {
      // Explicit denial: reject the sandbox escalation in one RPC.
      await answerApproval("rejected")
      return
    }
    if (q?.kind === "permission" && q.requests?.length) {
      // Explicit denial: reject every pending request in one RPC.
      await answerPermission([])
      return
    }
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
    for (const pending of pendingSettles.values()) clearTimeout(pending.timer)
    pendingSettles.clear()
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
    planMode,
    planPending,
    start,
    send,
    answer,
    answerPermission,
    answerApproval,
    answerApprovalAllowSession,
    cancelQuestion,
    abort,
    commands,
    commandsLoading,
    hasSession: () => sessionId !== null,
    ensureSession,
    resumeSession,
    resumeLastSession,
    checkApiKey,
    saveApiKey,
    queue,
    updateQueueItem,
    refreshCommands,
    runCommand,
    mirrorUserMessage: appendUserMessage,
    listSessions,
    listModels,
    selectModel,
    renameSession,
    forkSession,
    listSkills,
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
