import React from 'react'
import { Box, Text } from 'ink'
import { modeBorderColor, shortPath, theme, truncate, type Mode } from '../theme.ts'
import { Badge, StatusDot } from './ui.tsx'

export function StatusBar({
  width,
  title,
  model,
  cwd,
  mode,
  busy,
}: {
  width: number
  title: string
  model: string
  cwd: string
  mode: Mode
  busy: boolean
}) {
  // One compact line: brand · title  …  status dot · model · ~/path
  const left = `${title || 'new session'}`
  const state = busy ? '…' : '●'
  const stateColor = busy ? theme.warn : theme.success
  const modeColor = modeBorderColor(mode)

  return (
    <Box borderBottom borderBottomColor={theme.border1} paddingX={1} height={1} flexShrink={0} flexDirection="row">
      <Text color={theme.brand} bold>
        ✦{' '}
      </Text>
      <Text bold color={theme.labelPrimary}>
        {truncate(left, Math.max(8, Math.floor(width * 0.3)))}
      </Text>
      <Text color={theme.labelCaption} dimColor>
        {' '}
        {truncate(shortPath(cwd), Math.max(6, Math.floor(width * 0.3)))}
      </Text>
      <Box flexGrow={1} />
      <Text color={modeColor} bold>
        {mode.toUpperCase()}
      </Text>
      <Text color={stateColor}>
        {' '}
        {state}
      </Text>
      <Text color={theme.labelCaption}>
        {' '}
        {truncate(model, Math.max(8, Math.floor(width * 0.18)))}
      </Text>
    </Box>
  )
}
