import React from 'react'
import { Box, Text } from 'ink'
import type { SessionMeta, TodoItem } from '../types.ts'
import { shortPath, theme, truncate, type Mode } from '../theme.ts'
import { Badge, Divider, SectionLabel, StatusDot } from './ui.tsx'

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function todoGlyph(status: TodoItem['status']): string {
  if (status === 'completed') return '✓'
  if (status === 'in_progress') return '›'
  return '·'
}

function todoColor(status: TodoItem['status']): string {
  if (status === 'completed') return theme.success
  if (status === 'in_progress') return theme.warn
  return theme.muted
}

export function Sidebar({
  width,
  title,
  sessionId,
  model,
  cwd,
  todos,
  sessions,
  currentSessionId,
  planMode,
  mode,
  busy,
}: {
  width: number
  title: string
  sessionId: string
  model: string
  cwd: string
  todos: TodoItem[]
  sessions: SessionMeta[]
  currentSessionId: string
  planMode: boolean
  mode: Mode
  busy: boolean
}) {
  const innerWidth = Math.max(8, width - 4)

  return (
    <Box
      width={width}
      height="100%"
      flexDirection="column"
      borderRight
      borderRightColor={theme.border}
      paddingX={1}
      paddingTop={0}
      overflowY="hidden"
    >
      <Box flexDirection="column" flexShrink={0}>
        <Text color={theme.primary} bold>
          {truncate(title || 'new session', innerWidth)}
        </Text>
        <Text color={theme.dim}>
          {truncate(sessionId || 'not saved yet', innerWidth)}
        </Text>
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Badge color={theme.selectedFg} bg={mode === 'yolo' ? theme.error : mode === 'plan' ? theme.plan : theme.primary}>
            {mode.toUpperCase()}
          </Badge>
          {busy ? <Badge color={theme.warn} bg={theme.chipBg}>BUSY</Badge> : null}
          {planMode ? <Badge color={theme.plan} bg={theme.chipBg}>PLAN</Badge> : null}
        </Box>
      </Box>

      <Box marginY={1} flexShrink={0}>
        <Divider width={innerWidth} />
      </Box>

      <Box flexDirection="column" flexShrink={0}>
        <SectionLabel>SESSIONS</SectionLabel>
        <Box flexDirection="column" marginTop={0}>
          {sessions.length === 0 ? (
            <Text color={theme.dim}>no local sessions</Text>
          ) : (
            sessions.slice(0, 4).map((s) => {
              const active = s.id === currentSessionId
              return (
                <Text key={s.id} color={active ? theme.primary : theme.muted}>
                  {active ? '● ' : '  '}
                  {truncate(s.title || s.id.slice(0, 8), innerWidth - 8)}
                  <Text color={theme.dim}> {timeAgo(s.updatedAt)}</Text>
                </Text>
              )
            })
          )}
        </Box>
      </Box>

      <Box marginY={1} flexShrink={0}>
        <Divider width={innerWidth} />
      </Box>

      <Box flexDirection="column" flexShrink={0}>
        <SectionLabel>TASKS</SectionLabel>
        <Box flexDirection="column" marginTop={0}>
          {todos.length === 0 ? (
            <Text color={theme.dim}>no tracked tasks</Text>
          ) : (
            todos.slice(0, 5).map((t) => (
              <Text key={t.id} color={todoColor(t.status)}>
                {todoGlyph(t.status)} {truncate(t.content, innerWidth - 2)}
              </Text>
            ))
          )}
        </Box>
      </Box>

      <Box marginY={1} flexShrink={0}>
        <Divider width={innerWidth} />
      </Box>

      <Box flexDirection="column" flexShrink={0}>
        <SectionLabel>CONTEXT</SectionLabel>
        <Text color={theme.muted}>
          <StatusDot color={theme.success} /> {truncate(model || 'unknown model', innerWidth - 2)}
        </Text>
        <Text color={theme.dim}>{truncate(shortPath(cwd), innerWidth)}</Text>
      </Box>

      <Box flexGrow={1} />

      <Box flexDirection="column" flexShrink={0} borderTop borderTopColor={theme.border} paddingTop={0}>
        <Text color={theme.dim}>↑↓ history · ⏎ send</Text>
        <Text color={theme.dim}>/ commands · Ctrl+C stop</Text>
      </Box>
    </Box>
  )
}
