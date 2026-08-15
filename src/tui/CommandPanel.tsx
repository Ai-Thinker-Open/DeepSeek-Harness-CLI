import React from 'react'
import { Box, Text } from 'ink'
import type { SessionMeta, TodoItem } from '../types.ts'
import { theme } from '../theme.ts'

export type PaletteMode = 'command' | 'sessions' | 'todos' | 'help'

export interface PaletteCommand {
  name: string
  desc: string
}

export const PALETTE_COMMANDS: PaletteCommand[] = [
  { name: 'sessions', desc: 'switch session' },
  { name: 'new', desc: 'start a new session' },
  { name: 'todos', desc: 'view the todo list' },
  { name: 'plan', desc: 'toggle plan mode' },
  { name: 'models', desc: 'cycle the model' },
  { name: 'help', desc: 'show keybindings' },
  { name: 'exit', desc: 'quit dskharness' },
]

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/**
 * The `/` command overlay (opencode-style): a command palette that turns into
 * a session / todo picker once the command is chosen.
 */
export function CommandPanel({
  mode,
  query,
  selected,
  filteredCommands,
  sessions,
  todos,
  currentSessionId,
  planMode,
  model,
}: {
  mode: PaletteMode
  query: string
  selected: number
  filteredCommands: PaletteCommand[]
  sessions: SessionMeta[]
  todos: TodoItem[]
  currentSessionId: string
  planMode: boolean
  model: string
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} paddingY={0}>
      {mode === 'command' && (
        <Box flexDirection="column">
          {filteredCommands.length === 0 && <Text dimColor>no matching command</Text>}
          {filteredCommands.map((c, i) => {
            const active = i === selected
            return (
              <Text key={c.name} color={active ? '#000000' : undefined} backgroundColor={active ? theme.primary : undefined}>
                {active ? '› ' : '  '}/{c.name} <Text dimColor>— {c.desc}</Text>
              </Text>
            )
          })}
          <Text dimColor>
            ↑↓ choose · ⏎ run · Esc close
          </Text>
        </Box>
      )}
      {mode === 'sessions' && (
        <Box flexDirection="column">
          <Text bold color={theme.primary}>
            /sessions
          </Text>
          {sessions.length === 0 && <Text dimColor>no sessions yet</Text>}
          {sessions.slice(0, 20).map((s, i) => {
            const active = i === selected
            const current = s.id === currentSessionId
            return (
              <Text key={s.id} color={active ? '#000000' : current ? theme.primary : undefined} backgroundColor={active ? theme.primary : undefined}>
                {active ? '› ' : current ? '● ' : '  '}
                {s.title} <Text dimColor>{timeAgo(s.updatedAt)}</Text>
              </Text>
            )
          })}
          {sessions.length > 20 && (
            <Text dimColor>
              … {sessions.length - 20} more
            </Text>
          )}
        </Box>
      )}
      {mode === 'todos' && (
        <Box flexDirection="column">
          <Text bold color={theme.primary}>
            /todos
          </Text>
          {todos.length === 0 && <Text dimColor>no todos — ask the agent to plan work</Text>}
          {todos.map((t, i) => {
            const active = i === selected
            const icon = t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '→' : '☐'
            const color = t.status === 'completed' ? 'green' : t.status === 'in_progress' ? theme.warn : 'gray'
            return (
              <Text key={t.id} color={active ? '#000000' : color} backgroundColor={active ? theme.primary : undefined}>
                {active ? '› ' : '  '}
                {icon} {t.content}
              </Text>
            )
          })}
        </Box>
      )}
      {mode === 'help' && (
        <Box flexDirection="column">
          <Text bold color={theme.primary}>
            keybindings
          </Text>
          <Text>⏎ send · Ctrl+C stop agent / quit when idle</Text>
          <Text>/ commands: sessions · new · todos · plan · models · help · exit</Text>
          <Text>Ctrl+N new session · Ctrl+E plan mode · Ctrl+M model</Text>
          <Text>↑↓ input history · PageUp/Down scroll · Esc clear / close</Text>
        </Box>
      )}
      <Text dimColor>
        {query} · plan {planMode ? 'on' : 'off'} · {model}
      </Text>
    </Box>
  )
}
