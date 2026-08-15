/**
 * Shared types for dskharness.
 *
 * The model-facing surface mirrors the DeepSeek Harness tool suite
 * (bash, fs, web, ask-user, todo, goal, jobs/subagent, workflow, skill,
 * plan mode) so prompts written for DSH behave the same here.
 */

export type Role = 'user' | 'assistant' | 'system' | 'tool'

/** A rendered message in the conversation (what the TUI and history show). */
export interface ChatMessage {
  id: string
  role: Role
  /** Markdown text of the message body (empty for pure tool-call turns). */
  content: string
  /** Streaming reasoning content (deepseek-reasoner), shown in a thinking block. */
  thinking?: string
  /** Tool calls issued by the assistant in this message (ordered). */
  toolCalls?: ToolCallRecord[]
  /** Tool result rows attached to this assistant message (ordered by toolCallId). */
  toolResults?: ToolResultRecord[]
  /** While streaming. */
  streaming?: boolean
  /** Error state. */
  error?: string
  createdAt: number
}

export interface ToolCallRecord {
  id: string
  name: string
  args: unknown
  /** Human one-liner used for the tool card (e.g. the command for bash). */
  summary?: string
  status: 'running' | 'ok' | 'error' | 'denied' | 'pending'
  startedAt?: number
  finishedAt?: number
}

export interface ToolResultRecord {
  toolCallId: string
  ok: boolean
  /** Short display of the result (truncated for the TUI). */
  output: string
  error?: string
}

/** OpenAI-compatible wire message for the chat completions API. */
export interface WireMessage {
  role: Role
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: WireToolCall[]
}

export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface WireToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** A persisted session in the history index. */
export interface SessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  model: string
}

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type AgentStatus =
  | 'idle'
  | 'thinking' // whale animation: waiting on the model / streaming reasoning
  | 'working' // executing tool calls
  | 'question' // ask_user / permission modal open
  | 'error'

/** Events the agent loop emits; the TUI subscribes to these. */
export type AgentEvent =
  | { type: 'status'; status: AgentStatus; detail?: string }
  | { type: 'message'; message: ChatMessage }
  | { type: 'message-update'; id: string; patch: Partial<ChatMessage> }
  | { type: 'thinking'; id: string; text: string }
  | { type: 'tool-call'; id: string; call: ToolCallRecord }
  | { type: 'tool-result'; id: string; result: ToolResultRecord }
  | { type: 'todos'; todos: TodoItem[] }
  | { type: 'plan-mode'; active: boolean }
  | { type: 'question'; question: Question }
  | { type: 'question-settled'; id: string }
  | { type: 'done'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'title'; title: string }
  | { type: 'usage'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }

/** A question surfaced to the user by ask_user / permission / plan approval. */
export interface Question {
  id: string
  kind: 'ask-user' | 'permission' | 'plan-approval' | 'confirm'
  title: string
  body?: string
  options: string[]
  /** Resolve the question with the chosen option. */
  resolve: (option: string) => void
  /** Reject without choosing (Esc). */
  cancel: () => void
}

export interface ToolContext {
  cwd: string
  sessionId: string
  emit: (event: AgentEvent) => void
  askUser: (q: Omit<Question, 'id' | 'resolve' | 'cancel'> & { kind: 'ask-user' | 'confirm' | 'plan-approval' }) => Promise<string>
  requestPermission: (toolName: string, summary: string, detail?: string) => Promise<'allow' | 'deny' | 'always'>
  planMode: () => boolean
  setPlanMode: (active: boolean) => void
  getTodos: () => TodoItem[]
  setTodos: (todos: TodoItem[]) => void
  getModel: () => string
  /** Spawn a subagent run; returns a job id. */
  spawnJob: (prompt: string, opts: { model?: string; cwd?: string }) => string
  waitJob: (jobId: string) => Promise<JobState>
  getJobOutput: (jobId: string) => JobState | undefined
  listJobs: () => JobState[]
  killJob: (jobId: string) => void
  abortController: AbortController
}

export interface JobState {
  id: string
  prompt: string
  status: 'running' | 'done' | 'error' | 'killed'
  result?: string
  error?: string
  startedAt: number
  finishedAt?: number
  model?: string
}

/**
 * The session-driving surface the TUI/headless consume. Implemented both by
 * the local `Agent` (standalone mode) and by `HarnessDriver` (connected to a
 * running DeepSeek Harness web instance).
 */
export interface SessionDriver {
  sessionId: string
  model: string
  planMode: boolean
  sendUser(text: string): Promise<void>
  abort(reason?: string): void
  togglePlanMode(): boolean
  setModel(model: string): void
  /** Cycle to the next available model (model-agnostic). */
  cycleModel(): void
  updateTodos(todos: TodoItem[]): void
  getLastAnswer(): string
  loadMessages(msgs: ChatMessage[]): void
  // ── slash-command support (each optional; the App falls back gracefully) ──
  renameSession?(title: string): Promise<void> | void
  /** Fork the session; returns the new session id (or undefined when unsupported). */
  forkSession?(): Promise<string | undefined> | string | undefined
  compactContext?(): Promise<string | void> | string | void
  goalText?(): Promise<string | void> | string | void
  sessionStatus?(): Promise<string> | string
  listTools?(): string
  listSkills?(): string
  listJobs?(): string
}
