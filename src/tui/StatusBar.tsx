import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../theme.ts'
import { MiniWhale } from './Whale.tsx'
import type { AgentStatus } from '../types.ts'

export function StatusBar({
  model,
  status,
  detail,
  planMode,
  usage,
  cwd,
  sessionTitle,
}: {
  model: string
  status: AgentStatus
  detail: string
  planMode: boolean
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  cwd: string
  sessionTitle: string
}) {
  const busy = status === 'thinking' || status === 'working'
  const statusText =
    status === 'thinking' ? 'thinking' : status === 'working' ? detail || 'working' : status === 'question' ? 'waiting for you…' : status === 'error' ? 'error' : 'ready'
  const statusColor =
    status === 'error' ? theme.danger : status === 'question' ? theme.warn : busy ? theme.cyan : theme.ok

  return (
    <Box borderTop={true} borderColor={theme.border} paddingX={1} height={1} flexShrink={0}>
      <Text color={theme.whale} bold>
        🐳
      </Text>
      <Text color={theme.textDim}>
        {' '}
        {model} · {sessionTitle || 'new session'}
      </Text>
      {planMode && (
        <Text color={theme.warn} bold>
          {' '}
          · PLAN
        </Text>
      )}
      <Box marginLeft={2} flexShrink={0}>
        {busy ? <MiniWhale /> : null}
      </Box>
      <Text color={statusColor}> {statusText}</Text>
      <Box flexGrow={1} />
      <Text color={theme.subtle} dimColor>
        {usage.totalTokens ? `${usage.totalTokens.toLocaleString()} tok` : ''}
      </Text>
      <Text color={theme.subtle} dimColor>
        {' '}
        · {cwd.length > 24 ? '…' + cwd.slice(-23) : cwd}
      </Text>
    </Box>
  )
}
