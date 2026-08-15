export interface OpenCodeSession {
  id: string
  slug: string
  projectID: string
  workspaceID?: string
  directory: string
  parentID?: string
  contextFrom?: string
  contextWatermark?: string
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: unknown[]
  }
  share?: { url: string }
  title: string
  version: string
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
  permission?: Array<{ permission: string; pattern: string; action: 'allow' | 'deny' | 'ask' }>
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
  project?: {
    id: string
    name?: string
    worktree: string
  } | null
}

export interface OpenCodeTextPart {
  id: string
  sessionID: string
  messageID: string
  type: 'text'
  text: string
  synthetic?: boolean
  ignored?: boolean
}

export interface OpenCodeReasoningPart {
  id: string
  sessionID: string
  messageID: string
  type: 'reasoning'
  text: string
  time?: { start: number; end?: number }
}

export type OpenCodeToolState =
  | {
      status: 'pending'
      input: unknown
      raw: string
    }
  | {
      status: 'running'
      input: unknown
      title?: string
      metadata?: Record<string, unknown>
      time: { start: number }
    }
  | {
      status: 'completed'
      input: unknown
      output: string
      providerOutput?: unknown
      providerMetadata?: Record<string, unknown>
      title: string
      metadata: Record<string, unknown>
      time: { start: number; end: number; compacted?: number }
    }
  | {
      status: 'error'
      input: unknown
      error: string
      metadata?: Record<string, unknown>
      time: { start: number; end: number }
    }

export interface OpenCodeToolPart {
  id: string
  sessionID: string
  messageID: string
  type: 'tool'
  callID: string
  tool: string
  state: OpenCodeToolState
  metadata?: Record<string, unknown>
}

export type OpenCodePart = OpenCodeTextPart | OpenCodeReasoningPart | OpenCodeToolPart

export interface OpenCodeUserMessage {
  id: string
  sessionID: string
  agentID?: string
  role: 'user'
  time: { created: number }
  agent: string
  model: { providerID: string; modelID: string }
}

export interface OpenCodeAssistantMessage {
  id: string
  sessionID: string
  agentID?: string
  role: 'assistant'
  time: { created: number; completed?: number }
  error?: unknown
  parentID: string
  modelID: string
  providerID: string
  mode: string
  agent: string
  path: { cwd: string; root: string }
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export type OpenCodeMessage = OpenCodeUserMessage | OpenCodeAssistantMessage

export interface OpenCodeTodo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export interface OpenCodeCommand {
  name: string
  description: string
  input?: { hint: string }
}

export interface OpenCodePermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: { messageID: string; callID: string }
}

export interface OpenCodeQuestionOption {
  label: string
  description: string
}

export interface OpenCodeQuestionInfo {
  id: string
  question: string
  header: string
  options: OpenCodeQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface OpenCodeQuestionRequest {
  id: string
  sessionID: string
  questions: OpenCodeQuestionInfo[]
  tool?: { messageID: string; callID: string }
}

export type OpenCodeGlobalEvent = {
  directory: string
  project?: string
  workspace?: string
  payload:
    | { type: 'server.connected'; properties: Record<string, never> }
    | { type: 'server.heartbeat'; properties: Record<string, never> }
    | { type: 'session.updated'; properties: { sessionID: string; info: OpenCodeSession } }
    | { type: 'message.updated'; properties: { sessionID: string; info: OpenCodeMessage } }
    | { type: 'message.part.updated'; properties: { sessionID: string; part: OpenCodePart; time: number } }
    | { type: 'todo.updated'; properties: { sessionID: string; todos: OpenCodeTodo[] } }
    | { type: 'session.status'; properties: { sessionID: string; status: { type: 'busy' | 'idle'; message?: string } } }
    | { type: 'session.idle'; properties: { sessionID: string } }
    | { type: 'permission.asked'; properties: OpenCodePermissionRequest }
    | { type: 'permission.replied'; properties: { sessionID: string; requestID: string; reply: 'once' | 'always' | 'reject' } }
    | { type: 'question.asked'; properties: OpenCodeQuestionRequest }
    | { type: 'question.replied'; properties: { sessionID: string; requestID: string; answers: string[][] } }
    | { type: 'question.rejected'; properties: { sessionID: string; requestID: string } }
    | { type: 'session.goal'; properties: { sessionID: string; goal?: { condition: string } } }
    | { type: 'session.compacted'; properties: { sessionID: string; agentID?: string } }
}
