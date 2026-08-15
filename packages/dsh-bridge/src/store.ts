import type { HistoryEntry, SessionEvent, SessionSummary } from './harness.ts'
import type {
  OpenCodeAssistantMessage,
  OpenCodeGlobalEvent,
  OpenCodeMessage,
  OpenCodePart,
  OpenCodeSession,
  OpenCodeTodo,
  OpenCodeToolPart,
  OpenCodeToolState,
  OpenCodeUserMessage,
} from './types.ts'

interface DshBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  arguments?: string
  toolCallId?: string
  content?: DshBlock[]
  isError?: boolean
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function textFromBlocks(blocks: DshBlock[] | undefined): string {
  return (blocks ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
}

function reasoningFromBlocks(blocks: DshBlock[] | undefined): string {
  return (blocks ?? [])
    .filter((block) => block.type === 'reasoning')
    .map((block) => block.text ?? '')
    .join('')
}

function parseInput(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : { raw }
  } catch {
    return { raw }
  }
}

function toolSummary(tool: string, input: Record<string, unknown>): string {
  const first = Object.values(input)[0]
  if (typeof first === 'string' && first) return first.slice(0, 120)
  const json = JSON.stringify(input)
  return json && json !== '{}' ? json.slice(0, 120) : tool
}

export interface BridgeSessionState {
  session: OpenCodeSession
  messages: OpenCodeMessage[]
  parts: Map<string, OpenCodePart[]>
  todos: OpenCodeTodo[]
  plan: { active: boolean }
  status: { type: 'busy' | 'idle'; message?: string }
}

function emptySession(sessionId: string, directory: string): OpenCodeSession {
  const now = Date.now()
  return {
    id: sessionId,
    slug: sessionId,
    projectID: '',
    directory,
    title: sessionId.slice(0, 12),
    version: '0',
    time: { created: now, updated: now },
    project: null,
  }
}

export class BridgeStore {
  private readonly sessions = new Map<string, BridgeSessionState>()
  private readonly listeners = new Set<(event: OpenCodeGlobalEvent) => void>()

  constructor(readonly directory: string) {}

