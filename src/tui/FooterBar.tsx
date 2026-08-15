import React from 'react'
import { Box, Text } from 'ink'
import { shortPath, theme, truncate, type Mode } from '../theme.ts'

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function FooterBar({
  width,
  cwd,
  model,
  usage,
}: {
  width: number
  cwd: string
  model: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}) {
  const path = shortPath(cwd)
  const tokens = compactTokens(usage.totalTokens)
  const left = `● ${path}`
  const right = `${tokens} tok · ${model}`

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderTop
      borderTopColor={theme.border1}
      paddingX={1}
      height={1}
      flexShrink={0}
    >
      <Text color={theme.labelCaption}>{truncate(left, Math.max(12, Math.floor(width * 0.5)))}</Text>
      <Text color={theme.labelCaption}>{truncate(right, Math.max(18, width - Math.ceil(width * 0.5)))}</Text>
    </Box>
  )
}
