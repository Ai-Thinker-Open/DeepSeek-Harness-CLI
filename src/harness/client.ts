/**
 * Wire client for a running DeepSeek Harness web instance.
 *
 * Implements the DSH `/api` client contract:
 * - unary RPC: POST /api/<method> with a `client-request` envelope, answered
 *   by a `server-response` envelope `{ result: { ok, value | error } }`;
 * - downlink: /api/remote.mux as a multiplexed Remote-stream WebSocket
 *   envelopes (session events, questions, host status);
 * - responses to pending questions: POST /api/respond.
 */

import WebSocket from "ws"
import { debug } from "../debug"

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
  /** First user message text of the conversation, when it can be read. */
  preview?: string
}

/** One entry of `credentials.describe`: configured/source/writable, no value. */
export interface CredentialView {
  configured: boolean
  source?: string
  writable: boolean
}

/** One selectable model advertised by a provider group. */
export interface ModelEntry {
  id: string
  name: string
  description?: string
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

/** One provider group in the model catalog. */
export interface ModelGroup {
  id: string
  name: string
  models: ModelEntry[]
}

/** The model directory returned by `session.models`. */
export interface ModelCatalog {
  current: { provider: string; model: string; reasoningEffort?: string }
  routable: boolean
  groups: ModelGroup[]
  failures: Array<{ id: string; name: string; message: string }>
}

/** One user-invocable skill from the session's skill catalog. */
export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

/** One `session.search` hit: a session id and a bounded text snippet. */
export interface SessionSearchItem {
  sessionId: string
  snippet: string
}

/** `session.search` response: up to 20 hits plus a has-more flag. */
export interface SessionSearchResult {
  items: SessionSearchItem[]
  hasMore: boolean
  /** Present when the search failed (e.g. the index is disabled) rather than
   *  matching nothing; the UI shows it as a distinct error. */
  error?: string
}

/** A fetched session-log export archive (the GET /api/session.export body). */
export interface SessionExportResult {
  data: Uint8Array
  filename: string
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
  /** Canonical prompt text used to match a locally-appended optimistic copy. */
  signature?: string
  /** Wire content blocks (text + image) for re-delivery after a cancel. */
  contentBlocks?: PromptContentPart[]
}

/** Raster image media types accepted by the harness browser wire. */
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif"

/** One image part in a prompt content list (`data` is canonical base64). */
export interface ImageContentPart {
  type: "image"
  mediaType: ImageMediaType
  data: string
  name?: string
}

/** One item of a session prompt content list. */
export type PromptContentPart = { type: "text"; text: string } | ImageContentPart

/** Image wire shape for `commands/execute` (same as an image block minus type). */
export interface ImageCommandImage {
  mediaType: ImageMediaType
  data: string
  name?: string
}

/** Durable image reference used by history events (`session.attachment`). */
export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

/** Client-side mirror of the harness `imageLimits` projection. */
export interface ImageLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  maxImageDimension: number
  mediaTypes: ImageMediaType[]
}

/** Defaults matching `dsh-client-connection`'s projection (used when the
 *  harness does not report `imageLimits`). */
export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxImageBytes: 5 * 1024 * 1024,
  maxImagesPerMessage: 20,
  maxMessageImageBytes: 100 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxImageDimension: 2000,
  mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
}

/** Parse the harness `imageLimits` projection (tolerant of shape drift). */
export function parseImageLimits(projections: Record<string, unknown> | undefined): ImageLimits {
  const values = (projections?.values ?? projections) as Record<string, unknown> | undefined
  const raw = values?.["imageLimits"] as Partial<ImageLimits> | undefined
  if (!raw || typeof raw !== "object") return DEFAULT_IMAGE_LIMITS
  const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback)
  const media = Array.isArray(raw.mediaTypes)
    ? (raw.mediaTypes as string[]).filter((m): m is ImageMediaType =>
        m === "image/png" || m === "image/jpeg" || m === "image/webp" || m === "image/gif",
      )
    : DEFAULT_IMAGE_LIMITS.mediaTypes
  return {
    maxImageBytes: num(raw.maxImageBytes, DEFAULT_IMAGE_LIMITS.maxImageBytes),
    maxImagesPerMessage: num(raw.maxImagesPerMessage, DEFAULT_IMAGE_LIMITS.maxImagesPerMessage),
    maxMessageImageBytes: num(raw.maxMessageImageBytes, DEFAULT_IMAGE_LIMITS.maxMessageImageBytes),
    maxImagePixels: num(raw.maxImagePixels, DEFAULT_IMAGE_LIMITS.maxImagePixels),
    maxImageDimension: num(raw.maxImageDimension, DEFAULT_IMAGE_LIMITS.maxImageDimension),
    mediaTypes: media.length > 0 ? media : DEFAULT_IMAGE_LIMITS.mediaTypes,
  }
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
/** One settings namespace view returned by settings.describe. */
export interface SettingsNamespaceView {
  ns: string
  schema: unknown
  value: unknown
  base?: unknown
  user?: unknown
  applies: "live" | "restart"
  secrets: Array<{ path: string[]; set: boolean }>
  revision: number
}

