import { render } from '@opentui/solid'
import { createCliRenderer } from '@opentui/core'
import { randomUUID } from 'node:crypto'
import {
  BridgeStore,
  type OpenCodeCommand,
  type OpenCodeModelOption,
  type OpenCodeQuestion,
  type OpenCodeSession,
} from '@dsh/core'
import { App } from './App.tsx'
import type { DshRuntime } from './dsh.ts'

export const name = 'dsh-tui'
export const inject = ['cmdlineArgs', 'appExit', 'agents', 'sessions', 'agentDefaultModel', 'userQuestions', 'loader', 'commands']

class CordisRuntime implements DshRuntime {
  readonly store: BridgeStore
  private started = false
  private readonly questionResolvers = new Map<string, (option: string) => void>()

  constructor(
    private readonly ctx: any,
    private readonly agent: any,
    readonly sessionId: string,
    directory: string,
  ) {
    this.store = new BridgeStore(directory)
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.store.upsertSession({
      sessionId: this.sessionId,
      updatedAt: Date.now(),
      running: false,
      blank: true,
      cwd: this.store.directory,
    })
    this.ctx.on('session/event', (session: { id: string }, event: unknown) => {
      if (session.id !== this.sessionId) return
      this.store.applyEvent(this.sessionId, event as Parameters<BridgeStore['applyEvent']>[1])
    })
    this.ctx.on('agent/status', ({ agent, status }: { agent: { id: string }; status: string }) => {
      if (agent.id !== this.sessionId) return
      this.store.setStatus(this.sessionId, { type: status === 'running' ? 'busy' : 'idle' })
    })
  }

  async refreshSessions(): Promise<void> {
    // In-process mode currently owns one live session. A full profile would
    // read ctx.sessions/list and project all persisted sessions.
  }

  async createSession(): Promise<OpenCodeSession> {
    return this.store.upsertSession({
      sessionId: this.sessionId,
      updatedAt: Date.now(),
      running: false,
      blank: false,
      cwd: this.store.directory,
    })
  }

  async loadHistory(_sessionId: string): Promise<void> {
    // History lives in the live host session.
  }

  async prompt(_sessionId: string, text: string): Promise<void> {
    this.agent.followup({
      role: 'user',
      id: `dsh-tui-${randomUUID()}`,
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
  }

  async abort(): Promise<void> {
    try {
      this.agent.interrupt?.()
    } catch {
      // interruption may not be exposed by this agent revision
    }
  }

  async listCommands(_sessionId: string): Promise<OpenCodeCommand[]> {
    try {
      const commands = this.ctx.get('commands')?.list?.(this.agent) ?? []
      if (commands.length) {
        return commands.map((command: any) => ({
          name: command.name,
          description: command.description,
          input: command.input,
        }))
      }
    } catch {
      // fall back to the built-in DSH command contract
    }
    return [
      { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
      { name: 'goal', description: 'Set or view the goal for a long-running task', input: { hint: '[<objective>|clear|edit <objective>|pause|resume]' } },
      { name: 'compact', description: 'Compact older conversation history' },
      { name: 'permission', description: 'Switch the permission preset (sandbox mode + approval policy)', input: { hint: '<preset>' } },
    ]
  }

  async executeCommand(_sessionId: string, line: string): Promise<unknown> {
    return this.ctx.get('commands')?.execute?.(this.agent, line, new AbortController().signal)
  }

  async answerQuestion(questionId: string, sessionId: string, option: string): Promise<void> {
    this.store.settleQuestion(sessionId, questionId)
    this.questionResolvers.get(questionId)?.(option)
    this.questionResolvers.delete(questionId)
  }

  async listModels(_sessionId: string): Promise<OpenCodeModelOption[]> {
    try {
      const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.() ?? { provider: '', model: '' }
      return [{ provider: selection.provider, id: selection.model }]
    } catch {
      return [{ provider: 'deepseek', id: 'deepseek-chat' }]
    }
  }

  async selectModel(_sessionId: string, _provider: string, _model: string): Promise<void> {
    // In-process model switching belongs to the host agent; leave for profile integration.
  }

  subscribe(listener: (event: unknown) => void): () => void {
    return this.store.subscribe(listener)
  }

  stop(): void {
    // The DSH process owns lifecycle; nothing extra to dispose here.
  }

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
    const item = request.questions[0]
    if (!item) return Promise.resolve([])
    const options = item.options?.length ? item.options.map((option) => option.label) : ['Yes', 'No']
    const kind: OpenCodeQuestion['kind'] =
      item.intent?.kind === 'plan-review'
        ? 'plan-approval'
        : /allow|permission|deny/i.test(`${item.header ?? ''} ${item.question} ${options.join(' ')}`)
          ? 'permission'
          : 'question'
    return new Promise((resolve) => {
      this.questionResolvers.set(item.id, (option) => {
        resolve([{ id: item.id, selected: [option] }])
      })
      this.store.pushQuestion({
        id: item.id,
        sessionID: this.sessionId,
        kind,
        title: item.question,
        body: item.detail ?? item.header,
        options,
      })
    })
  }
}

export function apply(ctx: any): void {
  void run(ctx).catch((error) => {
    console.error(`dsh-tui: ${(error as Error).message}`)
    ctx.get('appExit')?.(1)
  })
}

async function run(ctx: any): Promise<void> {
  const exit = ctx.get('appExit')
  await ctx.get('loader')?.await?.()

  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  if (!agents || !defaultModel) throw new Error('dsh-tui requires agents + agentDefaultModel services')

  const selection = defaultModel.currentSelection()
  const sessionId = `session-${randomUUID()}`
  const { agent } = await agents.create({
    sessionId,
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
  })
  await agent.whenIdle()

  const runtime = new CordisRuntime(ctx, agent, agent.session.id, process.cwd())
  await runtime.start()

  ctx.get('userQuestions')?.registerProvider?.({
    ask: (request: { questions: unknown[] }) => runtime.questionFor(request as never),
  })

  const renderer = await createCliRenderer({
    externalOutputMode: 'passthrough',
    targetFps: 30,
    exitOnCtrlC: true,
    autoFocus: true,
    useMouse: false,
  })

  await render(() => <App dsh={runtime} />, renderer)
  await ctx.get('sessions')?.flush?.(agent.session).catch(() => {})
  exit?.(0)
}
