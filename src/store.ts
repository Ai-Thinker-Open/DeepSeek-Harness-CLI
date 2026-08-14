import type {
  AgentEvent,
  AgentStatus,
  ChatMessage,
  Question,
  SessionMeta,
  TodoItem,
} from './types.ts'

export interface UiState {
  messages: ChatMessage[]
  status: AgentStatus
  statusDetail: string
  sessionId: string
  title: string
  model: string
  todos: TodoItem[]
  planMode: boolean
  questions: Question[]
  sessionList: SessionMeta[]
  /** Non-zero when the agent is busy (drives the whale animation). */
  busy: boolean
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}

const initial = (partial: Partial<UiState>): UiState => ({
  messages: [],
  status: 'idle',
  statusDetail: '',
  sessionId: '',
  title: '',
  model: '',
  todos: [],
  planMode: false,
  questions: [],
  sessionList: [],
  busy: false,
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  ...partial,
})

/** Tiny observable store: the agent loop mutates it, the TUI subscribes. */
export class Store {
  private s: UiState
  private listeners = new Set<() => void>()

  constructor(partial: Partial<UiState> = {}) {
    this.s = initial(partial)
  }

  getState(): UiState {
    return this.s
  }

  getSnapshot(): UiState {
    return this.s
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private mutate(fn: (s: UiState) => void): void {
    const next = { ...this.s }
    fn(next)
    this.s = next
    for (const l of [...this.listeners]) l()
  }

  /** Replace the whole state (session switch / resume). */
  reset(partial: {
    messages?: ChatMessage[]
    todos?: TodoItem[]
    planMode?: boolean
    sessionId?: string
    title?: string
    model?: string
    sessionList?: SessionMeta[]
  }): void {
    this.s = initial({
      messages: partial.messages ?? [],
      todos: partial.todos ?? [],
      planMode: partial.planMode ?? false,
      sessionId: partial.sessionId ?? this.s.sessionId,
      title: partial.title ?? this.s.title,
      model: partial.model ?? this.s.model,
      sessionList: partial.sessionList ?? this.s.sessionList,
    })
    for (const l of [...this.listeners]) l()
  }

  setSessionList(list: SessionMeta[]): void {
    this.mutate((s) => {
      s.sessionList = list
    })
  }

  setModel(model: string): void {
    this.mutate((s) => {
      s.model = model
    })
  }

  handleEvent(ev: AgentEvent): void {
    switch (ev.type) {
      case 'status':
        this.mutate((s) => {
          s.status = ev.status
          s.statusDetail = ev.detail ?? ''
          s.busy = ev.status === 'thinking' || ev.status === 'working'
        })
        break
      case 'message':
        this.mutate((s) => {
          s.messages.push(ev.message)
        })
        break
      case 'message-update':
        this.mutate((s) => {
          const m = s.messages.find((x) => x.id === ev.id)
          if (m) Object.assign(m, ev.patch)
        })
        break
      case 'thinking':
        this.mutate((s) => {
          const m = s.messages.find((x) => x.id === ev.id)
          if (m) m.thinking = (m.thinking ?? '') + ev.text
        })
        break
      case 'tool-call':
        this.mutate((s) => {
          const m = s.messages.find((x) => x.id === ev.id)
          if (!m) return
          m.toolCalls = m.toolCalls ?? []
          const idx = m.toolCalls.findIndex((c) => c.id === ev.call.id)
          if (idx >= 0) m.toolCalls[idx] = ev.call
          else m.toolCalls.push(ev.call)
        })
        break
      case 'tool-result':
        this.mutate((s) => {
          const m = s.messages.find((x) => x.id === ev.id)
          if (!m) return
          m.toolResults = m.toolResults ?? []
          const idx = m.toolResults.findIndex((r) => r.toolCallId === ev.result.toolCallId)
          if (idx >= 0) m.toolResults[idx] = ev.result
          else m.toolResults.push(ev.result)
        })
        break
      case 'todos':
        this.mutate((s) => {
          s.todos = ev.todos
        })
        break
      case 'plan-mode':
        this.mutate((s) => {
          s.planMode = ev.active
        })
        break
      case 'question':
        this.mutate((s) => {
          s.questions.push(ev.question)
          s.status = 'question'
        })
        break
      case 'question-settled':
        this.mutate((s) => {
          s.questions = s.questions.filter((q) => q.id !== ev.id)
          if (s.questions.length === 0) s.status = s.busy ? 'working' : 'idle'
        })
        break
      case 'done':
        this.mutate((s) => {
          s.status = 'idle'
          s.busy = false
        })
        break
      case 'error':
        this.mutate((s) => {
          s.status = 'error'
          s.busy = false
        })
        break
      case 'title':
        this.mutate((s) => {
          s.title = ev.title
        })
        break
      case 'usage':
        this.mutate((s) => {
          s.usage = ev.usage
        })
        break
    }
  }
}
