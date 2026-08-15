import React from 'react'
import { Box, Text, useInput } from 'ink'
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
  return theme.labelCaption
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
  focused,
  selIndex,
  onSelect,
  onOpenSession,
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
  focused: boolean
  selIndex: number
  onSelect: (i: number) => void
  onOpenSession: (id: string) => void
}) {
  const innerWidth = Math.max(8, width - 4)

  useInput((input, key) => {
    if (!focused) return
    if (key.upArrow) onSelect(Math.max(0, selIndex - 1))
    else if (key.downArrow) onSelect(Math.min(Math.max(0, sessions.length - 1), selIndex + 1))
    else if (key.return || input.includes('\r') || input.includes('\n')) {
      const s = sessions[selIndex]
      if (s && s.id !== currentSessionId) onOpenSession(s.id)
    } else if (key.escape) onSelect(-1)
  })

  return (
    <Box
      width={width}
      height="100%"
      flexDirection="column"
      borderRight
      borderRightColor={theme.border1}
      paddingX={1}
      paddingTop={0}
      overflowY="hidden"
    >
      <Box flexDirection="column" flexShrink={0}>
        <Text color={theme.labelPrimary} bold>
          {truncate(title || 'new session', innerWidth)}
        </Text>
        <Box flexDirection="row" gap={1} marginTop={0}>
          <Badge color={'#000000'} bg={mode === 'yolo' ? theme.error : theme.brand}>
            {mode.toUpperCase()}
          </Badge>
          {busy ? <Badge color={theme.warn} bg={theme.bgLayer2}>BUSY</Badge> : null}
        </Box>
      </Box>

      <Box marginTop={1} flexShrink={0}>
        <SectionLabel>SESSIONS</SectionLabel>
        <Box flexDirection="column" marginTop={0}>
          <Text> </Text>
          {sessions.length === 0 ? (
            <Text color={theme.labelCaption}>no local sessions</Text>
          ) : (
            sessions.slice(0, 10).map((s, i) => {
              const active = s.id === currentSessionId
              const selected = focused && i === selIndex
              return (
                <Text
                  key={s.id}
                  color={selected ? '#000000' : active ? theme.labelPrimary : theme.labelSecondary}
                  backgroundColor={selected ? theme.brand : active ? theme.bgLayer3 : undefined}
                >
                  {active ? `${'▎'} ` : selected ? '› ' : '  '}
                  {s.id.replace(/^session-/, '').slice(0, 8)}
                  <Text color={selected ? '#000000' : theme.labelCaption}> {timeAgo(s.updatedAt)}</Text>
                </Text>
              )
            })
          )}
        </Box>
      </Box>

      <Box marginTop={1} flexShrink={0}>
        <SectionLabel>TASKS</SectionLabel>
        <Box flexDirection="column" marginTop={0}>
          <Text> </Text>
          {todos.length === 0 ? (
            <Text color={theme.labelCaption}>no tracked tasks</Text>
          ) : (
            todos.slice(0, 5).map((t) => (
              <Text key={t.id} color={todoColor(t.status)}>
                {todoGlyph(t.status)} {truncate(t.content, innerWidth - 2)}
              </Text>
            ))
          )}
        </Box>
      </Box>

      <Box flexGrow={1} />
    </Box>
  )
}