  subscribe(listener: (event: OpenCodeGlobalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: OpenCodeGlobalEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  listSessions(): OpenCodeSession[] {
    return [...this.sessions.values()]
      .map((entry) => entry.session)
      .sort((a, b) => b.time.updated - a.time.updated)
  }

  getSession(sessionId: string): OpenCodeSession | undefined {
    return this.sessions.get(sessionId)?.session
  }

  getMessages(sessionId: string): OpenCodeMessage[] {
    return this.sessions.get(sessionId)?.messages ?? []
  }

  getParts(sessionId: string, messageId: string): OpenCodePart[] {
    return this.sessions.get(sessionId)?.parts.get(messageId) ?? []
  }

  getTodos(sessionId: string): OpenCodeTodo[] {
    return this.sessions.get(sessionId)?.todos ?? []
  }

  getStatus(sessionId: string): BridgeSessionState['status'] {
    return this.sessions.get(sessionId)?.status ?? { type: 'idle' }
  }

  upsertSession(summary: SessionSummary): OpenCodeSession {
    const existing = this.sessions.get(summary.sessionId)
    const now = Date.now()
    const session: OpenCodeSession = {
      ...(existing?.session ?? emptySession(summary.sessionId, summary.cwd ?? this.directory)),
      id: summary.sessionId,
      directory: summary.cwd ?? existing?.session.directory ?? this.directory,
      time: {
        created: existing?.session.time.created ?? now,
        updated: summary.updatedAt ?? existing?.session.time.updated ?? now,
      },
    }
    this.sessions.set(summary.sessionId, {
      session,
      messages: existing?.messages ?? [],
      parts: existing?.parts ?? new Map(),
      todos: existing?.todos ?? [],
      plan: existing?.plan ?? { active: false },
      status: existing?.status ?? { type: summary.running ? 'busy' : 'idle' },
    })
    this.emit({
      directory: this.directory,
      payload: { type: 'session.updated', properties: { sessionID: summary.sessionId, info: session } },
    })
    return session
  }

  syncHistory(sessionId: string, history: HistoryEntry[]): void {
    this.ensure(sessionId)
    const state = this.sessions.get(sessionId)!
    state.messages = []
    state.parts = new Map()
    for (const entry of history) {
      this.applyEvent(sessionId, entry.event)
    }
  }

  applyEvent(sessionId: string, event: SessionEvent): void {
    this.ensure(sessionId)
    const state = this.sessions.get(sessionId)!
    const data = event.data as Record<string, unknown>

    if (event.type === 'user/message') {
      const payload = (data as { id?: string; content?: DshBlock[] }) ?? data
      const messageId = payload.id ?? id('msg')
      const content = textFromBlocks(payload.content)
      const message: OpenCodeUserMessage = {
        id: messageId,
        sessionID: sessionId,
        role: 'user',
        time: { created: event.time },
        agent: 'build',
        model: { providerID: 'deepseek', modelID: 'deepseek-chat' },
      }
      state.messages.push(message)
      if (content) {
        this.addPart(state, messageId, {
          id: id('part'),
          sessionID: sessionId,
          messageID: messageId,
          type: 'text',
          text: content,
        })
      }
      this.touch(sessionId, event.time)
      this.emit({
        directory: this.directory,
        payload: { type: 'message.updated', properties: { sessionID: sessionId, info: message } },
      })
      return
    }

    if (event.type === 'assistant/message') {
      const payload = (data.message ?? data) as { id?: string; content?: DshBlock[] }
      const messageId = payload.id ?? id('msg')
      const content = textFromBlocks(payload.content)
      const reasoning = reasoningFromBlocks(payload.content)
      const message: OpenCodeAssistantMessage = {
        id: messageId,
        sessionID: sessionId,
        role: 'assistant',
        time: { created: event.time, completed: event.time },
        parentID: [...state.messages].reverse().find((message) => message.role === 'user')?.id ?? '',
        modelID: 'deepseek-chat',
        providerID: 'deepseek',
        mode: 'build',
        agent: 'build',
        path: { cwd: this.directory, root: this.directory },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }
      state.messages.push(message)
      if (reasoning) {
        this.addPart(state, messageId, {
          id: id('part'),
          sessionID: sessionId,
          messageID: messageId,
          type: 'reasoning',
          text: reasoning,
          time: { start: event.time, end: event.time },
        })
      }
      if (content) {
        this.addPart(state, messageId, {
          id: id('part'),
          sessionID: sessionId,
          messageID: messageId,
          type: 'text',
          text: content,
        })
      }
      for (const block of payload.content ?? []) {
        if (block.type === 'tool-call') {
          this.addPart(state, messageId, this.toolPart(sessionId, messageId, block, event.time))
        }
      }
      this.touch(sessionId, event.time)
      this.emit({
        directory: this.directory,
        payload: { type: 'message.updated', properties: { sessionID: sessionId, info: message } },
      })
      return
    }

    if (event.type === 'tool/call') {
      const target = [...state.messages].reverse().find((message) => message.role === 'assistant')
      if (target) {
        const call = data as { callId?: string; name?: string; arguments?: string }
        this.addPart(state, target.id, this.toolPart(sessionId, target.id, {
          type: 'tool-call',
          id: call.callId,
          name: call.name,
          arguments: call.arguments,
        }, event.time))
      }
      return
    }

    if (event.type === 'tool/result') {
      const block = ((data as { message?: { content?: DshBlock[] } }).message?.content ?? [])[0]
      if (!block?.toolCallId) return
      const target = [...state.messages].reverse().find((message) => {
        const parts = state.parts.get(message.id) ?? []
        return parts.some((part) => part.type === 'tool' && part.callID === block.toolCallId)
      })
      if (!target) return
      const parts = state.parts.get(target.id) ?? []
      const part = parts.find((candidate): candidate is OpenCodeToolPart => candidate.type === 'tool' && candidate.callID === block.toolCallId)
      if (!part) return
      const input = part.state.input
      const startedAt = part.state.status === 'running' ? part.state.time.start : event.time
      const output = textFromBlocks(block.content)
      const nextState: OpenCodeToolState = block.isError
        ? {
            status: 'error',
            input,
            error: output || 'tool failed',
            time: { start: startedAt, end: event.time },
          }
        : {
            status: 'completed',
            input,
            output,
            title: toolSummary(part.tool, input as Record<string, unknown>),
            metadata: {},
            time: { start: startedAt, end: event.time },
          }
      part.state = nextState
      this.emit({
        directory: this.directory,
        payload: { type: 'message.part.updated', properties: { sessionID: sessionId, part, time: event.time } },
      })
      return
    }

    if (event.type === 'session/title') {
      const title = (data as { title?: string }).title
      if (!title) return
      const session = state.session
      session.title = title
      session.time.updated = event.time
      this.emit({
        directory: this.directory,
        payload: { type: 'session.updated', properties: { sessionID: sessionId, info: session } },
      })
    }
  }

  applyProjection(sessionId: string, key: string, value: unknown): void {
    const state = this.ensure(sessionId)
    if (key === 'todos' && Array.isArray(value)) {
      state.todos = value.map((item, index) => ({
        id: String((item as { id?: string }).id ?? index + 1),
        content: String((item as { content?: string }).content ?? ''),
        status: ((item as { status?: string }).status as OpenCodeTodo['status']) ?? 'pending',
      }))
      this.emit({
        directory: this.directory,
        payload: { type: 'todo.updated', properties: { sessionID: sessionId, todos: state.todos } },
      })
    }
    if (key === 'plan' && value && typeof value === 'object') {
      state.plan = { active: Boolean((value as { active?: boolean }).active) }
    }
    if (key === 'goal' && value && typeof value === 'object') {
      const condition = (value as { condition?: string }).condition
      this.emit({
        directory: this.directory,
        payload: {
          type: 'session.goal',
          properties: { sessionID: sessionId, ...(condition ? { goal: { condition } } : {}) },
        },
      })
    }
  }

  setStatus(sessionId: string, status: BridgeSessionState['status']): void {
    const state = this.ensure(sessionId)
    state.status = status
    this.emit({
      directory: this.directory,
      payload: { type: 'session.status', properties: { sessionID: sessionId, status } },
    })
    if (status.type === 'idle') {
      this.emit({
        directory: this.directory,
        payload: { type: 'session.idle', properties: { sessionID: sessionId } },
      })
    }
  }

  private ensure(sessionId: string): BridgeSessionState {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = {
        session: emptySession(sessionId, this.directory),
        messages: [],
        parts: new Map(),
        todos: [],
        plan: { active: false },
        status: { type: 'idle' },
      }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private addPart(state: BridgeSessionState, messageId: string, part: OpenCodePart): void {
    const parts = state.parts.get(messageId) ?? []
    const existingIndex = parts.findIndex((candidate) => candidate.id === part.id)
    if (existingIndex >= 0) parts[existingIndex] = part
    else parts.push(part)
    state.parts.set(messageId, parts)
    this.emit({
      directory: this.directory,
      payload: { type: 'message.part.updated', properties: { sessionID: part.sessionID, part, time: Date.now() } },
    })
  }

  private toolPart(sessionId: string, messageId: string, block: DshBlock, time: number): OpenCodeToolPart {
    const input = parseInput(block.arguments)
    return {
      id: block.id ?? id('part'),
      sessionID: sessionId,
      messageID: messageId,
      type: 'tool',
      callID: block.id ?? id('call'),
      tool: block.name ?? 'tool',
      state: {
        status: 'running',
        input,
        title: toolSummary(block.name ?? 'tool', input),
        time: { start: time },
      },
    }
  }

  private touch(sessionId: string, time: number): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.session.time.updated = time
  }
}
