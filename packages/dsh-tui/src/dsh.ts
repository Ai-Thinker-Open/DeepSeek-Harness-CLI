import {
  BridgeStore,
  DshRemoteClient,
  HarnessClient,
  type OpenCodeSession,
  type ServerRequest,
  type SessionSummary,
} from '@dsh/core'

export interface DshTuiOptions {
  harnessUrl: string
  directory: string
}

export class DshTui {
  readonly client: HarnessClient
  readonly remote: DshRemoteClient
  readonly store: BridgeStore
  private readonly abortController = new AbortController()
  private listening = false

  constructor(options: DshTuiOptions) {
    this.client = new HarnessClient(options.harnessUrl)
    this.remote = new DshRemoteClient(this.client)
    this.store = new BridgeStore(options.directory)
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
      // DSH may not be running yet; UI remains usable.
    }
  }

  async createSession(directory = this.store.directory): Promise<OpenCodeSession> {
    const result = await this.client.createSession(directory)
    const summary: SessionSummary = {
      sessionId: result.sessionId,
      updatedAt: Date.now(),
      running: false,
      blank: true,
      cwd: directory,
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

  async listCommands(sessionId: string) {
    try {
      const commands = await this.remote.listCommands(sessionId)
      if (commands.length) return commands
    } catch {
      // fall through
    }
    return [
      { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
      { name: 'goal', description: 'Set or view the goal for a long-running task', input: { hint: '[<objective>|clear|edit <objective>|pause|resume]' } },
      { name: 'compact', description: 'Compact older conversation history' },
      { name: 'permission', description: 'Switch the permission preset (sandbox mode + approval policy)', input: { hint: '<preset>' } },
    ]
  }

  async executeCommand(sessionId: string, line: string) {
    return this.remote.executeCommand(sessionId, line)
  }

  subscribe(listener: (event: unknown) => void): () => void {
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

    if (frame.method === 'host/session-status') {
      this.store.setStatus(sessionId, { type: payload.running ? 'busy' : 'idle' })
    }
  }
}
