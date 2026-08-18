/**
 * Wire client for a running DeepSeek Harness web instance.
 *
 * Implements the DSH `/api` client contract:
 * - unary RPC: POST /api/<method> with a `client-request` envelope, answered
 *   by a `server-response` envelope `{ result: { ok, value | error } }`;
 * - downlink: /api/events.mux as a WebSocket stream of `server-request`
 *   envelopes (session events, questions, host status);
 * - responses to pending questions: POST /api/respond.
 */

export interface RpcResult<T = unknown> {
  ok: boolean
  value?: T
  error?: { code?: string; message?: string; details?: unknown }
}

export interface ServerResponse<T = unknown> {
  type: "server-response"
  rpcId: string
  result: RpcResult<T>
}

export interface ServerRequest<T = unknown> {
  type: "server-request"
  rpcId: string
  method: string
  payload: T
}

export interface HostDescribe {
  version: string
  cwd: string
  provider?: string
  model?: string
  attachedSessions: number
  canOpenPath: boolean
}

export interface SessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  agentPreset?: string
  projections?: Record<string, unknown>
}

/** Immutable command view returned by `command.list` (no leading slash). */
export interface CommandDescriptor {
  name: string
  description: string
  input?: { hint: string }
}

/** Settled command execution returned by `command.execute`. */
export interface CommandExecutionResult {
  commandId: string
  result: { kind: "success" | "error"; text?: string; sourceEventSeq?: number }
}

export interface SessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  sourceEventSeqs?: number[]
  surfaceOp?: unknown
  ignorable?: boolean
}

export interface HistoryEntry {
  event: SessionEvent
  view?: { for: "call" | "result"; view: { card?: string } }
}

/** One transient queued/steering message from the `session/queue` snapshot. */
export interface QueueItem {
  id: string
  messageId: string
  placement: "queued" | "steering" | "context"
  text: string | null
  preview: string
}

/** One mutation accepted by the session queue verb. */
export type QueueAction =
  | { kind: "edit"; content: Array<{ type: "text"; text: string }> }
  | { kind: "remove" }
  | { kind: "steer" }

export interface QuestionItem {
  id: string
  question: string
  header?: string
  detail?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
  intent?: { kind: "plan-review"; approve: string }
}

/** The subset of HarnessClient the session driver depends on (test seam). */
export interface HarnessClientLike {
  describe(): Promise<HostDescribe>
  createSession(cwd?: string): Promise<{ sessionId: string; agentPreset?: string }>
  prompt(sessionId: string, text: string, mode?: "queue" | "steer"): Promise<{ accepted: boolean }>
  cancel(sessionId: string): Promise<{ accepted: boolean }>
  respond(rpcIdToAnswer: string, sessionId: string, answers: Array<{ id: string; selected: string[] }>): Promise<void>
  history(sessionId: string, maxMessages?: number): Promise<{ events: HistoryEntry[]; hasMore: boolean; projections?: Record<string, unknown> }>
  listSessions(): Promise<{ items: SessionSummary[] }>
  commandList(sessionId: string): Promise<CommandDescriptor[]>
  commandExecute(sessionId: string, line: string): Promise<CommandExecutionResult | undefined>
  updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<{ accepted: boolean }>
  eventStream(signal?: AbortSignal): AsyncGenerator<ServerRequest>
}

function rpcId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export class HarnessError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export const DEFAULT_HARNESS_URL = "http://127.0.0.1:3080"

