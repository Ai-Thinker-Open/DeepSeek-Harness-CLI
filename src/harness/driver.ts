/**
 * HarnessDriver: drives the TUI/headless session against a live DeepSeek
 * Harness web instance instead of a local agent loop. Implements the same
 * surface the App uses from `Agent` (sendUser / abort / togglePlanMode /
 * setModel / updateTodos / sessionId / model), so the UI is agnostic.
 */
import type { ChatMessage, Question, SessionDriver, TodoItem } from '../types.ts'
import { Store } from '../store.ts'
import { QuestionCenter } from '../agent.ts'
import { HarnessClient, type ServerRequest, type SessionEvent } from './client.ts'
import { eventToMessage, foldToolResult, titleFromEvents } from './fold.ts'
import { EventFolder } from './folder.ts'

export interface HarnessDriverOptions {
  client: HarnessClient
  store: Store
  questionCenter: QuestionCenter
  sessionId: string
  cwd: string
  model: string
  onTitle?: (title: string) => void
}

const TURN_TIMEOUT_MS = 30 * 60_000

export class HarnessDriver implements SessionDriver {
  readonly client: HarnessClient
  readonly store: Store
  readonly questionCenter: QuestionCenter
  readonly cwd: string
  sessionId: string
  model: string
  planMode = false
  private onTitle?: (title: string) => void
  private folder: EventFolder

  private abortController = new AbortController()
  private listening = false
  private titleSet = false
  private turnWaiters: Array<{ resolve: () => void; timer: NodeJS.Timeout }> = []

  constructor(opts: HarnessDriverOptions) {
    this.client = opts.client
    this.store = opts.store
    this.questionCenter = opts.questionCenter
    this.sessionId = opts.sessionId
    this.cwd = opts.cwd
    this.model = opts.model
    this.onTitle = opts.onTitle
    this.folder = new EventFolder(opts.store)
  }

  get isAborted(): boolean {
    return this.abortController.signal.aborted
  }

  /** Load conversation history into the store (resume). */
  async loadHistory(): Promise<void> {
    try {
      const h = await this.client.history(this.sessionId)
      const messages = h.events.map((e) => eventToMessage(e.event)).filter((m): m is ChatMessage => m !== null)
      // fold tool calls/results onto assistant messages
      for (const entry of h.events) {
        if (entry.event.type === 'tool/result') foldToolResult(messages, entry.event)
      }
      const title =
        titleFromEvents(h.events.map((e) => e.event)) ??
        messages.find((m) => m.role === 'user')?.content.slice(0, 48) ??
        'Session'
      this.store.reset({
        messages,
        sessionId: this.sessionId,
        title,
        model: this.model,
      })
      if (messages.some((m) => m.role === 'user')) this.titleSet = true
      this.applyProjections(h.projections as Record<string, unknown> | undefined)
    } catch (e) {
      // history unavailable — start blank
      this.store.reset({ sessionId: this.sessionId, model: this.model })
    }
  }

  /** Start consuming the mux event stream for this session (reconnects). */
  startListening(): void {
    if (this.listening) return
    this.listening = true
    void this.listenLoop()
  }

