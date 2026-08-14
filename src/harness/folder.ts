/**
 * EventFolder: folds live `session/event` events into store updates.
 * Shared by the remote HarnessDriver (mux frames) and the in-process
 * CordisDriver (cordis event bus) so both render identically.
 */
import type { ChatMessage, TodoItem } from '../types.ts'
import { Store } from '../store.ts'
import type { SessionEvent } from './client.ts'
import { assistantBlocksToMessage, eventToMessage } from './fold.ts'

interface Block {
  type?: string
  text?: string
  toolCallId?: string
  content?: Block[]
  isError?: boolean
}

export class EventFolder {
  private streamId: string | null = null
  private streamTurn: string | null = null

  constructor(private store: Store) {}

  /** Reset streaming state (e.g. on session switch). */
  reset(): void {
    this.streamId = null
    this.streamTurn = null
  }

  onEvent(ev: SessionEvent): void {
    switch (ev.type) {
      case 'user/message': {
        const m = eventToMessage(ev)
        if (m) this.store.handleEvent({ type: 'message', message: m })
        break
      }
      case 'turn/start': {
        this.streamTurn = String(ev.data.turn)
        this.streamId = `stream-${ev.seq}`
        this.store.handleEvent({
          type: 'message',
          message: { id: this.streamId, role: 'assistant', content: '', createdAt: ev.time, streaming: true },
        })
        this.store.handleEvent({ type: 'status', status: 'thinking' })
        break
      }
      case 'assistant/chunk':
        this.onChunk(ev)
        break
      case 'assistant/message':
        this.finalizeAssistant(ev)
        break
      case 'tool/call':
        this.onToolCall(ev)
        break
      case 'tool/result':
        this.onToolResult(ev)
        break
      case 'turn/end': {
        if (this.streamId) {
          this.store.handleEvent({ type: 'message-update', id: this.streamId, patch: { streaming: false } })
        }
        this.streamId = null
        this.streamTurn = null
        this.store.handleEvent({
          type: 'done',
          reason: String((ev.data.reason as { kind?: string } | undefined)?.kind ?? 'stop'),
        })
        break
      }
      case 'session/title': {
        const title = (ev.data as { title?: string }).title
        if (title) this.store.handleEvent({ type: 'title', title })
        break
      }
      case 'todo/write': {
        const todos = ev.data.todos as Array<{ content?: string; status?: string }> | undefined
        if (Array.isArray(todos)) {
          const items: TodoItem[] = todos.map((t, i) => ({
            id: String(i + 1),
            content: String(t.content ?? ''),
            status: (t.status as TodoItem['status']) ?? 'pending',
          }))
          this.store.handleEvent({ type: 'todos', todos: items })
        }
        break
      }
    }
  }

  private onChunk(ev: SessionEvent): void {
    if (!this.streamId || String(ev.data.turn) !== this.streamTurn) return
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
    const id = this.streamId
    switch (chunk.type) {
      case 'text-delta':
        this.appendStreamText(id, chunk.text ?? '')
        break
      case 'reasoning-delta':
        this.appendStreamThinking(id, chunk.text ?? '')
        break
      case 'tool-call-delta':
        this.appendStreamToolCallDelta(id, chunk)
        break
      case 'usage': {
        const u = chunk.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        if (u)
          this.store.handleEvent({
            type: 'usage',
            usage: {
              promptTokens: u.prompt_tokens ?? 0,
              completionTokens: u.completion_tokens ?? 0,
              totalTokens: u.total_tokens ?? 0,
            },
          })
        break
      }
    }
  }

  private appendStreamText(id: string, text: string): void {
    const m = this.store.getState().messages.find((x) => x.id === id)
    if (m) {
      m.content += text
      this.store.handleEvent({ type: 'message-update', id, patch: { content: m.content } })
    }
  }

  private appendStreamThinking(id: string, text: string): void {
    const m = this.store.getState().messages.find((x) => x.id === id)
    if (m) {
      m.thinking = (m.thinking ?? '') + text
      this.store.handleEvent({ type: 'message-update', id, patch: { thinking: m.thinking } })
    }
  }

  private appendStreamToolCallDelta(
    id: string,
    delta: { index?: number; id?: string; name?: string; argumentsDelta?: string },
  ): void {
    const m = this.store.getState().messages.find((x) => x.id === id)
    if (!m) return
    m.toolCalls = m.toolCalls ?? []
    const index = delta.index ?? 0
    let call = m.toolCalls[index]
    if (!call) {
      call = { id: delta.id ?? `stream-tc-${index}`, name: '', args: {}, status: 'running' }
      m.toolCalls[index] = call
    }
    if (delta.name) call.name += delta.name
    if (delta.id) call.id = delta.id
    if (delta.argumentsDelta) {
      call.args = mergeArgs(call.args as Record<string, unknown>, delta.argumentsDelta)
      const first = Object.values(call.args as Record<string, unknown>)[0]
      call.summary = String(typeof first === 'string' ? first : call.name).slice(0, 80)
    }
    this.store.handleEvent({ type: 'message-update', id, patch: { toolCalls: m.toolCalls } })
  }

  private finalizeAssistant(ev: SessionEvent): void {
    const data = ev.data as { message?: { id?: string; content?: Block[] } }
    const blocks = data.message?.content
    const { content, thinking, toolCalls } = assistantBlocksToMessage(blocks ?? [], `ev-${ev.seq}`)
    const patch = {
      content,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      streaming: false,
    }
    if (this.streamId) {
      // live stream: finalize the streaming message in place
      this.store.handleEvent({ type: 'message-update', id: this.streamId, patch })
      this.streamId = null
      this.streamTurn = null
    } else if (content || thinking || toolCalls.length) {
      this.store.handleEvent({
        type: 'message',
        message: {
          id: `msg-${data.message?.id ?? ev.seq}`,
          role: 'assistant',
          content,
          thinking: thinking || undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          createdAt: ev.time,
        },
      })
    }
  }

  private onToolCall(ev: SessionEvent): void {
    const data = ev.data as { callId?: string; name?: string; arguments?: string }
    if (!data.callId || !data.name) return
    const args = tryParseArgs(data.arguments ?? '')
    const msgs = this.store.getState().messages
    const target = [...msgs].reverse().find((m) => m.role === 'assistant')
    if (!target) return
    this.store.handleEvent({
      type: 'tool-call',
      id: target.id,
      call: {
        id: data.callId,
        name: data.name,
        args,
        summary: String(Object.values(args)[0] ?? data.name).slice(0, 80),
        status: 'running',
        startedAt: ev.time,
      },
    })
    this.store.handleEvent({ type: 'status', status: 'working', detail: data.name })
  }

  private onToolResult(ev: SessionEvent): void {
    const block = (ev.data as { message?: { content?: Block[] } }).message?.content?.[0]
    if (!block || block.type !== 'tool-result' || !block.toolCallId) return
    const msgs = this.store.getState().messages
    const target = [...msgs].reverse().find((m) => m.toolCalls?.some((c) => c.id === block.toolCallId))
    const result = {
      toolCallId: block.toolCallId,
      ok: !block.isError,
      output: (block.content ?? []).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join(''),
    }
    if (target) this.store.handleEvent({ type: 'tool-result', id: target.id, result })
    this.store.handleEvent({ type: 'status', status: 'working', detail: '' })
  }
}

function mergeArgs(current: Record<string, unknown>, delta: string): Record<string, unknown> {
  try {
    return { ...current, ...JSON.parse(delta) }
  } catch {
    return current
  }
}

function tryParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
