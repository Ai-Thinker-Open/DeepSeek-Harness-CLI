import React from 'react'
import { Box, Text, useInput } from 'ink'
import type { SessionMeta, TodoItem } from '../types.ts'
import { theme } from '../theme.ts'

export type SidebarTab = 'sessions' | 'todos' | 'plan'

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function Sidebar({
  focused,
  tab,
  onTab,
  sessions,
  currentSessionId,
  selIndex,
  onSelectIndex,
  onOpenSession,
  todos,
  onToggleTodo,
  planMode,
  onTogglePlan,
}: {
  focused: boolean
  tab: SidebarTab
  onTab: (t: SidebarTab) => void
  sessions: SessionMeta[]
  currentSessionId: string
  selIndex: number
  onSelectIndex: (i: number) => void
  onOpenSession: (id: string) => void
  todos: TodoItem[]
  onToggleTodo: (id: string) => void
  planMode: boolean
  onTogglePlan: () => void
}) {
  const listLen = tab === 'sessions' ? sessions.length : tab === 'todos' ? todos.length : 1

  useInput((input, key) => {
    if (!focused) return
    if (key.upArrow) onSelectIndex(Math.max(0, selIndex - 1))
    else if (key.downArrow) onSelectIndex(Math.min(listLen - 1, selIndex + 1))
    else if (key.leftArrow) onTab(tab === 'sessions' ? 'plan' : tab === 'todos' ? 'sessions' : 'todos')
    else if (key.rightArrow) onTab(tab === 'sessions' ? 'todos' : tab === 'todos' ? 'plan' : 'sessions')
    else if (key.return || input.includes('\r') || input.includes('\n')) {
      if (tab === 'sessions') {
        const s = sessions[selIndex]
        if (s && s.id !== currentSessionId) onOpenSession(s.id)
      } else if (tab === 'todos') {
        const t = todos[selIndex]
        if (t) onToggleTodo(t.id)
      } else {
        onTogglePlan()
      }
    }
  })

  const TABS: Array<{ id: SidebarTab; label: string }> = [
    { id: 'sessions', label: 'Sessions' },
    { id: 'todos', label: 'Todos' },
    { id: 'plan', label: 'Plan' },
  ]

  return (
    <Box flexDirection="column" width={30} borderRight={true} borderColor={theme.border} height="100%">
      <Box paddingX={1} paddingY={0}>
        <Text bold color={theme.whale}>
          🐳 dskharness
        </Text>
      </Box>
      <Box paddingX={1}>
        {TABS.map((t) => {
          const active = t.id === tab
          return (
            <Text key={t.id} color={active ? theme.accent : theme.subtle} bold={active}>
              {active ? ` [${t.label}] ` : ` ${t.label} `}
            </Text>
          )
        })}
      </Box>
      <Box flexGrow={1} flexDirection="column" overflowY="hidden">
        {tab === 'sessions' && (
          <Box flexDirection="column">
            {sessions.length === 0 && <Text color={theme.subtle}> no sessions yet</Text>}
            {sessions.map((s, i) => {
              const selected = i === selIndex && focused
              const current = s.id === currentSessionId
              return (
                <Box key={s.id} paddingX={1}>
                  <Text
                    backgroundColor={selected ? theme.accent : undefined}
                    color={selected ? '#0B0D12' : current ? theme.cyan : theme.text}
                    bold={current}
                  >
                    {current ? '● ' : '○ '}
                    {s.title}
                  </Text>
                  <Text color={selected ? '#0B0D12' : theme.subtle} dimColor={!selected}>
                    {' '}
                    {timeAgo(s.updatedAt)}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
        {tab === 'todos' && (
          <Box flexDirection="column">
            {todos.length === 0 && <Text color={theme.subtle}> no todos — ask the agent to plan work</Text>}
            {todos.map((t, i) => {
              const selected = i === selIndex && focused
              const icon = t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '→' : '☐'
              return (
                <Box key={t.id} paddingX={1}>
                  <Text
                    backgroundColor={selected ? theme.accent : undefined}
                    color={
                      selected
                        ? '#0B0D12'
                        : t.status === 'completed'
                          ? theme.ok
                          : t.status === 'in_progress'
                            ? theme.warn
                            : theme.textDim
                    }
                  >
                    {icon} {t.content}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
        {tab === 'plan' && (
          <Box flexDirection="column" paddingX={1}>
            <Box>
              <Text color={theme.text}>Plan mode: </Text>
              <Text bold color={planMode ? theme.warn : theme.subtle}>
                {planMode ? 'ACTIVE — planning only' : 'off'}
              </Text>
            </Box>
            <Text color={theme.subtle}>
              While active, the agent may only research and plan; mutating tools are blocked until you approve the plan
              (exit_plan_mode).
            </Text>
            <Box marginTop={1}>
              <Text color={theme.textDim}>Enter / Ctrl+E to toggle</Text>
            </Box>
          </Box>
        )}
      </Box>
      <Box paddingX={1} borderTop={true} borderColor={theme.border}>
        <Text color={theme.subtle} dimColor>
          ←→ tabs · ↑↓ select · ⏎ open
        </Text>
      </Box>
    </Box>
  )
}
