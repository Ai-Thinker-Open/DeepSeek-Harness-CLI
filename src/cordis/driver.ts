/**
 * CordisDriver: in-process session driver used when dskharness runs as a Cordis
 * plugin inside a `dsh --profile cli` launch. Drives the host's real agent
 * directly (agents.create / followup / whenIdle) and folds its session events
 * into the store — no HTTP, no local agent loop.
 */
import type { ChatMessage, Question, SessionDriver, TodoItem } from '../types.ts'
import { Store } from '../store.ts'
import { QuestionCenter } from '../agent.ts'
import { EventFolder } from '../harness/folder.ts'

/** Minimal user-message shape the host agent accepts (mirrors createUserMessage). */
function userMessage(text: string): {
  role: 'user'
  id: string
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'user' }
} {
  return {
    role: 'user',
    id: `cli-${Math.random().toString(36).slice(2, 10)}`,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

const TURN_TIMEOUT_MS = 30 * 60_000

export interface CordisDriverOptions {
  ctx: unknown
  agent: unknown
  store: Store
  questionCenter: QuestionCenter
  sessionId: string
  model: string
  cwd: string
}

export class CordisDriver implements SessionDriver {
  readonly ctx: any
  readonly agent: any
  readonly store: Store
  readonly questionCenter: QuestionCenter
  readonly cwd: string
  sessionId: string
  model: string
  planMode = false
  private folder: EventFolder
  private titleSet = false
  private turnWaiters: Array<{ resolve: () => void; timer: NodeJS.Timeout }> = []

  constructor(opts: CordisDriverOptions) {
    this.ctx = opts.ctx
    this.agent = opts.agent
    this.store = opts.store
    this.questionCenter = opts.questionCenter
    this.sessionId = opts.sessionId
    this.model = opts.model
    this.cwd = opts.cwd
    this.folder = new EventFolder(opts.store)
  }

  /** Subscribe to the host session-event bus for this session. */
  subscribe(): void {
    this.ctx.on('session/event', (session: { id: string }, event: unknown) => {
      if (session.id !== this.sessionId) return
      const ev = event as Parameters<EventFolder['onEvent']>[0]
      this.folder.onEvent(ev)
      if (ev.type === 'turn/end') this.settleTurn()
    })
    this.ctx.on('agent/status', ({ agent, status }: { agent: { id: string }; status: string }) => {
      if (agent.id !== this.sessionId) return
      if (status === 'running') this.store.handleEvent({ type: 'status', status: 'working' })
    })
  }

  async sendUser(text: string): Promise<void> {
    if (!this.titleSet) {
      this.titleSet = true
      const title = text.trim().split('\n')[0]?.slice(0, 48) || 'Session'
      this.store.handleEvent({ type: 'title', title })
    }
    // The user message is rendered from the host's own user/message event;
    // pushing it here would duplicate it.
    this.agent.followup(userMessage(text))
    await this.waitForTurnEnd()
  }

  private waitForTurnEnd(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.turnWaiters = this.turnWaiters.filter((w) => w.resolve !== resolve)
        resolve()
      }, TURN_TIMEOUT_MS)
      this.turnWaiters.push({ resolve, timer })
    })
  }

  private settleTurn(): void {
    for (const w of this.turnWaiters) {
      clearTimeout(w.timer)
      w.resolve()
    }
    this.turnWaiters = []
  }

  abort(reason = 'interrupted'): void {
    void reason
    this.questionCenter.settleAll('Deny')
    try {
      this.agent.interrupt?.()
    } catch {
      /* not supported by this agent — the turn will finish on its own */
    }
    this.settleTurn()
  }

  togglePlanMode(): boolean {
    this.store.handleEvent({ type: 'plan-mode', active: this.planMode })
    return this.planMode
  }

  setModel(model: string): void {
    this.model = model
    this.store.setModel(model)
  }

  cycleModel(): void {
    // the host agent owns model selection in this mode
    void this.setModel(this.model)
  }

  updateTodos(_todos: TodoItem[]): void {
    // todos are owned by the host agent (todo_write tool)
  }

  getLastAnswer(): string {
    const msgs = this.store.getState().messages
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m && m.role === 'assistant' && m.content.trim()) return m.content
    }
    return ''
  }

  loadMessages(_msgs: ChatMessage[]): void {
    // history lives in the host session
  }

  /** Bridge one host question (ask_user / permission / plan review) to the TUI modal. */
  questionFor(request: {
    questions: Array<{
      id: string
      question: string
      header?: string
      detail?: string
      options?: Array<{ label: string; description?: string }>
      intent?: { kind: 'plan-review'; approve: string }
    }>
  }): Promise<Array<{ id: string; selected: string[] }>> {
    const q = request.questions[0]
    if (!q) return Promise.resolve([])
    const options = q.options?.length ? q.options.map((o) => o.label) : ['Yes', 'No']
    const labels = options.join(' ')
    const kind: Question['kind'] =
      q.intent?.kind === 'plan-review'
        ? 'plan-approval'
        : /allow|permission|deny/i.test(`${q.header ?? ''} ${q.question} ${labels}`)
          ? 'permission'
          : 'ask-user'
    return this.questionCenter
      .ask({
        kind,
        title: q.question,
        body: q.detail ?? q.header,
        options,
      })
      .then((choice) => [{ id: q.id, selected: [choice] }])
  }
}
