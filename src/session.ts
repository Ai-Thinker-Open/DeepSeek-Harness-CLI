export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
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
  /** True while the assistant message is still streaming. */
  streaming?: boolean
  /** Error state. */
  error?: string
  createdAt: number
}

export type ToolCallStatus = "running" | "ok" | "error" | "denied"

export interface ToolCallRecord {
  id: string
  name: string
  args: unknown
  /** Human one-liner for the tool card (e.g. the command for bash). */
  summary?: string
  status: ToolCallStatus
  startedAt?: number
  finishedAt?: number
}

export interface ToolResultRecord {
  toolCallId: string
  ok: boolean
  /** Short display of the result (truncated for the TUI). */
  output: string
  /** True when `output` was truncated at fold time. */
  truncated?: boolean
  error?: string
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

/** A question raised by the harness (permission / ask_user / plan review). */
export interface HarnessQuestion {
  rpcId: string
  id: string
  title: string
  detail?: string
  options: string[]
  kind: "permission" | "ask-user" | "plan-approval"
}