  private async listenLoop(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      try {
        for await (const frame of this.client.eventStream(this.abortController.signal)) {
          this.onFrame(frame)
        }
        break // stream ended cleanly
      } catch (e) {
        if (this.abortController.signal.aborted) break
        // transient failure — reconnect after a pause
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    this.listening = false
  }

  private onFrame(frame: ServerRequest): void {
    const payload = frame.payload as { sessionId?: string; [k: string]: unknown }
    if (!payload.sessionId || payload.sessionId !== this.sessionId) return
    switch (frame.method) {
      case 'session/event': {
        const ev = (payload as unknown as { event: SessionEvent }).event
        this.folder.onEvent(ev)
        if (ev.type === 'turn/end' || ev.type === 'host/agent-error') this.settleTurn()
        break
      }
      case 'question/requested':
        this.onQuestionRequested(frame)
        break
      case 'host/session-status':
        this.store.handleEvent({
          type: 'status',
          status: (payload as { running: boolean }).running ? 'working' : 'idle',
        })
        break
      case 'session/projection':
        this.onProjection(payload as { key: string; value: unknown })
        break
      case 'host/agent-error':
        this.store.handleEvent({ type: 'error', message: String(payload.message ?? 'agent error') })
        this.settleTurn()
        break
    }
  }

  // ── questions / projections ───────────────────────────────────────

  private onQuestionRequested(frame: ServerRequest): void {
    const payload = frame.payload as {
      sessionId: string
      questions: Array<{
        id: string
        question: string
        header?: string
        detail?: string
        options?: Array<{ label: string; description?: string }>
        intent?: { kind: 'plan-review'; approve: string }
      }>
    }
    const q = payload.questions[0]
    if (!q) return
    const options = q.options?.length ? q.options.map((o) => o.label) : ['Yes', 'No']
    const labels = options.join(' ')
    const kind: Question['kind'] =
      q.intent?.kind === 'plan-review'
        ? 'plan-approval'
        : /allow|permission|deny/i.test(`${q.header ?? ''} ${q.question} ${labels}`)
          ? 'permission'
          : 'ask-user'
    const rpcIdToAnswer = frame.rpcId
    void this.questionCenter
      .ask({
        kind,
        title: q.question,
        body: q.detail ?? q.header,
        options,
      })
      .then((choice) => {
        void this.client.respond(rpcIdToAnswer, this.sessionId, [{ id: q.id, selected: [choice] }]).catch(() => {})
      })
  }

  private onProjection(payload: { key: string; value: unknown }): void {
    this.applyProjections({ [payload.key]: payload.value })
  }

  private applyProjections(projections: Record<string, unknown> | undefined): void {
    if (!projections) return
    const todos = projections['todos']
    if (Array.isArray(todos)) {
      const items: TodoItem[] = todos.map((t, i) => ({
        id: String(i + 1),
        content: String((t as { content?: string }).content ?? ''),
        status: ((t as { status?: string }).status as TodoItem['status']) ?? 'pending',
      }))
      this.store.handleEvent({ type: 'todos', todos: items })
    }
    const plan = projections['plan'] as { active?: boolean } | undefined
    if (plan && typeof plan.active === 'boolean') {
      this.planMode = plan.active
      this.store.handleEvent({ type: 'plan-mode', active: plan.active })
    }
  }

  // ── public surface (mirrors Agent) ────────────────────────────────

  async sendUser(text: string): Promise<void> {
    if (this.titleSet === false) {
      this.titleSet = true
      const title = text.trim().split('\n')[0]?.slice(0, 48) || 'Session'
      this.store.handleEvent({ type: 'title', title })
      this.onTitle?.(title)
      void this.client.rename(this.sessionId, title).catch(() => {})
    }
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    }
    this.store.handleEvent({ type: 'message', message: userMsg })
    try {
      await this.client.prompt(this.sessionId, text)
    } catch (e) {
      this.store.handleEvent({ type: 'error', message: (e as Error).message })
      return
    }
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
    if (!this.abortController.signal.aborted) this.abortController.abort(reason)
    this.questionCenter.settleAll('Deny')
    void this.client.cancel(this.sessionId).catch(() => {})
    this.settleTurn()
  }

  /** Stop the mux listener and let the process exit (the harness session persists). */
  close(): void {
    if (!this.abortController.signal.aborted) this.abortController.abort('close')
    this.settleTurn()
  }

  /** Plan mode lives inside the harness; local toggle is a no-op. */
  togglePlanMode(): boolean {
    this.store.handleEvent({ type: 'plan-mode', active: this.planMode })
    return this.planMode
  }

  /** Switch model through the harness catalog. */
  setModel(model: string): void {
    this.model = model
    this.store.setModel(model)
    void this.client
      .models(this.sessionId)
      .then((catalog) => {
        const groups = (catalog as { groups?: Array<{ id: string; models: Array<{ id: string; name?: string }> }> }).groups ?? []
        for (const g of groups) {
          const found = g.models.find((m) => m.id === model || m.name === model)
          if (found) {
            void this.client.selectModel(this.sessionId, g.id, found.id).catch(() => {})
            return
          }
        }
      })
      .catch(() => {})
  }

  /** Cycle to the next model in the harness catalog. */
  cycleModel(): void {
    void this.client
      .models(this.sessionId)
      .then((catalog) => {
        const groups = (catalog as { groups?: Array<{ id: string; models: Array<{ id: string }> }> }).groups ?? []
        const all = groups.flatMap((g) => g.models.map((m) => ({ provider: g.id, id: m.id })))
        if (!all.length) return
        const idx = all.findIndex((x) => x.id === this.model)
        const next = all[(idx + 1) % all.length] ?? (all[0] as { provider: string; id: string })
        this.model = next.id
        this.store.setModel(next.id)
        void this.client.selectModel(this.sessionId, next.provider, next.id).catch(() => {})
      })
      .catch(() => {})
  }

  updateTodos(_todos: TodoItem[]): void {
    // todos are owned by the harness (todo_write tool); the projection syncs them
  }

  /** Pull the latest assistant answer text (used by headless mode). */
  getLastAnswer(): string {
    const msgs = this.store.getState().messages
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m && m.role === 'assistant' && m.content.trim()) return m.content
    }
    return ''
  }

  loadMessages(_msgs: ChatMessage[]): void {
    // history comes from the harness
  }
}