/** settings.describe response. */
export interface SettingsDescribeResult {
  writable: boolean
  hasDocument: boolean
  namespaces: SettingsNamespaceView[]
}

/** settings.update response (redacted namespace view). */
export type SettingsUpdateResult = SettingsNamespaceView

export interface HarnessClientLike {
  describe(): Promise<HostDescribe>
  createSession(cwd?: string, agentPreset?: string, sessionId?: string): Promise<{ sessionId: string; agentPreset?: string }>
  prompt(sessionId: string, content: PromptContentPart[], mode?: "queue" | "steer"): Promise<{ accepted: boolean }>
  cancel(sessionId: string): Promise<{ accepted: boolean }>
  respond(rpcIdToAnswer: string, sessionId: string, answers: Array<{ id: string; selected: string[] }>): Promise<void>
  respondApproval(rpcIdToAnswer: string, sessionId: string, approvalId: string, outcome: "allowed-once" | "rejected"): Promise<void>
  history(sessionId: string, maxMessages?: number): Promise<{ events: HistoryEntry[]; hasMore: boolean; projections?: Record<string, unknown> }>
  listSessions(): Promise<{ items: SessionSummary[] }>
  searchSessions(query: string): Promise<SessionSearchResult>
  /** Fetch a session-log export archive (GET /api/session.export). */
  exportSession(sessionId: string, options?: { includeDescendants?: boolean; signal?: AbortSignal }): Promise<SessionExportResult>
  commandList(sessionId: string): Promise<CommandDescriptor[]>
  commandExecute(sessionId: string, line: string, images?: ImageCommandImage[]): Promise<CommandExecutionResult | undefined>
  listModels(sessionId: string): Promise<ModelCatalog>
  selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<{ selected: ModelCatalog["current"] }>
  renameSession(sessionId: string, title: string): Promise<{ title: string }>
  forkSession(sessionId: string): Promise<{ sessionId: string }>
  skillList(sessionId: string): Promise<{ skills: SkillEntry[] }>
  readAttachment(sessionId: string, attachmentId: string): Promise<{ attachment: ImageAttachmentRef; data: string }>
  updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<{ accepted: boolean }>
  credentialsDescribe(refs: string[]): Promise<Record<string, CredentialView>>
  credentialsSet(ref: string, value: string): Promise<void>
  settingsDescribe(): Promise<SettingsDescribeResult>
  settingsUpdate(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<SettingsUpdateResult>
  eventStream(signal?: AbortSignal, sessionId?: string | null): AsyncGenerator<ServerRequest>
}

function rpcId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Translate a legacy dot-notation RPC method ("session.list") into the
 * slash-notation endpoint ("session/list") the 0.1.x Typert gateway claims.
 * Calls that already use slash notation ("commands/list") pass through.
 */
function toEndpoint(method: string): string {
  return method.includes(".") ? method.replaceAll(".", "/") : method
}

/**
 * Build the wire `args` object for a unary RPC. dsh's Typert gateway expects
 * the request envelope to carry `payload.args`, keyed by the remote method's
 * parameter names:
 *  - single `request`-param controllers (session/skills) -> `{ request: payload }`
 *    (the payload IS the request object);
 *  - `session/list` -> `{ _request: payload }`;
 *  - no-arg reads (`session/modelCatalog`, `session/canOpenWorkspacePath`) -> `{}`;
 *  - named-param controllers (`credentials/set`, `settings/update`, ...) -> the
 *    payload fields are the wire args directly (`{ ref, value }`, `{ ns, patch }`).
 * Sending the bare payload caused `Remote payload must contain exactly one
 * plain-object args field` on every 0.1.2 call.
 */
function wrapArgs(endpoint: string, payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HarnessError(`RPC endpoint ${endpoint} requires an object payload`, "bad-args")
  }
  const p = payload as Record<string, unknown>
  if (endpoint === "session/list") return { _request: p }
  if (endpoint === "session/modelCatalog" || endpoint === "session/canOpenWorkspacePath") return {}
  if (endpoint.startsWith("session/") || endpoint.startsWith("skills/")) return { request: p }
  return p
}

