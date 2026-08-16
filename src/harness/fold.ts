/**
 * Fold DSH `session/event` streams into the UI's ChatMessage model.
 * Pure helpers shared by history replay and live streaming.
 */
import type { ChatMessage, ToolCallRecord, ToolResultRecord } from "../session"
import type { SessionEvent } from "./client"

export interface Block {
  type?: string
  text?: string
  id?: string
  name?: string
  arguments?: string
  toolCallId?: string
  content?: Block[]
  isError?: boolean
}

export function tryParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function blockText(blocks: Block[] | undefined): string {
  return (blocks ?? [])
    .map((b) => {
      switch (b.type) {
        case "text":
          return b.text ?? ""
        case "image":
          return "[image]"
        default:
          return ""
      }
    })
    .join("")
}

export function summaryFor(name: string, args: Record<string, unknown>): string {
  const first = Object.values(args)[0]
  if (typeof first === "string") return String(first).slice(0, 80)
  try {
    return JSON.stringify(args).slice(0, 80)
  } catch {
    return name
  }
}

/** Extract {content, thinking, toolCalls} from assistant content blocks. */
export function assistantBlocksToMessage(
  blocks: Block[],
  turnKey: string,
): { content: string; thinking: string; toolCalls: ToolCallRecord[] } {
  const content = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
  const thinking = blocks
    .filter((b) => b.type === "reasoning")
    .map((b) => b.text ?? "")
    .join("")
  const toolCalls: ToolCallRecord[] = blocks
    .filter((b) => b.type === "tool-call")
    .map((b, i) => {
      const args = tryParseArgs(b.arguments ?? "")
      const name = b.name ?? ""
      return {
        id: b.id ?? `${turnKey}-tc${i}`,
        name,
        args,
        summary: summaryFor(name, args),
        status: "ok" as const,
      }
    })
  return { content, thinking, toolCalls }
}

/** Fold a committed session event into a ChatMessage (history replay). */
export function eventToMessage(ev: SessionEvent): ChatMessage | null {
  const data = ev.data as Record<string, unknown>
  const seqId = `ev-${ev.seq}`
  switch (ev.type) {
    case "user/message": {
      const m = data as unknown as { id?: string; content?: Block[] }
      if (!m.content) return null
      return {
        id: `msg-${m.id ?? seqId}`,
        role: "user",
        content: blockText(m.content),
        createdAt: ev.time,
      }
    }
    case "assistant/message": {
      const m = data.message as { id?: string; content?: Block[] } | undefined
      if (!m?.content) return null
      const { content, thinking, toolCalls } = assistantBlocksToMessage(m.content, seqId)
      if (!content && !thinking && toolCalls.length === 0) return null
      return {
        id: `msg-${m.id ?? seqId}`,
        role: "assistant",
        content,
        thinking: thinking || undefined,
        toolCalls,
        createdAt: ev.time,
      }
    }
    default:
      return null
  }
}

/** Fold a tool result event onto an assistant message (mutates messages). */
export function foldToolResult(messages: ChatMessage[], ev: SessionEvent): ToolResultRecord | null {
  const data = ev.data as { message?: { content?: Block[] } }
  const block = data.message?.content?.[0]
  if (!block || block.type !== "tool-result" || !block.toolCallId) return null
  const result: ToolResultRecord = {
    toolCallId: block.toolCallId,
    ok: !block.isError,
    output: blockText(block.content),
  }
  const target = [...messages].reverse().find((m) => m.toolCalls?.some((c) => c.id === block.toolCallId))
  if (target) {
    target.toolResults = target.toolResults ?? []
    const existing = target.toolResults.find((r) => r.toolCallId === block.toolCallId)
    if (existing) Object.assign(existing, result)
    else target.toolResults.push(result)
    const call = target.toolCalls?.find((c) => c.id === block.toolCallId)
    if (call) {
      call.status = result.ok ? "ok" : "error"
      call.finishedAt = ev.time
    }
  }
  return result
}

/** Fold a tool/call event onto an assistant message (live status). */
export function foldToolCall(
  messages: ChatMessage[],
  ev: SessionEvent,
): { messageId: string; call: ToolCallRecord } | null {
  const data = ev.data as { callId?: string; name?: string; arguments?: string }
  if (!data.callId || !data.name) return null
  const args = tryParseArgs(data.arguments ?? "")
  const call: ToolCallRecord = {
    id: data.callId,
    name: data.name,
    args,
    summary: summaryFor(data.name, args),
    status: "running",
    startedAt: ev.time,
  }
  const target = [...messages].reverse().find((m) => m.role === "assistant")
  if (!target) return null
  target.toolCalls = target.toolCalls ?? []
  const existing = target.toolCalls.find((c) => c.id === call.id)
  if (existing) Object.assign(existing, call)
  else target.toolCalls.push(call)
  return { messageId: target.id, call }
}

/** Replay a history event list into ChatMessages (resume). */
export function foldHistory(events: SessionEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const ev of events) {
    const msg = eventToMessage(ev)
    if (msg) messages.push(msg)
    if (ev.type === "tool/call") foldToolCall(messages, ev)
    if (ev.type === "tool/result") foldToolResult(messages, ev)
  }
  return messages
}

/** The latest session title recorded in an event list. */
export function titleFromEvents(events: SessionEvent[]): string | undefined {
  let title: string | undefined
  for (const ev of events) {
    if (ev.type === "session/title") {
      const t = (ev.data as { title?: string }).title
      if (t) title = t
    }
  }
  return title
}

/** Extract the plain text of a user message event. */
export function userMessageText(ev: SessionEvent): string {
  const data = ev.data as { content?: Block[] }
  return blockText(data.content)
}
