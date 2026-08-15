import React from 'react'
import { Box, Text } from 'ink'
import type { SessionMeta, TodoItem } from '../types.ts'
import { theme, truncate } from '../theme.ts'

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
      { name: 'yolo', desc: 'auto-approve everything' },
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
      { name: 'exit', desc: 'quit dsh-cli' },
    ],
  },
]

export const PALETTE_COMMANDS: PaletteCommand[] = COMMAND_GROUPS.flatMap((g) => g.commands)

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

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={0}>
      <Text bold color={theme.primary}>
        {children}
      </Text>
      <Text color={theme.dim}>↑↓ choose · ⏎ run · Esc close</Text>
    </Box>
  )
}

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
  panelText?: string
  modelsList?: Array<{ provider: string; id: string }>
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} flexShrink={0}>
      {mode === 'command' ? (
        <Box flexDirection="column">
          <PanelTitle>command palette</PanelTitle>
          <Box flexDirection="column" marginTop={0}>
            {groups.length === 0 ? <Text color={theme.dim}>no matching command</Text> : null}
            {groups.map((g) => (
              <Box key={g.group} flexDirection="column" marginBottom={0}>
                <Text color={theme.dim} bold>
                  {g.group}
                </Text>
                {g.commands.map((c) => {
                  const globalIdx = indexOfCommand(groups, g.group, c.name)
                  const active = globalIdx === selected
                  return (
                    <Text
                      key={c.name}
                      color={active ? theme.selectedFg : theme.muted}
                      backgroundColor={active ? theme.selectedBg : undefined}
                    >
                      {active ? '› ' : '  '}/{c.name}
                      {c.arg ? <Text color={active ? theme.selectedFg : theme.dim}> {c.arg}</Text> : null}
                      <Text color={active ? theme.selectedFg : theme.dim}> — {c.desc}</Text>
                    </Text>
                  )
                })}
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}

      {mode === 'sessions' ? (
        <Box flexDirection="column">
          <PanelTitle>sessions</PanelTitle>
          {sessions.length === 0 ? <Text color={theme.dim}>no sessions yet</Text> : null}
          {sessions.slice(0, 20).map((s, i) => {
            const active = i === selected
            const current = s.id === currentSessionId
            return (
              <Text
                key={s.id}
                color={active ? theme.selectedFg : current ? theme.primary : theme.muted}
                backgroundColor={active ? theme.selectedBg : undefined}
              >
                {active ? '› ' : current ? '● ' : '  '}
                {truncate(s.title || s.id.slice(0, 12), 52)}
                <Text color={active ? theme.selectedFg : theme.dim}> {timeAgo(s.updatedAt)}</Text>
              </Text>
            )
          })}
          {sessions.length > 20 ? <Text color={theme.dim}>… {sessions.length - 20} more</Text> : null}
        </Box>
      ) : null}

      {mode === 'models' ? (
        <Box flexDirection="column">
          <PanelTitle>models</PanelTitle>
          {!modelsList?.length ? <Text color={theme.dim}>no models available</Text> : null}
          {(modelsList ?? []).map((m, i) => {
            const active = i === selected
            const current = m.id === model
            return (
              <Text
                key={`${m.provider}:${m.id}`}
                color={active ? theme.selectedFg : current ? theme.primary : theme.muted}
                backgroundColor={active ? theme.selectedBg : undefined}
              >
                {active ? '› ' : current ? '● ' : '  '}
                {truncate(m.id, 52)} <Text color={active ? theme.selectedFg : theme.dim}>{m.provider}</Text>
              </Text>
            )
          })}
        </Box>
      ) : null}

      {mode === 'todos' ? (
        <Box flexDirection="column">
          <PanelTitle>todos</PanelTitle>
          {todos.length === 0 ? <Text color={theme.dim}>no todos — ask the agent to plan work</Text> : null}
          {todos.map((t, i) => {
            const active = i === selected
            const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '›' : '·'
            const color = t.status === 'completed' ? theme.success : t.status === 'in_progress' ? theme.warn : theme.muted
            return (
              <Text key={t.id} color={active ? theme.selectedFg : color} backgroundColor={active ? theme.selectedBg : undefined}>
                {active ? '› ' : '  '}
                {icon} {truncate(t.content, 56)}
              </Text>
            )
          })}
        </Box>
      ) : null}

      {(mode === 'tools' || mode === 'skills' || mode === 'jobs' || mode === 'status') ? (
        <Box flexDirection="column">
          <PanelTitle>/{mode}</PanelTitle>
          {(panelText ?? '—').split('\n').map((l, i) => (
            <Text key={i} wrap="wrap" color={theme.muted}>
              {l}
            </Text>
          ))}
        </Box>
      ) : null}

      {mode === 'help' ? (
        <Box flexDirection="column">
          <PanelTitle>keybindings</PanelTitle>
          <Text color={theme.muted}>⏎ send · Ctrl+C stop agent / quit when idle</Text>
          <Text color={theme.muted}>/ commands: sessions · new · rename · fork · plan · agent · yolo · models · tools · skills · jobs · compact · goal · status · help · exit</Text>
          <Text color={theme.muted}>Ctrl+N new session · Ctrl+E plan mode · Ctrl+M model</Text>
          <Text color={theme.muted}>↑↓ input history · PageUp/Down scroll · Esc clear / close</Text>
        </Box>
      ) : null}

      <Text color={theme.dim}>
        {query ? `/${query}` : 'type to filter'} · plan {planMode ? 'on' : 'off'} · {model}
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
