export interface OpenCodeSession {
  id: string
  parentID?: string
  title: string
  directory: string
  time: { created: number; updated: number }
}

export interface OpenCodeTextPart {
  id: string
  sessionID: string
  messageID: string
  type: 'text'
  text: string
  synthetic?: boolean
}

export interface OpenCodeReasoningPart {
  id: string
  sessionID: string
  messageID: string
  type: 'reasoning'
  text: string
}

export interface OpenCodeToolPart {
  id: string
  sessionID: string
  messageID: string
  type: 'tool'
  tool: string
  state: {
    status: 'running' | 'completed' | 'error'
    input: unknown
    output?: string
  }
}

export type OpenCodePart = OpenCodeTextPart | OpenCodeReasoningPart | OpenCodeToolPart

export interface OpenCodeUserMessage {
  id: string
  sessionID: string
  role: 'user'
  time: { created: number }
}

export interface OpenCodeAssistantMessage {
  id: string
  sessionID: string
  role: 'assistant'
  time: { created: number }
  error?: unknown
}

export type OpenCodeMessage = OpenCodeUserMessage | OpenCodeAssistantMessage

export interface OpenCodeTodo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface OpenCodeCommand {
  name: string
  description: string
  input?: { hint: string }
}

export type OpenCodeQuestionKind = 'question' | 'permission' | 'plan-approval'

export interface OpenCodeQuestion {
  id: string
  sessionID: string
  kind: OpenCodeQuestionKind
  title: string
  body?: string
  options: string[]
}
