import React from 'react'
import { Box, Text } from 'ink'
import type { SessionMeta, TodoItem } from '../types.ts'
import { theme } from '../theme.ts'

export type PaletteMode =
  | 'command'
  | 'sessions'
  | 'todos'
  | 'help'
  | 'tools'
  | 'skills'
  | 'jobs'
  | 'status'
  | 'models'

export interface PaletteCommand {
  name: string
  desc: string
  arg?: string
}

/** Commands grouped by purpose; the panel renders them under group headers. */
export const COMMAND_GROUPS: Array<{ group: string; commands: PaletteCommand[] }> = [
  {
    group: 'sessions',
    commands: [
      { name: 'sessions', desc: 'switch session' },
      { name: 'new', desc: 'start a new session' },
      { name: 'rename', desc: 'rename current session', arg: '<title>' },
      { name: 'fork', desc: 'fork current session' },
      { name: 'resume', desc: 'resume a session by id', arg: '<id>' },
    ],
  },
  {
    group: 'mode',
    commands: [
      { name: 'plan', desc: 'toggle plan mode' },
      { name: 'agent', desc: 'turn plan mode off' },
    ],
  },
  {
    group: 'model',
    commands: [
      { name: 'models', desc: 'pick a model' },
      { name: 'model', desc: 'set model by name', arg: '<name>' },
    ],
  },
  {
    group: 'capabilities',
    commands: [
      { name: 'tools', desc: 'list tools' },
      { name: 'skills', desc: 'list skills' },
      { name: 'jobs', desc: 'list background jobs' },
    ],
  },
  {
    group: 'context',
    commands: [
      { name: 'compact', desc: 'compact the conversation context' },
      { name: 'clear', desc: 'clear the screen' },
    ],
  },
  {
    group: 'goals',
    commands: [
      { name: 'goal', desc: 'manage the long-running goal' },
      { name: 'status', desc: 'show session status' },
    ],
  },
  {
    group: 'help',
    commands: [
      { name: 'help', desc: 'show keybindings' },
      { name: 'exit', desc: 'quit dskharness' },
    ],
  },
]

export const PALETTE_COMMANDS: PaletteCommand[] = COMMAND_GROUPS.flatMap((g) => g.commands)

/** Filter commands by the first word of a slash query, preserving group order. */
export function filterCommands(query: string): Array<{ group: string; commands: PaletteCommand[] }> {
  const q = (query.split(/\s+/)[0] ?? '').toLowerCase()
  if (!q) return COMMAND_GROUPS
  return COMMAND_GROUPS.map((g) => ({
    group: g.group,
    commands: g.commands.filter((c) => c.name.startsWith(q)),
  })).filter((g) => g.commands.length > 0)
}

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
 * The `/` command overlay (MiMo/opencode style): a grouped command palette
 * that turns into session / todo / capability pickers once a command runs.
 */
export function CommandPanel({
  mode,
  query,
  selected,
  groups,
  sessions,
  todos,
  currentSessionId,
  planMode,
  model,
  panelText,
  modelsList,
}: {
  mode: PaletteMode
  query: string
  selected: number
  groups: Array<{ group: string; commands: PaletteCommand[] }>
  sessions: SessionMeta[]
  todos: TodoItem[]
  currentSessionId: string
  planMode: boolean
  model: string
  /** Text for the read-only capability/status panels. */
  panelText?: string
  /** Model list for the models picker: {provider, id} pairs. */
  modelsList?: Array<{ provider: string; id: string }>
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} paddingY={0}>
      {mode === 'command' && (
        <Box flexDirection="column">
          <Text bold color={theme.primary}>
            commands <Text dimColor>· slash palette</Text>
          </Text>
          {groups.length === 0 && <Text dimColor>no matching command</Text>}
          {groups.map((g) => (
            <Box key={g.group} flexDirection="column">
              <Text dimColor>
                {'  '}
                {g.group}
              </Text>
              {g.commands.map((c) => {
                const globalIdx = indexOfCommand(groups, g.group, c.name)
                const active = globalIdx === selected
                return (
                  <Text key={c.name} color={active ? '#000000' : undefined} backgroundColor={active ? theme.primary : undefined}>
                    {active ? '› ' : '  '}/{c.name}
                    {c.arg ? <Text dimColor> {c.arg}</Text> : null}
                    <Text dimColor> — {c.desc}</Text>
                  </Text>
                )
              })}
            </Box>
          ))}
          <Text dimColor>↑↓ choose · ⏎ run · Esc close</Text>
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
      {mode === 'models' && (
        <Box flexDirection="column">
          <Text bold color={theme.primary}>
            /models
          </Text>
          {!modelsList?.length && <Text dimColor>no models available</Text>}
          {(modelsList ?? []).map((m, i) => {
            const active = i === selected
            const current = m.id === model
            return (
              <Text key={`${m.provider}:${m.id}`} color={active ? '#000000' : current ? theme.primary : undefined} backgroundColor={active ? theme.primary : undefined}>
                {active ? '› ' : current ? '● ' : '  '}
                {m.id} <Text dimColor>{m.provider}</Text>
              </Text>
            )
          })}
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
            const color = t.status === 'completed' ? theme.success : t.status === 'in_progress' ? theme.warn : 'gray'
            return (
              <Text key={t.id} color={active ? '#000000' : color} backgroundColor={active ? theme.primary : undefined}>
                {active ? '› ' : '  '}
                {icon} {t.content}
              </Text>
            )
          })}
        </Box>
      )}
      {(mode === 'tools' || mode === 'skills' || mode === 'jobs' || mode === 'status') && (
        <Box flexDirection="column">
          <Text bold color={theme.primary}>
            /{mode}
          </Text>
          {(panelText ?? '—').split('\n').map((l, i) => (
            <Text key={i} wrap="wrap">
              {l}
            </Text>
          ))}
          <Text dimColor>Esc close</Text>
        </Box>
      )}
      {mode === 'help' && (
        <Box flexDirection="column">
          <Text bold color={theme.primary}>
            keybindings
          </Text>
          <Text>⏎ send · Ctrl+C stop agent / quit when idle</Text>
          <Text>/ commands: sessions · new · rename · fork · plan · models · tools · skills · jobs · compact · goal · status · help · exit</Text>
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

function indexOfCommand(groups: Array<{ group: string; commands: PaletteCommand[] }>, group: string, name: string): number {
  let idx = 0
  for (const g of groups) {
    const found = g.commands.findIndex((c) => c.name === name)
    if (found >= 0) return idx + found
    idx += g.commands.length
  }
  return 0
}
