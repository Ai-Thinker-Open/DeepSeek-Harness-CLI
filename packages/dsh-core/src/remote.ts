import { HarnessClient } from './harness.ts'

export interface RemoteCommandDescriptor {
  name: string
  description: string
  input?: { hint: string }
}

export interface RemoteCommandExecution {
  commandId: string
  result: { kind: 'success' | 'error'; text?: string }
}

export class DshRemoteClient {
  constructor(
    private readonly client: HarnessClient,
    public timeoutMs = 60_000,
  ) {}

  async listCommands(sessionId: string): Promise<RemoteCommandDescriptor[]> {
    const result = await this.client.call<{ ok: true; value: RemoteCommandDescriptor[] } | { ok: false; error: unknown }>(
      'commands/list',
      { args: { agentId: sessionId } },
      AbortSignal.timeout(this.timeoutMs),
    )
    if (!('value' in result) || !Array.isArray(result.value)) return []
    return result.value
  }

  async executeCommand(sessionId: string, line: string): Promise<RemoteCommandExecution | undefined> {
    const result = await this.client.call<
      { ok: true; value: { commandId: string } | undefined } | { ok: false; error: unknown }
    >(
      'commands/execute',
      { args: { agentId: sessionId, line } },
      AbortSignal.timeout(this.timeoutMs),
    )
    if (!('value' in result) || !result.value) return undefined
    return {
      commandId: result.value.commandId,
      result: { kind: 'success' },
    }
  }
}
