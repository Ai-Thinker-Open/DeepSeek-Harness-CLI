import fs from 'node:fs'
import path from 'node:path'
import type { ChatMessage, SessionMeta, TodoItem } from './types.ts'
import { dshHome } from './config.ts'

export interface SessionData {
  meta: SessionMeta
  messages: ChatMessage[]
  todos: TodoItem[]
  planMode: boolean
}

type LogEvent =
  | { type: 'session'; id: string; title: string; model: string; cwd: string; createdAt: number }
  | { type: 'message'; message: ChatMessage }
  | { type: 'result'; toolCallId: string; result: { ok: boolean; output: string } }
  | { type: 'todos'; todos: TodoItem[] }
  | { type: 'plan'; active: boolean }

function sessionsDir(): string {
  return path.join(dshHome(), 'sessions')
}

export function sessionPath(id: string): string {
  return path.join(sessionsDir(), `${id}.jsonl`)
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function createSession(model: string, cwd: string): { id: string; meta: SessionMeta } {
  fs.mkdirSync(sessionsDir(), { recursive: true })
  const id = newSessionId()
  const now = Date.now()
  const meta: SessionMeta = { id, title: 'New session', createdAt: now, updatedAt: now, messageCount: 0, model }
  fs.writeFileSync(sessionPath(id), JSON.stringify({ type: 'session', id, title: meta.title, model, cwd, createdAt: now }) + '\n')
  return { id, meta }
}

export function appendEvent(id: string, ev: LogEvent): void {
  try {
    fs.appendFileSync(sessionPath(id), JSON.stringify(ev) + '\n')
  } catch {
    /* session file missing — ignore */
  }
}

export function setSessionTitle(id: string, title: string): void {
  appendEvent(id, { type: 'session', id, title, model: '', cwd: '', createdAt: 0 })
}

export function replaySession(id: string): SessionData {
  const file = sessionPath(id)
  const messages: ChatMessage[] = []
  let meta: SessionMeta = {
    id,
    title: 'Session',
    createdAt: 0,
    updatedAt: 0,
    messageCount: 0,
    model: '',
  }
  let todos: TodoItem[] = []
  let planMode = false
  const results = new Map<string, { ok: boolean; output: string }>()
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      let ev: LogEvent
      try {
        ev = JSON.parse(line) as LogEvent
      } catch {
        continue
      }
      if (ev.type === 'session') {
        meta = { ...meta, title: ev.title || meta.title, model: ev.model || meta.model, createdAt: ev.createdAt || meta.createdAt }
      } else if (ev.type === 'message') {
        messages.push(ev.message)
        if (ev.message.role === 'assistant' && ev.message.toolCalls?.length) {
          // attach any results already seen (results logged after the message)
          for (const tc of ev.message.toolCalls) {
            const r = results.get(tc.id)
            if (r) ev.message.toolResults = [...(ev.message.toolResults ?? []), { toolCallId: tc.id, ...r }]
          }
        }
      } else if (ev.type === 'result') {
        results.set(ev.toolCallId, ev.result)
        // attach to the most recent assistant message that references this call
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (!m) break
          if (m.toolCalls?.some((c) => c.id === ev.toolCallId)) {
            m.toolResults = m.toolResults ?? []
            if (!m.toolResults.some((r) => r.toolCallId === ev.toolCallId)) {
              m.toolResults.push({ toolCallId: ev.toolCallId, ...ev.result })
            }
            break
          }
        }
      } else if (ev.type === 'todos') {
        todos = ev.todos
      } else if (ev.type === 'plan') {
        planMode = ev.active
      }
    }
  } catch {
    /* missing file */
  }
  meta.messageCount = messages.length
  meta.updatedAt = meta.updatedAt || Date.now()
  // restore streaming flag
  for (const m of messages) delete (m as { streaming?: boolean }).streaming
  return { meta, messages, todos, planMode }
}

/** Rebuild the history index by scanning session files. */
export function listSessions(): SessionMeta[] {
  const dir = sessionsDir()
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  const out: SessionMeta[] = []
  for (const f of files) {
    const id = f.slice(0, -'.jsonl'.length)
    try {
      const stat = fs.statSync(sessionPath(id))
      const lines = fs.readFileSync(sessionPath(id), 'utf8').split('\n').filter((l) => l.trim())
      let title = 'Session'
      let model = ''
      let createdAt = stat.birthtimeMs
      for (const line of lines) {
        const ev = JSON.parse(line) as { type?: string; title?: string; model?: string; createdAt?: number }
        if (ev.type === 'session') {
          if (ev.title) title = ev.title
          if (ev.model) model = ev.model
          if (ev.createdAt) createdAt = ev.createdAt
        }
      }
      out.push({
        id,
        title,
        createdAt,
        updatedAt: stat.mtimeMs,
        messageCount: lines.length,
        model,
      })
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt)
  return out
}

export function deriveTitle(messages: ChatMessage[]): string {
  for (const m of messages) {
    if (m.role === 'user' && m.content.trim()) {
      return m.content.trim().split('\n')[0]!.slice(0, 48)
    }
  }
  return 'New session'
}
