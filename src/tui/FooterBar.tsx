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
  mode,
  usage,
  hint,
}: {
  width: number
  cwd: string
  model: string
  mode: Mode
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  hint: string
}) {
  const path = shortPath(cwd)
  const tokens = compactTokens(usage.totalTokens)
  const left = `● ${path}`
  const right = `${tokens} tok · ${model} · ${mode.toUpperCase()}`

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderTop
      borderTopColor={theme.border}
      paddingX={1}
      height={1}
      flexShrink={0}
    >
      <Text color={theme.muted}>{truncate(left, Math.max(12, Math.floor(width * 0.5)))}</Text>
      <Text color={theme.dim}>{truncate(`${hint}  ·  ${right}`, Math.max(18, width - Math.ceil(width * 0.5)))}</Text>
    </Box>
  )
}
