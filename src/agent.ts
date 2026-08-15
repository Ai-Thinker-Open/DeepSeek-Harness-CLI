import type { AgentEvent, ChatMessage, Question, SessionDriver, ToolContext, TodoItem } from './types.ts'
import type { CliConfig } from './config.ts'
import { streamChat } from './api.ts'
import { buildSystemPrompt, toWireMessages } from './prompt.ts'
import { Store } from './store.ts'
import type { ToolDef } from './tools/types.ts'
import { runToolCall } from './tools/executor.ts'
import { defaultTools } from './tools/index.ts'
import { GoalManager } from './tools/goal.ts'
import type { JobState } from './types.ts'
import { appendEvent, createSession } from './sessions.ts'
import { listSkills } from './tools/skill.ts'

let qCounter = 0

/**
 * Routes questions (ask_user / permissions / plan approval) to the store,
 * where the TUI renders a modal and the user answers.
 */
export class QuestionCenter {
  private open: Array<{ id: string; resolve: (opt: string) => void }> = []
  private auto: 'answer' | 'interactive'
  private autoAllow: boolean
  constructor(private store: Store, autoAnswer: boolean, autoAllow = false) {
    this.auto = autoAnswer ? 'answer' : 'interactive'
    this.autoAllow = autoAllow
  }

  get isAuto(): boolean {
    return this.auto === 'answer'
  }

  /** YOLO mode: auto-approve permission questions even in interactive mode. */
  setAutoAllow(value: boolean): void {
    this.autoAllow = value
  }

  ask(q: Omit<Question, 'id' | 'resolve' | 'cancel'>, requester?: string): Promise<string> {
    const title = requester ? `[${requester}] ${q.title}` : q.title
    return new Promise<string>((resolve) => {
      if (this.auto === 'answer') {
        // Headless / auto mode: permissions follow the -y flag; other
        // questions (ask_user, plan review) pick the first option.
        if (q.kind === 'permission') {
          resolve(this.autoAllow ? (q.options[0] as string) : (q.options[q.options.length - 1] as string))
        } else {
          resolve(q.options[0] as string)
        }
        return
      }
      if (q.kind === 'permission' && this.autoAllow) {
        // YOLO mode: approve permissions without a prompt
        resolve(q.options[0] as string)
        return
      }
      const id = `q-${++qCounter}`
      const settle = (opt: string) => {
        this.open = this.open.filter((o) => o.id !== id)
        this.store.handleEvent({ type: 'question-settled', id })
        resolve(opt)
      }
      const question: Question = {
        ...q,
        title,
        id,
        resolve: (opt) => settle(opt),
        cancel: () => settle(q.options[q.options.length - 1] as string),
      }
      this.open.push({ id, resolve: settle })
      this.store.handleEvent({ type: 'question', question })
    })
  }

  /** Resolve every open question (used when the agent is aborted). */
  settleAll(answer: string): void {
    for (const o of [...this.open]) o.resolve(answer)
    this.open = []
  }
}

export interface AgentSink {
  emit: (ev: AgentEvent) => void
  persist?: (ev: unknown) => void
  questionCenter: QuestionCenter
}

export interface AgentOptions {
  config: CliConfig
  store: Store
  sink: AgentSink
  tools?: ToolDef[]
  sessionId: string
  cwd: string
  model: string
  planMode?: boolean
  autoApprove?: boolean
  onTitle?: (title: string) => void
  goalManager?: GoalManager
  jobs?: JobManager
  requesterLabel?: string
  maxTurns?: number
}

function tryParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : { _raw: raw }
  } catch {
    return { _raw: raw }
  }
}

/** The core agent loop, shared by the interactive session and subagents. */
export class Agent implements SessionDriver {
  readonly config: CliConfig
  readonly store: Store
  readonly sink: AgentSink
  readonly tools: ToolDef[]
  sessionId: string
  readonly cwd: string
  model: string
  planMode: boolean
  autoApprove: boolean
  readonly goalManager: GoalManager
  readonly jobs: JobManager
  readonly requesterLabel?: string

