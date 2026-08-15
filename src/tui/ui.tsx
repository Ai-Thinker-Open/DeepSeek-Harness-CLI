import React from 'react'
import { Box, Text } from 'ink'
import { theme, truncate } from '../theme.ts'

/**
 * Small shared visual primitives. These are intentionally generic building
 * blocks (badge, divider, key hint) so the main TUI files stay focused on
 * layout instead of repeating ad-hoc color/spacing decisions.
 */

export function Badge({
  children,
  color = theme.primary,
  bg = theme.chipBg,
}: {
  children: React.ReactNode
  color?: string
  bg?: string
}) {
  return (
    <Text color={color} backgroundColor={bg}>
      {' '}
      {children}{' '}
    </Text>
  )
}

export function Divider({ color = theme.border, label, width = 48 }: { color?: string; label?: string; width?: number }) {
  const lineWidth = Math.max(1, width)
  if (label) {
    return (
      <Text color={color}>
        {`─ ${truncate(label, Math.max(1, lineWidth - 2))} `}
        {'─'.repeat(Math.max(0, lineWidth - Math.min(lineWidth, truncate(label, lineWidth).length + 3)))}
      </Text>
    )
  }
  return (
    <Text color={color}>
      {'─'.repeat(lineWidth)}
    </Text>
  )
}

export function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <Text>
      <Text color={theme.primary}>{keys}</Text>
      <Text dimColor> {label}</Text>
    </Text>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text color={theme.muted} bold>
      {children}
    </Text>
  )
}

export function StatusDot({ color = theme.success, glyph = '●' }: { color?: string; glyph?: string }) {
  return <Text color={color}>{glyph}</Text>
}

/** A narrow left-accent card, used for transcript and tool entries. */
export function AccentCard({
  color,
  children,
  paddingLeft = 1,
}: {
  color: string
  children: React.ReactNode
  paddingLeft?: number
}) {
  return (
    <Box borderLeft borderLeftColor={color} paddingLeft={paddingLeft} flexDirection="column">
      {children}
    </Box>
  )
}

/** A compact role label rendered as a chip. */
export function RoleChip({ children, color = theme.primary }: { children: React.ReactNode; color?: string }) {
  return (
    <Text bold color={color}>
      {children}
    </Text>
  )
}