export class HarnessClient implements HarnessClientLike {
  constructor(
    readonly baseUrl: string,
    public timeoutMs = 60_000,
  ) {}

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") {
        throw new HarnessError(`harness request timed out after ${this.timeoutMs}ms`, "timeout")
      }
      throw new HarnessError(`harness unreachable: ${(e as Error).message}`, "network")
    }
    if (res.status === 404) {
      throw new HarnessError(`harness endpoint ${path} not found — is this a DSH web instance?`, "not-found")
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new HarnessError(`harness HTTP ${res.status}: ${text.slice(0, 300)}`, "http")
    }
    return (await res.json()) as T
  }

  /** Unary RPC: POST /api/<method>, returns the business value (throws on ok:false). */
  async call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const resp = await this.post<ServerResponse<T>>(
      `/api/${method}`,
      {
        type: "client-request",
        rpcId: rpcId(),
        method,
        payload,
      },
      signal,
    )
    if (!resp.result?.ok) {
      const err = resp.result?.error
      throw new HarnessError(err?.message ?? `harness ${method} failed`, err?.code)
    }
    return resp.result.value as T
  }

  /** Answer a pending question (permission / ask_user / plan review). */
  async respond(rpcIdToAnswer: string, sessionId: string, answers: Array<{ id: string; selected: string[] }>): Promise<void> {
    await this.post("/api/respond", {
      type: "client-response",
      rpcId: rpcIdToAnswer,
      result: { ok: true, value: { sessionId, answer: { answers } } },
    })
  }

  describe(): Promise<HostDescribe> {
    return this.call<HostDescribe>("host.describe", {})
  }

  listSessions(): Promise<{ items: SessionSummary[] }> {
    return this.call("session.list", {})
  }

  createSession(cwd?: string, agentPreset?: string): Promise<{ sessionId: string; agentPreset?: string }> {
    return this.call("session.create", {
      ...(cwd ? { cwd } : {}),
      ...(agentPreset ? { agentPreset } : {}),
    })
  }

  prompt(sessionId: string, text: string, mode: "queue" | "steer" = "queue"): Promise<{ accepted: boolean }> {
    return this.call("session.prompt", {
      sessionId,
      mode,
      content: [{ type: "text", text }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  }

  cancel(sessionId: string): Promise<{ accepted: boolean }> {
    return this.call("session.cancel", { sessionId })
  }

  history(sessionId: string, maxMessages?: number): Promise<{
    events: HistoryEntry[]
    hasMore: boolean
    projections?: Record<string, unknown>
  }> {
    return this.call("session.history", { sessionId, ...(maxMessages ? { maxMessages } : {}) })
  }

  /** Discover the effective slash commands for a session's agent. */
  async commandList(sessionId: string): Promise<CommandDescriptor[]> {
    try {
      // The commands service is a Typert Remote (`commands/list`): the
      // gateway resolves the agent from `args.agentId`.
      return await this.call<CommandDescriptor[]>("commands/list", { args: { agentId: sessionId } })
    } catch (e) {
      if (e instanceof HarnessError && e.code === "not-found") {
        return this.call<CommandDescriptor[]>("commands.list", { agentId: sessionId })
      }
      throw e
    }
  }

  /**
   * Execute a slash-command line against the session's agent. Returns the
   * settled execution, or undefined when the line does not resolve.
   */
  async commandExecute(sessionId: string, line: string): Promise<CommandExecutionResult | undefined> {
    try {
      return await this.call<CommandExecutionResult | undefined>("commands/execute", {
        args: { agentId: sessionId, line },
      })
    } catch (e) {
      if (e instanceof HarnessError && e.code === "not-found") {
        return this.call<CommandExecutionResult | undefined>("commands.execute", { agentId: sessionId, line })
      }
      throw e
    }
  }

  /** Apply an edit/remove/steer operation to a pending queue occurrence. */
  async updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<{ accepted: boolean }> {
    try {
      return await this.call<{ accepted: boolean }>("session.updateQueue", { sessionId, itemId, action })
    } catch (e) {
      if (e instanceof HarnessError && e.code === "not-found") {
        return this.call<{ accepted: boolean }>("sessions.updateQueue", { sessionId, itemId, action })
      }
      throw e
    }
  }

  /**
   * Open the mux event stream (WebSocket downlink). Yields decoded
   * `server-request` envelopes until the socket closes or the signal aborts.
   */
  async *eventStream(signal?: AbortSignal): AsyncGenerator<ServerRequest> {
    const wsUrl = `${this.baseUrl.replace(/^http/, "ws").replace(/\/$/, "")}/api/events.mux`
    const ws = new WebSocket(wsUrl)
    const queue: ServerRequest[] = []
    const waiters: Array<(r: IteratorResult<ServerRequest>) => void> = []
    let closed = false
    let socketError: Error | null = null

    const drain = () => {
      while (waiters.length) {
        const w = waiters.shift() as (r: IteratorResult<ServerRequest>) => void
        w({ value: undefined, done: true })
      }
    }
    ws.onmessage = (e) => {
      try {
        const raw = JSON.parse(String(e.data)) as Record<string, unknown>
        const frame = raw as unknown as ServerRequest
        if (raw.type === "server-request" && typeof raw.method === "string") {
          if (waiters.length) (waiters.shift() as (r: IteratorResult<ServerRequest>) => void)({ value: frame, done: false })
          else queue.push(frame)
        } else if (raw.type === "session/queue") {
          // The queue snapshot is its own mux frame; normalize it into the
          // server-request envelope the driver consumes.
          const normalized: ServerRequest = {
            type: "server-request",
            rpcId: "",
            method: "session/queue",
            payload: raw,
          }
          if (waiters.length) (waiters.shift() as (r: IteratorResult<ServerRequest>) => void)({ value: normalized, done: false })
          else queue.push(normalized)
        }
      } catch {
        /* skip malformed frame */
      }
    }
    ws.onerror = () => {
      socketError = new HarnessError("events.mux socket error", "socket")
      drain()
    }
    ws.onclose = () => {
      closed = true
      drain()
    }
    const onAbort = () => {
      try {
        ws.close()
      } catch {
        /* noop */
      }
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    try {
      while (!closed || queue.length) {
        if (queue.length) yield queue.shift() as ServerRequest
        else if (socketError) throw socketError
        else if (closed) break
        else {
          const result = await new Promise<IteratorResult<ServerRequest>>((resolve) => waiters.push(resolve))
          if (result.done) break
          yield result.value
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort)
      try {
        ws.close()
      } catch {
        /* noop */
      }
    }
  }
}
