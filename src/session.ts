export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  /** Image attachments carried by a user message (base64 data when loaded). */
  images?: ChatImage[]
  /** Harness turn this message belongs to (assistant messages). */
  turn?: number
  /** Streaming reasoning content (deepseek-reasoner), shown in a thinking block. */
  thinking?: string
  /**
   * Set for injected context echoes (`user/message` with a non-user source):
   * the producer's plugin name, the declared context form, and the one-line
   * summary carried by `notice`-form injections. Rendered as a folded
   * "上下文注入" block instead of a plain user bubble.
   */
  inject?: {
    source: string
    form?: string
    summary?: string
  }
  /** Tool calls issued by the assistant in this message (ordered). */
  toolCalls?: ToolCallRecord[]
  /** Tool result rows attached to this assistant message. */
  toolResults?: ToolResultRecord[]
  /** Slash-command lifecycle attached to a user-role command message. */
  command?: CommandRecord
  /** True while the assistant message is still streaming. */
  streaming?: boolean
  /** Error state. */
  error?: string
  createdAt: number
}

/** One image in a user message: inline wire data or a durable attachment ref. */
export interface ChatImage {
  attachmentId?: string
  mediaType: string
  /** Canonical base64 payload (no `data:` prefix); absent until fetched. */
  data?: string
  name?: string
  bytes?: number
  width?: number
  height?: number
  /** True when `session.attachment` failed to resolve this image. */
  error?: boolean
}

/** Status shown while the harness is deep-diving (reasoning) over a turn. */
export const DEEP_DIVING_STATUS = "Deep diving"

export type ToolCallStatus = "running" | "ok" | "error" | "denied"

export type CommandStatus = "running" | "ok" | "error"

/** Folded `command/run` + `command/done` lifecycle for one slash command. */
export interface CommandRecord {
  commandId: string
  name: string
  args?: string
  status: CommandStatus
  resultText?: string
}

export interface ToolCallRecord {
  id: string
  name: string
  args: unknown
  /** Human one-liner for the tool card (e.g. the command for bash). */
  summary?: string
  status: ToolCallStatus
  startedAt?: number
  finishedAt?: number
  /** Model step this call belongs to (tool-call-delta indices reset per step). */
  step?: number | null
  /** Stream index within its step, used to fold deltas without collisions. */
  index?: number | null
}

export interface ToolResultRecord {
  toolCallId: string
  ok: boolean
  /** Short display of the result (truncated for the TUI). */
  output: string
  /** True when `output` was truncated at fold time. */
  truncated?: boolean
  error?: string
  /**
   * The harness's private presentation payload (`tool/result` `meta`): the
   * structured card material (diff hunks, read lines, terminal output) the web
   * client renders through its card models.
   */
  meta?: unknown
}

/** Aggregated session statistics shown in the stats bar. */
export interface SessionStats {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  inTokens: number
  outTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  /** Average time from step start to first output token, in ms. */
  firstTokenMs: number | null
  /** Running sum/count behind `firstTokenMs` (kept in the driver). */
  firstTokenSumMs: number
  firstTokenCount: number
}

export const EMPTY_STATS: SessionStats = {
  turns: 0,
  steps: 0,
  llmMs: 0,
  toolMs: 0,
  inTokens: 0,
  outTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  firstTokenMs: null,
  firstTokenSumMs: 0,
  firstTokenCount: 0,
}

/** One selectable permission request inside a permission question. */
export interface PermissionRequestItem {
  id: string
  /** Display text, e.g. `Bash(ls -la)` or the harness question text. */
  label: string
  /** Expanded detail (full command, file path, description). */
  detail?: string
  /** Whether the request is suggested/checked by default. */
  suggested?: boolean
  /** Original option labels so the answer preserves the harness contract. */
  options?: Array<{ label: string; description?: string }>
}

/** A pending sandbox-escalation approval (`approval/requested` frame). */
export interface ApprovalInfo {
  /** The harness approval request id (echoed back in the respond payload). */
  id: string
  toolName?: string
  callId?: string
}

/** A question raised by the harness (permission / ask_user / plan review). */
export interface HarnessQuestion {
  rpcId: string
  id: string
  title: string
  detail?: string
  options: string[]
  kind: "permission" | "ask-user" | "plan-approval"
  /** `kind === "permission"` questions carry one selectable request per row. */
  requests?: PermissionRequestItem[]
  /** Set when this pending prompt is a sandbox-escalation approval. */
  approval?: ApprovalInfo
}