export class HarnessError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export const DEFAULT_HARNESS_URL = "http://127.0.0.1:3081"

export class HarnessClient implements HarnessClientLike {
  constructor(
    readonly baseUrl: string,
    public timeoutMs = 60_000,
  ) {}

  private authCookie: string | null = null
  private authReady: Promise<string | null> | null = null
  /** `clientId` of the current `$events` mux stream generation (for answering
   *  forwarded Remote events via `$events/result`). */
  private eventsClientId: string | null = null

  /**
   * dsh >= 0.1.2-rc.1 guards the `/api` surface behind browser launch-token
   * auth: the launcher hands us a one-time `DSH_AUTH_URL` (a `/?token=` root).
   * GETting it mints a signed `dsh-auth-*` cookie, which every subsequent
   * `/api` request (RPC and the remote.mux socket) must carry. Older dsh sets
   * no such URL, so this resolves to null and the client stays unauthenticated.
   */
  private async ensureAuth(): Promise<string | null> {
    if (this.authCookie !== null) return this.authCookie
    if (this.authReady) return this.authReady
    this.authReady = (async () => {
      const authUrl = process.env.DSH_AUTH_URL
      if (!authUrl) return null
      try {
        const res = await fetch(authUrl, { method: "GET", redirect: "manual" })
        const first = (res.headers.get("set-cookie") ?? "").split(";")[0]?.trim()
        if (process.env.DSH_DEBUG === "1") {
          debug(`[dsh-cli] auth exchange GET ${authUrl} status=${res.status} set-cookie=${JSON.stringify(res.headers.get("set-cookie") ?? "")}`)
        }
        if (first && first.startsWith("dsh-auth-")) {
          this.authCookie = first
          return first
        }
        return null
      } catch (e) {
        if (process.env.DSH_DEBUG === "1") debug(`[dsh-cli] auth exchange failed: ${(e as Error).message}`)
        return null
      }
    })()
    return this.authReady
  }

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const cookie = await this.ensureAuth()
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (cookie) headers.cookie = cookie
    let res: Response
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(this.timeoutMs),
      })
      if (process.env.DSH_DEBUG === "1") {
        debug(`[dsh-cli] POST ${path} status=${res.status} cookie=${cookie ? "yes" : "no"}`)
      }
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
    const endpoint = toEndpoint(method)
    const resp = await this.post<ServerResponse<T>>(
      `/api/${endpoint}`,
      {
        type: "client-request",
        rpcId: rpcId(),
        method: endpoint,
        payload: { args: wrapArgs(endpoint, payload) },
      },
      signal,
    )
    if (!resp.result?.ok) {
      const err = resp.result?.error
      throw new HarnessError(err?.message ?? `harness ${endpoint} failed`, err?.code)
    }
    return resp.result.value as T
  }

  /** Answer a pending question (permission / ask_user / plan review). */
  async respond(rpcIdToAnswer: string, sessionId: string, answers: Array<{ id: string; selected: string[] }>): Promise<void> {
    const clientId = this.eventsClientId
    if (!clientId) throw new HarnessError("events stream is not open — cannot answer a question", "not-connected")
    await this.call("$events/result", {
      clientId,
      eventId: rpcIdToAnswer,
      outcome: { kind: "result", value: { answers } },
    })
  }

  /** Decide a pending sandbox-escalation approval (`approval/requested`). */
  async respondApproval(rpcIdToAnswer: string, sessionId: string, approvalId: string, outcome: "allowed-once" | "rejected"): Promise<void> {
    const clientId = this.eventsClientId
    if (!clientId) throw new HarnessError("events stream is not open — cannot decide an approval", "not-connected")
    await this.call("$events/result", {
      clientId,
      eventId: rpcIdToAnswer,
      outcome: { kind: "result", value: outcome },
    })
  }

  /** Host platform facts. dsh removed the `host.describe` remote in 0.1.2; this
   *  derives the model/path facts from the still-present namespace remotes and
   *  leaves `cwd` undefined so `harnessCwdFor` falls back to the client cwd. */
  async describe(): Promise<HostDescribe> {
    let model: string | undefined
    let canOpenPath = false
    try {
      const catalog = await this.call<ModelCatalog>("session/modelCatalog", {})
      model = catalog.current?.model
    } catch {
      // The model name is refreshed later by listModels(); not fatal here.
    }
    try {
      canOpenPath = (await this.call<boolean>("session/canOpenWorkspacePath", {})) === true
    } catch {
      // Path opening is a nice-to-have; default to false.
    }
    return { version: "", cwd: "", provider: undefined, model, attachedSessions: 0, canOpenPath }
  }

  listSessions(): Promise<{ items: SessionSummary[] }> {
    return this.call("session.list", {})
  }

  /** Full-text search across the workspace's sessions (requires the harness's
   *  session-query index; returns SESSION_QUERY_SEARCH_DISABLED when absent). */
  searchSessions(query: string): Promise<SessionSearchResult> {
    return this.call("session.search", { query })
  }

  /**
   * Fetch a session-log export archive. This is a plain GET endpoint (not the
   * /api/<method> RPC envelope), returning a zip of the session's raw log plus
   * its attachments and (optionally) subagent descendants.
   */
  async exportSession(
    sessionId: string,
    options: { includeDescendants?: boolean; signal?: AbortSignal } = {},
  ): Promise<SessionExportResult> {
    const params = new URLSearchParams({ sessionId })
    if (options.includeDescendants) params.set("includeDescendants", "true")
    let res: Response
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/session.export?${params}`, {
        method: "GET",
        // Exporting a large session compresses on the host; allow it to run
        // longer than the ordinary RPC timeout.
        signal: options.signal ?? AbortSignal.timeout(Math.max(this.timeoutMs, 120_000)),
      })
    } catch (e) {
      if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") {
        throw new HarnessError(`session.export timed out`, "timeout")
      }
      throw new HarnessError(`harness unreachable: ${(e as Error).message}`, "network")
    }
    if (!res.ok) {
      throw new HarnessError(`session.export HTTP ${res.status}`, "http")
    }
    const disposition = res.headers.get("content-disposition") ?? ""
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `dsh-session-${sessionId}.zip`
    const data = new Uint8Array(await res.arrayBuffer())
    return { data, filename }
  }

  createSession(cwd?: string, agentPreset?: string, sessionId?: string): Promise<{ sessionId: string; agentPreset?: string }> {
    return this.call("session.create", {
      ...(cwd ? { cwd } : {}),
      ...(agentPreset ? { agentPreset } : {}),
      ...(sessionId ? { sessionId } : {}),
    })
  }

  prompt(sessionId: string, content: PromptContentPart[], mode: "queue" | "steer" = "queue"): Promise<{ accepted: boolean }> {
    return this.call("session.prompt", {
      // The 0.1.2 SessionPromptRequest schema requires a requestId; the host
      // uses it as the source rpcId that the reply/event stream correlates to.
      requestId: rpcId(),
      sessionId,
      mode,
      content,
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  }

  /** Fetch a session-authorized historical image (base64 `data`). */
  readAttachment(sessionId: string, attachmentId: string): Promise<{ attachment: ImageAttachmentRef; data: string }> {
    return this.call("session.attachment", { sessionId, attachmentId })
  }

  cancel(sessionId: string): Promise<{ accepted: boolean }> {
    return this.call("session.cancel", { sessionId })
  }

  history(sessionId: string, maxMessages?: number): Promise<{
    events: HistoryEntry[]
    hasMore: boolean
    projections?: Record<string, unknown>
  }> {
    return this.call<{ records: Array<{ event: SessionEvent }>; hasMore: boolean }>("session/page", {
      address: { kind: "session", sessionId } as const,
      throughSeq: -1,
      ...(maxMessages ? { maxMessages } : {}),
    }).then((page) => ({
      events: page.records.map((record) => ({ event: record.event })),
      hasMore: page.hasMore,
    }))
  }

  listModels(sessionId: string): Promise<ModelCatalog> {
    return this.call<ModelCatalog>("session/modelCatalog", {})
  }

  selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<{ selected: ModelCatalog["current"] }> {
    return this.call("session.selectModel", {
      sessionId,
      provider,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    })
  }

  renameSession(sessionId: string, title: string): Promise<{ title: string }> {
    return this.call("session.rename", { sessionId, title })
  }

  forkSession(sessionId: string): Promise<{ sessionId: string }> {
    return this.call("session.fork", { sessionId })
  }

  skillList(sessionId: string): Promise<{ skills: SkillEntry[] }> {
    return this.call("skill.list", { sessionId })
  }

  credentialsDescribe(refs: string[]): Promise<Record<string, CredentialView>> {
    return this.call<Record<string, CredentialView>>("credentials.describe", { refs })
  }

  credentialsSet(ref: string, value: string): Promise<void> {
    return this.call("credentials.set", { ref, value }).then(() => undefined)
  }

  settingsDescribe(): Promise<SettingsDescribeResult> {
    return this.call("settings.describe", {})
  }

  settingsUpdate(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<SettingsUpdateResult> {
    return this.call("settings.update", {
      ns,
      patch,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    })
  }

  /** Discover the effective slash commands for a session's agent. */
  async commandList(sessionId: string): Promise<CommandDescriptor[]> {
    // The commands service is a Typert Remote (`commands/list`): the gateway
    // resolves the agent from the `agentId` wire field.
    return this.call<CommandDescriptor[]>("commands/list", { agentId: sessionId })
  }

  /**
   * Execute a slash-command line against the session's agent. Returns the
   * settled execution, or undefined when the line does not resolve.
   */
  async commandExecute(
    sessionId: string,
    line: string,
    images: ImageCommandImage[] = [],
  ): Promise<CommandExecutionResult | undefined> {
    // Newer harnesses require `images` (composer attachments, empty for a
    // plain invocation) alongside agentId/line.
    const args = { agentId: sessionId, line, images }
    return this.call<CommandExecutionResult | undefined>("commands/execute", args)
  }

  /** Apply an edit/remove/steer operation to a pending queue occurrence. */
  async updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<{ accepted: boolean }> {
    return this.call<{ accepted: boolean }>("session/updateQueue", { sessionId, itemId, action })
  }

  /**
   * Open the Remote-stream mux WebSocket downlink. 0.1.2 moved live events to
   * a multiplexed `/api/remote.mux` protocol: the client first sends
   * `{ type:"open", streamId, endpoint, payload }` for each logical stream
   * (`$events`, `session/follow`), then the server pushes
   * `{ type:"item", streamId, value }` frames. We translate `$events` and
   * `session/follow` items into the `server-request` envelopes the driver
   * consumes, and remember the `$events` `clientId` used to answer
   * user-questions / approvals via `$events/result`.
   */
  async *eventStream(signal?: AbortSignal, sessionId?: string | null): AsyncGenerator<ServerRequest> {
    const cookie = await this.ensureAuth()
    // In dsh 0.1.2 the Remote-stream mux WebSocket moved from the legacy
    // `/api/events.mux` to `/api/remote.mux`; connecting to the old path gets a
    // non-101 upgrade reply and the socket drops immediately.
    const wsUrl = `${this.baseUrl.replace(/^http/, "ws").replace(/\/$/, "")}/api/remote.mux`
    // Node's global WebSocket (undici) takes only (url, protocols) and silently
    // drops a `headers` option, so the launch-token cookie never reaches the
    // upgrade and the gateway answers 401. The `ws` package forwards the
    // `Cookie` on the handshake and auto-pongs the gateway heartbeat.
    const ws = new WebSocket(wsUrl, [], cookie ? { headers: { Cookie: cookie } } : undefined)
    const queue: ServerRequest[] = []
    const waiters: Array<(r: IteratorResult<ServerRequest>) => void> = []
    let closed = false
    let socketError: Error | null = null

    const EVENTS_STREAM = "s:events"
    const FOLLOW_STREAM = "s:follow"
    const openMessage = (streamId: string, endpoint: string, payload: unknown): string =>
      JSON.stringify({ type: "open", streamId, endpoint, payload })

    // dsh's Remote-stream mux is a text-protocol WebSocket; each `open` message
    // declares one logical stream. The server heartbeats with control-frame
    // pings, which the implementation answers automatically.
    ws.on("open", () => {
      try {
        ws.send(openMessage(EVENTS_STREAM, "$events", { args: {} }))
        if (sessionId) {
          ws.send(
            openMessage(FOLLOW_STREAM, "session/follow", {
              args: { request: { address: { kind: "session", sessionId } } },
            }),
          )
        }
      } catch {
        ws.close()
      }
    })

    if (process.env.DSH_DEBUG === "1") {
      debug(`[dsh-cli] WS ${wsUrl} opening cookie=${cookie ? "yes" : "no"} session=${sessionId ?? ""}`)
    }

    const push = (frame: ServerRequest): void => {
      if (waiters.length) (waiters.shift() as (r: IteratorResult<ServerRequest>) => void)({ value: frame, done: false })
      else queue.push(frame)
    }

    /** Translate one `$events` stream item into a driver `ServerRequest`. */
    const eventsFrame = (value: Record<string, unknown>): ServerRequest | null => {
      if (value.type === "ready") {
        this.eventsClientId = typeof value.clientId === "string" ? value.clientId : null
        return null
      }
      if (value.type === "emit") {
        const event = value.event as string
        const args = Array.isArray(value.args) ? value.args : []
        if (event === "api-session/status") {
          return { type: "server-request", rpcId: "", method: "host/session-status", payload: { sessionId: args[0], running: Boolean(args[1]) } }
        }
        if (event === "api-session/error") {
          return { type: "server-request", rpcId: "", method: "host/agent-error", payload: { sessionId: args[0], message: args[1] } }
        }
        if (event === "commands/change") {
          return { type: "server-request", rpcId: "", method: "host/remote-event", payload: { event: "commands/change" } }
        }
        return null
      }
      if (value.type === "waterfall") {
        const event = value.event as string
        const eventId = value.eventId as string
        const agentId = value.agentId as string
        const request = (value.request ?? {}) as Record<string, unknown>
        if (event === "user-questions/request") {
          return {
            type: "server-request",
            rpcId: eventId,
            method: "question/requested",
            payload: { sessionId: agentId, clientId: this.eventsClientId, eventId, questions: request.questions },
          }
        }
        if (event === "approval/request") {
          return {
            type: "server-request",
            rpcId: eventId,
            method: "approval/requested",
            payload: {
              sessionId: agentId,
              clientId: this.eventsClientId,
              eventId,
              approvalId: eventId,
              toolName: request.toolName,
              callId: request.callId,
              reason: request.reason,
            },
          }
        }
        return null
      }
      return null
    }

    /** Translate one `session/follow` stream item. */
    const followFrame = (value: Record<string, unknown>): ServerRequest | null => {
      // Snapshot is skipped: the initial transcript is seeded by history()/resync.
      if (value.type === "event" && value.event) {
        return { type: "server-request", rpcId: "", method: "session/event", payload: { sessionId, event: value.event } }
      }
      return null
    }

    const drain = () => {
      while (waiters.length) {
        const w = waiters.shift() as (r: IteratorResult<ServerRequest>) => void
        w({ value: undefined, done: true })
      }
    }
    ws.on("message", (data) => {
      try {
        const text = typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8")
        const raw = JSON.parse(text) as Record<string, unknown>
        if (raw.type === "item" && typeof raw.streamId === "string" && raw.value !== null && typeof raw.value === "object") {
          const value = raw.value as Record<string, unknown>
          const frame = raw.streamId === EVENTS_STREAM ? eventsFrame(value) : raw.streamId === FOLLOW_STREAM ? followFrame(value) : null
          if (frame) push(frame)
        }
      } catch {
        /* skip malformed frame */
      }
    })
    ws.on("error", (err) => {
      socketError = new HarnessError("remote.mux socket error", "socket")
      if (process.env.DSH_DEBUG === "1") debug(`[dsh-cli] WS error ${(err as Error).message}`)
      drain()
    })
    ws.on("close", (code, reason) => {
      closed = true
      if (process.env.DSH_DEBUG === "1") {
        debug(`[dsh-cli] WS closed code=${code} reason=${JSON.stringify(String(reason ?? ""))}`)
      }
      drain()
    })
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
