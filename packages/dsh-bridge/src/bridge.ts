import { HarnessClient, type ServerRequest, type SessionSummary } from './harness.ts'
import { DshRemoteClient } from './remote.ts'
import { BridgeStore } from './store.ts'
import {
  compactCommand,
  goalCommand,
  parseDshCommand,
  permissionCommand,
  planCommand,
} from '../../../src/opencode-bridge/dsh-commands.ts'
import type {
  OpenCodeCommand,
  OpenCodeGlobalEvent,
  OpenCodePermissionRequest,
  OpenCodeQuestionRequest,
  OpenCodeSession,
} from './types.ts'

const DSH_FALLBACK_COMMANDS: OpenCodeCommand[] = [
  { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
  { name: 'goal', description: 'Set or view the goal for a long-running task', input: { hint: '[<objective>|clear|edit <objective>|pause|resume]' } },
  { name: 'compact', description: 'Compact older conversation history' },
  { name: 'permission', description: 'Switch the permission preset (sandbox mode + approval policy)', input: { hint: '<preset>' } },
]

interface PendingDshQuestion {
  rpcId: string
  sessionId: string
  id: string
  options: string[]
  kind: 'permission' | 'question'
}

export interface BridgeOptions {
  harnessUrl: string
  directory?: string
}

export class DshOpenCodeBridge {
  readonly client: HarnessClient
  readonly remote: DshRemoteClient
  readonly store: BridgeStore
  private abortController = new AbortController()
  private listening = false
  private readonly directory: string
  private readonly pendingQuestions = new Map<string, PendingDshQuestion>()

  constructor(options: BridgeOptions) {
    this.client = new HarnessClient(options.harnessUrl)
    this.remote = new DshRemoteClient(this.client)
    this.directory = options.directory ?? process.cwd()
    this.store = new BridgeStore(this.directory)
  }

  async start(): Promise<void> {
    await this.refreshSessions()
    if (!this.listening) {
      this.listening = true
      void this.listenLoop()
    }
  }

  async refreshSessions(): Promise<void> {
    try {
      const { items } = await this.client.listSessions()
      for (const summary of items) this.store.upsertSession(summary)
    } catch {
      // DSH may not be running yet; the server still starts and reports errors
      // through health/routes instead of crashing the launcher.
    }
  }

  async createSession(directory?: string): Promise<OpenCodeSession> {
    const result = await this.client.createSession(directory ?? this.directory)
    const summary: SessionSummary = {
      sessionId: result.sessionId,
      updatedAt: Date.now(),
      running: false,
      blank: true,
      cwd: directory ?? this.directory,
      agentPreset: result.agentPreset,
    }
    return this.store.upsertSession(summary)
  }

  async loadHistory(sessionId: string): Promise<void> {
    const history = await this.client.history(sessionId)
    this.store.syncHistory(sessionId, history.events)
    if (history.projections) {
      for (const [key, value] of Object.entries(history.projections)) {
        this.store.applyProjection(sessionId, key, value)
      }
    }
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await this.client.prompt(sessionId, text)
  }

  async abort(sessionId: string): Promise<void> {
    await this.client.cancel(sessionId)
    this.store.setStatus(sessionId, { type: 'idle' })
  }

  async listCommands(sessionId: string): Promise<OpenCodeCommand[]> {
    try {
      const commands = await this.remote.listCommands(sessionId)
      if (commands.length) return commands
    } catch {
      // fall through to static DSH command contract when Typert Remote is not
      // reachable or this DSH composition does not expose it.
    }
    return DSH_FALLBACK_COMMANDS
  }

  async executeCommand(sessionId: string, line: string): Promise<unknown> {
    try {
      const remote = await this.remote.executeCommand(sessionId, line)
      if (remote) return remote
    } catch {
      // Fall through to the local DSH command contract so the TUI stays
      // usable when the host command registry is not reachable.
    }

    const parsed = parseDshCommand(line)
    if (!parsed) throw new Error(`unknown command: ${line}`)

    if (parsed.name === 'plan') {
      const plan = planCommand(parsed.rawInput)
      this.store.applyProjection(sessionId, 'plan', { active: plan.kind === 'on' })
      return { ok: true, plan }
    }

    if (parsed.name === 'goal') {
      const goal = goalCommand(parsed.rawInput)
      const objective =
        goal.kind === 'create' || goal.kind === 'edit' ? goal.objective : undefined
      this.store.applyProjection(sessionId, 'goal', objective ? { condition: objective } : {})
      return { ok: true, goal }
    }

    if (parsed.name === 'compact') {
      const compact = compactCommand(parsed.rawInput)
      if (!compact.ok) throw new Error(compact.error ?? 'Invalid /compact')
      this.store.emit({
        directory: this.directory,
        payload: { type: 'session.compacted', properties: { sessionID: sessionId } },
      })
      return { ok: true }
    }

    if (parsed.name === 'permission') {
      const permission = permissionCommand(parsed.rawInput)
      if (permission.kind === 'unknown') throw new Error(`Unknown permission preset: ${permission.preset}`)
      return { ok: true, permission }
    }

    return { ok: true }
  }

  listPermissions(): OpenCodePermissionRequest[] {
    return []
  }

  listQuestions(): OpenCodeQuestionRequest[] {
    return []
  }

  async replyPermission(requestID: string, reply: 'once' | 'always' | 'reject'): Promise<void> {
    const pending = this.pendingQuestions.get(requestID)
    this.pendingQuestions.delete(requestID)
    if (!pending) return
    const selected = this.permissionChoice(pending.options, reply)
    await this.client.respond(pending.rpcId, pending.sessionId, [{ id: pending.id, selected: [selected] }])
    this.store.emit({
      directory: this.directory,
      payload: {
        type: 'permission.replied',
        properties: { sessionID: pending.sessionId, requestID, reply },
      },
    })
  }

  async replyQuestion(requestID: string, answers: string[][]): Promise<void> {
    const pending = this.pendingQuestions.get(requestID)
    this.pendingQuestions.delete(requestID)
    if (!pending) return
    const selected = answers[0]?.[0] ?? pending.options[0] ?? 'Yes'
    await this.client.respond(pending.rpcId, pending.sessionId, [{ id: pending.id, selected: [selected] }])
    this.store.emit({
      directory: this.directory,
      payload: {
        type: 'question.replied',
        properties: { sessionID: pending.sessionId, requestID, answers },
      },
    })
  }

  async rejectQuestion(requestID: string): Promise<void> {
    const pending = this.pendingQuestions.get(requestID)
    this.pendingQuestions.delete(requestID)
    if (!pending) return
    const selected = pending.options.at(-1) ?? 'No'
    await this.client.respond(pending.rpcId, pending.sessionId, [{ id: pending.id, selected: [selected] }])
    this.store.emit({
      directory: this.directory,
      payload: {
        type: 'question.rejected',
        properties: { sessionID: pending.sessionId, requestID },
      },
    })
  }

  subscribe(listener: (event: OpenCodeGlobalEvent) => void): () => void {
    return this.store.subscribe(listener)
  }

  stop(): void {
    this.abortController.abort()
  }

  private async listenLoop(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      try {
        for await (const frame of this.client.eventStream(this.abortController.signal)) {
          this.handleFrame(frame)
        }
        break
      } catch {
        if (this.abortController.signal.aborted) break
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }
    this.listening = false
  }

  private handleFrame(frame: ServerRequest): void {
    const payload = frame.payload as { sessionId?: string; key?: string; value?: unknown; running?: boolean }
    const sessionId = payload.sessionId
    if (!sessionId) return

    if (frame.method === 'session/event') {
      const event = (payload as unknown as { event: { type: string; seq: number; time: number; data: Record<string, unknown> } }).event
      this.store.applyEvent(sessionId, event)
      return
    }

    if (frame.method === 'session/projection' && payload.key !== undefined) {
      this.store.applyProjection(sessionId, payload.key, payload.value)
      return
    }

    if (frame.method === 'question/requested') {
      this.handleQuestionRequested(frame, sessionId)
      return
    }

    if (frame.method === 'host/session-status') {
      this.store.setStatus(sessionId, { type: payload.running ? 'busy' : 'idle' })
    }
  }

  private handleQuestionRequested(frame: ServerRequest, sessionId: string): void {
    const payload = frame.payload as {
      questions?: Array<{
        id: string
        question: string
        header?: string
        detail?: string
        options?: Array<{ label: string; description?: string }>
        intent?: { kind: 'plan-review'; approve: string }
      }>
    }
    const item = payload.questions?.[0]
    if (!item) return
    const options = item.options?.length ? item.options.map((option) => option.label) : ['Yes', 'No']
    const isPermission =
      item.intent?.kind !== 'plan-review' &&
      /allow|permission|deny/i.test(`${item.header ?? ''} ${item.question} ${options.join(' ')}`)
    const requestID = item.id
    this.pendingQuestions.set(requestID, {
      rpcId: frame.rpcId,
      sessionId,
      id: item.id,
      options,
      kind: isPermission ? 'permission' : 'question',
    })

    if (isPermission) {
      this.store.emit({
        directory: this.directory,
        payload: {
          type: 'permission.asked',
          properties: {
            id: item.id,
            sessionID: sessionId,
            permission: item.header ?? item.question,
            patterns: [],
            metadata: { description: item.detail ?? item.question },
            always: options,
          },
        },
      })
      return
    }

    this.store.emit({
      directory: this.directory,
      payload: {
        type: 'question.asked',
        properties: {
          id: item.id,
          sessionID: sessionId,
          questions: [
            {
              id: item.id,
              question: item.question,
              header: item.header ?? item.question,
              options: options.map((label) => ({ label, description: '' })),
              multiple: false,
              custom: false,
            },
          ],
        },
      },
    })
  }

  private permissionChoice(options: string[], reply: 'once' | 'always' | 'reject'): string {
    if (reply === 'reject') return options.at(-1) ?? 'Deny'
    if (reply === 'always') return options[1] ?? options[0] ?? 'Allow'
    return options[0] ?? 'Allow'
  }
}
