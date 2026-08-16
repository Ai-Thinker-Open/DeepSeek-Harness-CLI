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

/** Bound applied to tool-result text kept in the UI model. */
export const MAX_TOOL_OUTPUT_CHARS = 4000

/** Bound applied to injected-context text previews kept in the UI model. */
export const MAX_INJECT_CHARS = 2000

/** Cap on a single assistant message's retained text (chars). */
export const MAX_CONTENT_CHARS = 400_000

/** Cap on retained reasoning text per assistant message (chars). */
export const MAX_THINKING_CHARS = 120_000

/** Human labels for the harness's `ContextForm` vocabulary. */
export const CONTEXT_FORM_LABELS: Record<string, string> = {
  instructions: "指令",
  catalog: "目录",
  notice: "通知",
  relay: "转达",
  recall: "回顾",
}

/** The `source` object carried by `user/message` events. */
export interface UserMessageSource {
  kind?: string
  plugin?: string
  form?: string
  summary?: string
}

/** Display title for an injected-context producer. */
export function injectSourceTitle(source: UserMessageSource | undefined): string {
  if (!source) return ""
  if (typeof source.plugin === "string" && source.plugin) return source.plugin
  if (typeof source.kind === "string" && source.kind && source.kind !== "user" && source.kind !== "plugin") {
    return source.kind
  }
  return ""
}

/** True when a user/message source is injected context rather than a human prompt. */
export function isInjectedSource(source: UserMessageSource | undefined): boolean {
  return Boolean(source && source.kind && source.kind !== "user")
}

/** Cap long text without paying for a full copy when it is short. */
export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: text.slice(0, max), truncated: true }
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
      const m = data as unknown as { id?: string; content?: Block[]; source?: UserMessageSource }
      if (!m.content) return null
      const source = m.source
      if (isInjectedSource(source)) {
        const title = injectSourceTitle(source)
        const { text, truncated } = truncateText(blockText(m.content), MAX_INJECT_CHARS)
        return {
          id: `msg-${m.id ?? seqId}`,
          role: "user" as const,
          content: truncated ? `${text}\n… (内容已截断)` : text,
          inject: {
            source: title || "unknown",
            form: source?.form,
            summary: source?.summary,
          },
          createdAt: ev.time,
        }
      }
      return {
        id: `msg-${m.id ?? seqId}`,
        role: "user" as const,
        content: blockText(m.content),
        createdAt: ev.time,
      }
    }
    case "assistant/message": {
      const m = data.message as { id?: string; content?: Block[] } | undefined
      if (!m?.content) return null
      const { content, thinking, toolCalls } = assistantBlocksToMessage(m.content, seqId)
      if (!content && !thinking && toolCalls.length === 0) return null
      const boundedContent = truncateText(content, MAX_CONTENT_CHARS)
      const boundedThinking = truncateText(thinking, MAX_THINKING_CHARS)
      return {
        id: `msg-${m.id ?? seqId}`,
        role: "assistant",
        content: boundedContent.truncated ? `${boundedContent.text}\n… (内容过长，已截断)` : boundedContent.text,
        thinking: boundedThinking.truncated
          ? `${boundedThinking.text}\n… (推理过长，已截断)`
          : boundedThinking.text || undefined,
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
  const raw = blockText(block.content)
  const { text, truncated } = truncateText(raw, MAX_TOOL_OUTPUT_CHARS)
  const result: ToolResultRecord = {
    toolCallId: block.toolCallId,
    ok: !block.isError,
    output: text,
    truncated,
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
