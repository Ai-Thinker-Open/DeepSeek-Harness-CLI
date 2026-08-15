import React from 'react'
import { Box, Text } from 'ink'
import { modeBorderColor, shortPath, theme, truncate, type Mode } from '../theme.ts'
import { Badge, StatusDot } from './ui.tsx'

export function StatusBar({
  width,
  title,
  sessionId,
  model,
  cwd,
  mode,
  planMode,
  busy,
  status,
}: {
  width: number
  title: string
  sessionId: string
  model: string
  cwd: string
  mode: Mode
  planMode: boolean
  busy: boolean
  status: string
}) {
  const left = `✦ DeepSeek Harness CLI · ${title || 'new session'}`
  const right = `${mode.toUpperCase()}${planMode ? ' · PLAN' : ''}`
  const meta = `${model || 'unknown model'} · ${shortPath(cwd)} · ${sessionId ? sessionId.slice(0, 8) : 'new'}`
  const state = busy ? status : 'ready'
  const modeColor = modeBorderColor(mode)

  return (
    <Box flexDirection="column" borderBottom borderBottomColor={theme.border1} paddingX={1} flexShrink={0}>
      <Box flexDirection="row" justifyContent="space-between" height={1}>
        <Text>
          <Text color={theme.brand} bold>
            {truncate(left, Math.max(12, Math.floor(width * 0.58)))}
          </Text>
        </Text>
        <Box flexDirection="row" gap={1}>
          <Badge color={'#000000'} bg={modeColor}>
            {right}
          </Badge>
          <Badge color={busy ? theme.warn : theme.success} bg={theme.bgLayer2}>
            {busy ? 'RUNNING' : 'READY'}
          </Badge>
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" height={1}>
        <Text color={theme.labelCaption}>
          <StatusDot color={busy ? theme.warn : theme.success} glyph={busy ? '◐' : '●'} />{' '}
          {truncate(meta, Math.max(16, Math.floor(width * 0.62)))}
        </Text>
        <Text color={theme.labelCaption}>{truncate(state, Math.max(10, width - 4))}</Text>
      </Box>
    </Box>
  )
}
