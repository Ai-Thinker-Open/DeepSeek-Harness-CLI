import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import type { ToolDef } from './tools/types.ts'

/**
 * Minimal stdio MCP client (mirrors dsh-mcp-client).
 * JSON-RPC 2.0 over stdio; exposes initialize / tools/list / tools/call.
 */
export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class McpClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private rl: readline.Interface | null = null
  private pending = new Map<number | string, Pending>()
  private nextId = 1
  private tools: McpToolInfo[] = []
  private closed = false

  constructor(private name: string, private cfg: McpServerConfig) {}

  get serverName(): string {
    return this.name
  }

  async start(): Promise<void> {
    const child = spawn(this.cfg.command, this.cfg.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.cfg.env ?? {}), NO_COLOR: '1' },
      shell: false,
    })
    this.child = child
    this.rl = readline.createInterface({ input: child.stdout })
    this.rl.on('line', (line) => {
      if (!line.trim()) return
      let msg: { id?: number | string; result?: unknown; error?: { message?: string }; method?: string }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.method) return // server notification — ignore
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error) p.reject(new Error(msg.error.message ?? 'MCP error'))
        else p.resolve(msg.result)
      }
    })
    child.stderr.on('data', () => {
      /* diagnostics; ignored */
    })
    child.on('exit', () => {
      if (!this.closed) {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(new Error(`MCP server ${this.name} exited`))
        }
        this.pending.clear()
      }
    })

    const init = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dsh-cli', version: '0.1.0' },
    })
    const proto = (init as { protocolVersion?: string })?.protocolVersion ?? '2024-11-05'
    this.notify('notifications/initialized', {})
    const listed = (await this.request('tools/list', {})) as { tools?: McpToolInfo[] }
    this.tools = listed.tools ?? []
    void proto
  }

  private request(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private write(msg: unknown): void {
    if (!this.child || !this.child.stdin.writable) throw new Error(`MCP server ${this.name} is not running`)
    this.child.stdin.write(JSON.stringify(msg) + '\n')
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request('tools/call', { name, arguments: args }, 120_000)) as {
      content?: Array<{ type?: string; text?: string }>
      isError?: boolean
    }
    const text = (result.content ?? [])
      .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
      .join('\n')
    if (result.isError) return `[MCP ${name} error]\n${text}`
    return text
  }

  toToolDefs(): ToolDef[] {
    return this.tools.map((t) => ({
      name: `mcp__${this.name}__${t.name}`,
      description: `[MCP server: ${this.name}] ${t.description ?? t.name}`,
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
      permission: t.annotations?.readOnlyHint ? 'auto' : 'ask',
      planSafe: !!t.annotations?.readOnlyHint,
      summary: (a) => `${this.name}:${t.name} ${Object.keys(a).join(',')}`,
      execute: async (args) => this.callTool(t.name, args as Record<string, unknown>),
    }))
  }

  close(): void {
    this.closed = true
    try {
      this.child?.kill()
    } catch {
      /* noop */
    }
    this.rl?.close()
  }
}