  private messages: Array<{
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string
    tool_call_id?: string
    toolCalls?: Array<{ id: string; name: string; args: unknown }>
    toolResults?: Array<{ toolCallId: string; ok: boolean; output: string }>
  }> = []
  private todos: TodoItem[] = []
  private alwaysAllow = new Set<string>()
  private abortController = new AbortController()
  private maxTurns: number
  private titleSet = false
  private sentUserCount = 0

  constructor(opts: AgentOptions) {
    this.config = opts.config
    this.store = opts.store
    this.sink = opts.sink
    this.tools = opts.tools ?? defaultTools()
    this.sessionId = opts.sessionId
    this.cwd = opts.cwd
    this.model = opts.model
    this.planMode = opts.planMode ?? false
    this.autoApprove = opts.autoApprove ?? opts.config.autoApprove
    this.goalManager = opts.goalManager ?? new GoalManager()
    this.jobs = opts.jobs ?? new JobManager(opts.config, this.tools, opts.sink.questionCenter, this.cwd)
    this.requesterLabel = opts.requesterLabel
    this.maxTurns = opts.maxTurns ?? 50
    void opts.onTitle
  }

  get isAborted(): boolean {
    return this.abortController.signal.aborted
  }

  /** The most recent non-empty assistant answer (used by subagent collection). */
  getLastAnswer(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]
      if (m && m.role === 'assistant' && m.content.trim()) return m.content
    }
    return ''
  }

  abort(reason = 'interrupted'): void {
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(reason)
    }
    this.sink.questionCenter.settleAll('Deny')
  }

  getJobManager(): JobManager {
    return this.jobs
  }

  /** Load a persisted conversation (on resume / session switch). */
  loadMessages(msgs: ChatMessage[]): void {
    this.messages = []
    for (const m of msgs) {
      if (m.role === 'user' || m.role === 'system') {
        this.messages.push({ role: m.role, content: m.content })
      } else if (m.role === 'assistant') {
        this.messages.push({
          role: 'assistant',
          content: m.content,
          toolCalls: (m.toolCalls ?? []).map((c) => ({ id: c.id, name: c.name, args: c.args })),
          toolResults: (m.toolResults ?? []).map((r) => ({ toolCallId: r.toolCallId, ok: r.ok, output: r.output })),
        })
      }
    }
    if (this.messages.some((m) => m.role === 'user')) this.titleSet = true
  }

  setAutoApprove(value: boolean): void {
    this.autoApprove = value
  }

  /** Flip plan mode; returns the new state. */
  togglePlanMode(): boolean {
    this.planMode = !this.planMode
    this.emit({ type: 'plan-mode', active: this.planMode })
    this.persist({ type: 'plan', active: this.planMode })
    return this.planMode
  }

  setModel(model: string): void {
    this.model = model
  }

  /** Cycle between the local model presets. */
  cycleModel(): void {
    const MODELS = ['deepseek-chat', 'deepseek-reasoner']
    const next = MODELS[(MODELS.indexOf(this.model) + 1) % MODELS.length] as string
    this.setModel(next)
  }

  /** Replace the todo list (used by the TUI sidebar as well as todo_write). */
  updateTodos(todos: TodoItem[]): void {
    this.todos = todos
    this.emit({ type: 'todos', todos })
    this.persist({ type: 'todos', todos })
  }

  // ── slash-command support ─────────────────────────────────────────

  renameSession(title: string): void {
    this.titleSet = true
    this.emit({ type: 'title', title })
    this.persist({ type: 'session', id: this.sessionId, title, model: this.model, cwd: this.cwd, createdAt: Date.now() })
  }

  /** Copy the current conversation into a fresh session file; returns its id. */
  forkSession(): string | undefined {
    try {
      const { id } = createSession(this.model, this.cwd)
      for (const m of this.store.getState().messages) {
        appendEvent(id, { type: 'message', message: m } as never)
      }
      appendEvent(id, { type: 'todos', todos: this.todos } as never)
      return id
    } catch {
      return undefined
    }
  }

  /** Summarize the older half of the context with the model; keep the tail. */
  async compactContext(): Promise<string> {
    if (this.messages.length <= 8) return 'context is short — nothing to compact'
    const head = this.messages.slice(0, -8)
    const tail = this.messages.slice(-8)
    const sys =
      'You are a context compactor for a coding agent. Compress the following conversation excerpt into a concise factual summary that preserves decisions, file paths, commands, and open questions. Plain text, no preamble.'
    const text = head
      .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 400) : JSON.stringify(m.content).slice(0, 400)}`)
      .join('\n---\n')
    try {
      const r = await streamChat(this.config.baseUrl, this.config.apiKey, {
        model: this.model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: text },
        ],
        signal: this.abortController.signal,
      }, {})
      const summary = r.content.trim()
      if (!summary) return 'compact produced no summary'
      this.messages = [{ role: 'system', content: `[compacted context]\n${summary}` }, ...tail]
      return `compacted ${head.length} messages into a summary (kept last ${tail.length})`
    } catch (e) {
      return `compact failed: ${(e as Error).message}`
    }
  }

  goalText(): string {
    return 'goals are managed in-conversation with the goal tool — ask the agent, or use /goal in connected mode'
  }

  sessionStatus(): string {
    const u = this.store.getState().usage
    return `model ${this.model} · ${this.messages.length} messages · ${u.totalTokens} tokens · session ${this.sessionId.slice(0, 8)}`
  }

  listTools(): string {
    return defaultTools()
      .map((t) => t.name)
      .join(' · ')
  }

  listSkills(): string {
    const skills = listSkills()
    return skills.length
      ? skills.map((s) => `${s.name}: ${s.description}`).join('\n')
      : 'no skills installed (~/.dskharness/skills/)'
  }

  listJobs(): string {
    const jobs = this.jobs.list()
    return jobs.length
      ? jobs.map((j) => `${j.id} [${j.status}] ${j.prompt.slice(0, 50)}`).join('\n')
      : 'no background jobs'
  }

  private emit(ev: AgentEvent): void {
    this.sink.emit(ev)
  }

  private persist(ev: unknown): void {
    this.sink.persist?.(ev)
  }

  /** Reset the shared store for a different session (resume / new / switch). */
  static resetStore(store: Store, partial: {
    messages?: ChatMessage[]
    todos?: TodoItem[]
    planMode?: boolean
    sessionId?: string
    title?: string
    model?: string
  }): void {
    store.reset(partial)
  }

  private buildToolContext(): ToolContext {
    return {
      cwd: this.cwd,
      sessionId: this.sessionId,
      emit: (ev) => this.emit(ev),
      askUser: (q) =>
        this.sink.questionCenter.ask(
          { ...q, kind: q.kind === 'plan-approval' ? 'plan-approval' : 'ask-user' },
          this.requesterLabel,
        ),
      requestPermission: async (toolName, summary) => {
        if (this.autoApprove) return 'allow'
        if (this.sink.questionCenter.isAuto) return 'deny'
        const r = await this.sink.questionCenter.ask(
          {
            kind: 'permission',
            title: `Allow ${toolName}?`,
            body: summary,
            options: ['Allow', 'Always allow', 'Deny'],
          },
          this.requesterLabel,
        )
        if (r === 'Always allow') return 'always'
        return r === 'Allow' ? 'allow' : 'deny'
      },
      planMode: () => this.planMode,
      setPlanMode: (v) => {
        this.planMode = v
        this.emit({ type: 'plan-mode', active: v })
        this.persist({ type: 'plan', active: v })
      },
      getTodos: () => this.todos,
      setTodos: (t) => {
        this.todos = t
      },
      getModel: () => this.model,
      spawnJob: (prompt, o) => this.jobs.spawn(prompt, { ...o, cwd: o.cwd ?? this.cwd }),
      waitJob: (id) => this.jobs.wait(id),
      getJobOutput: (id) => this.jobs.get(id),
      listJobs: () => this.jobs.list(),
      killJob: (id) => this.jobs.kill(id),
      abortController: this.abortController,
    }
  }

  /** Add a user message and drive the loop until the model answers. */
  async sendUser(text: string): Promise<void> {
    if (this.isAborted) {
      this.abortController = new AbortController()
    }
    const userMsg: ChatMessage = { id: `m-${Date.now()}-${++this.sentUserCount}`, role: 'user', content: text, createdAt: Date.now() }
    this.emit({ type: 'message', message: userMsg })
    this.persist({ type: 'message', message: userMsg })
    this.messages.push({ role: 'user', content: text })
    if (!this.titleSet) {
      this.titleSet = true
      const title = text.trim().split('\n')[0]?.slice(0, 48) || 'New session'
      this.emit({ type: 'title', title })
      this.persist({ type: 'session', id: this.sessionId, title, model: this.model, cwd: this.cwd, createdAt: Date.now() })
    }
    await this.runLoop()
  }

  private async runLoop(): Promise<void> {
    let turns = 0
    while (turns < this.maxTurns) {
      if (this.isAborted) break
      this.emit({ type: 'status', status: 'thinking', detail: 'thinking' })

      const assistantId = `m-${Date.now()}-${turns}`
      const assistant: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        streaming: true,
      }
      this.emit({ type: 'message', message: assistant })

      let streamResult
      try {
        const sysPrompt = buildSystemPrompt({
          cwd: this.cwd,
          tools: this.tools,
          planMode: this.planMode,
          model: this.model,
          instructions: this.config.instructions,
          sessionId: this.sessionId,
        })
        const wireMessages = toWireMessages([
          { role: 'system', content: sysPrompt },
          ...this.messages,
        ])
        streamResult = await streamChat(
          this.config.baseUrl,
          this.config.apiKey,
          {
            model: this.model,
            messages: wireMessages,
            tools: this.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            temperature: this.config.temperature,
            signal: this.abortController.signal,
          },
          {
            onContent: (d) => {
              assistant.content += d
              this.emit({ type: 'message-update', id: assistantId, patch: { content: assistant.content } })
            },
            onReasoning: (d) => {
              this.emit({ type: 'thinking', id: assistantId, text: d })
            },
            onUsage: (usage) => {
              this.emit({ type: 'usage', usage })
            },
          },
        )
      } catch (e) {
        if (this.isAborted) {
          assistant.streaming = false
          assistant.content = assistant.content || `*(interrupted)*`
          this.emit({ type: 'message-update', id: assistantId, patch: { streaming: false, content: assistant.content } })
          this.persist({ type: 'message', message: assistant })
          this.emit({ type: 'done', reason: 'interrupted' })
          return
        }
        assistant.streaming = false
        assistant.error = (e as Error).message
        this.emit({ type: 'message-update', id: assistantId, patch: { streaming: false, error: assistant.error } })
        this.persist({ type: 'message', message: assistant })
        this.emit({ type: 'error', message: (e as Error).message })
        return
      }

      assistant.streaming = false
      const calls = streamResult.toolCalls.map((tc, i) => {
        const args = tryParseArgs(tc.function.arguments)
        const def = this.tools.find((t) => t.name === tc.function.name)
        return {
          id: tc.id || `${assistantId}-tc${i}`,
          name: tc.function.name,
          args,
          summary: def?.summary?.(args) ?? tc.function.name,
          status: 'pending' as const,
        }
      })
      assistant.toolCalls = calls
      this.emit({ type: 'message-update', id: assistantId, patch: { streaming: false, toolCalls: calls } })
      this.persist({ type: 'message', message: assistant })
      this.messages.push({
        role: 'assistant',
        content: assistant.content,
        toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
      })

      if (calls.length === 0) {
        this.emit({ type: 'done', reason: streamResult.finishReason ?? 'stop' })
        return
      }

      turns++
      // execute each tool call, then loop back for the model's next step
      for (const call of calls) {
        if (this.isAborted) break
        const def = this.tools.find((t) => t.name === call.name)
        this.emit({ type: 'tool-call', id: assistantId, call: { ...call, status: 'running', startedAt: Date.now() } })
        this.emit({ type: 'status', status: 'working', detail: call.summary ?? call.name })

        const args = call.args as Record<string, unknown>
        let execResult: { ok: boolean; output: string; denied?: boolean }
        if (!def) {
          execResult = { ok: false, output: `Unknown tool "${call.name}". Available: ${this.tools.map((t) => t.name).join(', ')}` }
        } else {
          execResult = await runToolCall(def, args, this.buildToolContext(), {
            autoApprove: this.autoApprove,
            alwaysAllow: this.alwaysAllow,
          })
        }
        const status = execResult.denied ? 'denied' : execResult.ok ? 'ok' : 'error'
        this.emit({
          type: 'tool-call',
          id: assistantId,
          call: { ...call, status, finishedAt: Date.now() },
        })
        const display = execResult.output.length > 800 ? execResult.output.slice(0, 800) + '\n… [truncated in UI]' : execResult.output
        this.emit({ type: 'tool-result', id: assistantId, result: { toolCallId: call.id, ok: execResult.ok, output: display } })
        this.persist({ type: 'result', toolCallId: call.id, result: { ok: execResult.ok, output: execResult.output } })
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: execResult.output })
      }
      if (this.isAborted) {
        this.emit({ type: 'done', reason: 'interrupted' })
        return
      }
    }
    if (!this.isAborted) {
      this.emit({ type: 'done', reason: 'max-turns' })
    } else {
      this.emit({ type: 'done', reason: 'interrupted' })
    }
  }
}

/** Background subagent jobs (dsh-jobs parity). */
export class JobManager {
  private jobs = new Map<string, JobState>()
  private aborters = new Map<string, AbortController>()
  private resolvers = new Map<string, (job: JobState) => void>()

  constructor(
    private config: CliConfig,
    private tools: ToolDef[],
    private questionCenter: QuestionCenter,
    private defaultCwd: string,
  ) {}

  spawn(prompt: string, opts: { model?: string; cwd?: string } = {}): string {
    const id = `job-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const job: JobState = {
      id,
      prompt,
      status: 'running',
      startedAt: Date.now(),
      model: opts.model ?? this.config.model,
    }
    this.jobs.set(id, job)
    void this.run(job, opts.cwd ?? this.defaultCwd, opts.model ?? this.config.model)
    return id
  }

  private async run(job: JobState, cwd: string, model: string): Promise<void> {
    const controller = new AbortController()
    this.aborters.set(job.id, controller)
    const agent = new Agent({
      config: { ...this.config, cwd },
      store: new Store(),
      sink: {
        emit: () => {},
        questionCenter: this.questionCenter,
      },
      tools: this.tools.filter((t) => t.name !== 'subagent' && t.name !== 'workflow'),
      sessionId: job.id,
      cwd,
      model,
      requesterLabel: `job ${job.id}`,
      maxTurns: 30,
    })
    const originalAbort = agent.abort.bind(agent)
    agent.abort = (reason?: string) => {
      controller.abort(reason)
      originalAbort(reason)
    }
    try {
      await agent.sendUser(job.prompt)
      const result = agent.getLastAnswer()
      job.result = result
      job.status = 'done'
    } catch (e) {
      job.status = 'error'
      job.error = (e as Error).message
    }
    job.finishedAt = Date.now()
    this.aborters.delete(job.id)
    const resolve = this.resolvers.get(job.id)
    if (resolve) {
      this.resolvers.delete(job.id)
      resolve(job)
    }
  }

  wait(id: string): Promise<JobState> {
    const job = this.jobs.get(id)
    if (!job) return Promise.reject(new Error(`no job ${id}`))
    if (job.status !== 'running') return Promise.resolve(job)
    return new Promise((resolve) => this.resolvers.set(id, resolve))
  }

  get(id: string): JobState | undefined {
    return this.jobs.get(id)
  }

  list(): JobState[] {
    return [...this.jobs.values()]
  }

  kill(id: string): void {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'running') return
    job.status = 'killed'
    job.finishedAt = Date.now()
    job.error = 'killed'
    this.aborters.get(id)?.abort('killed')
  }
}

/** Collect the final assistant answer from an agent's message list. */
export function collectFinalAnswer(agent: Agent): string {
  return agent.getLastAnswer()
}
