import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import type { ChatMessage, ToolCallRecord, ToolResultRecord } from '../types.ts'
import { Markdown } from '../markdown.tsx'
import { decoration, formatReasoning, tailText, theme, truncate, verbForTool } from '../theme.ts'
import { AccentCard, RoleChip } from './ui.tsx'
import { MiniWhale, Whale } from './Whale.tsx'

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return `${m}m${sec}s`
}

function statusGlyph(status: ToolCallRecord['status']): { glyph: string; color: string } {
  switch (status) {
    case 'running':
      return { glyph: '◐', color: theme.warn }
    case 'ok':
      return { glyph: '✓', color: theme.success }
    case 'denied':
      return { glyph: '⊘', color: theme.error }
    case 'error':
      return { glyph: '✗', color: theme.error }
    default:
      return { glyph: '·', color: theme.dim }
  }
}

function MessageHeader({
  role,
  createdAt,
  streaming,
}: {
  role: 'user' | 'assistant'
  createdAt: number
  streaming?: boolean
}) {
  const color = role === 'user' ? theme.user : theme.assistant
  const label = role === 'user' ? 'YOU' : 'DSK'

  return (
    <Box flexDirection="row" gap={1} alignItems="center" marginBottom={0}>
      <RoleChip color={color}>{label}</RoleChip>
      <Text color={theme.dim}>{formatClock(createdAt)}</Text>
      {streaming ? (
        <Text color={theme.warn}>
          <MiniWhale label="streaming" />
        </Text>
      ) : null}
    </Box>
  )
}

function ThinkingBlock({ thinking, streaming }: { thinking: string; streaming: boolean }) {
  return (
    <Box flexDirection="column" marginTop={0}>
      <Text color={theme.thinking}>
        <Text bold>✢ THINKING</Text>
        {streaming ? ' …' : ''}
      </Text>
      {streaming ? (
        <Text color={theme.thinking} wrap="wrap">
          {formatReasoning(tailText(thinking, 6))}
        </Text>
      ) : null}
    </Box>
  )
}

export function ToolCard({ call, result }: { call: ToolCallRecord; result?: ToolResultRecord }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (call.status !== 'running' || !call.startedAt) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [call.status, call.startedAt])

  const elapsed = call.startedAt && call.status === 'running' ? formatDuration(now - call.startedAt) : undefined
  const status = statusGlyph(call.status)
  const title = call.summary ? `${call.name} — ${truncate(call.summary, 52)}` : call.name

  return (
    <Box flexDirection="column" marginTop={0} borderLeft borderLeftColor={theme.tool} paddingLeft={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={theme.tool}>{status.glyph}</Text>
        <Text color={theme.muted} bold>
          {title}
        </Text>
        {call.status === 'running' && elapsed ? (
          <Text color={theme.tool}>· {elapsed}</Text>
        ) : null}
      </Box>
      {call.status === 'running' ? (
        <Box marginTop={0}>
          <Text color={theme.tool}>
            <MiniWhale label={`${verbForTool(call.name)}…`} />
          </Text>
        </Box>
      ) : null}
      {result && result.output.trim() && call.status !== 'running' ? (
        <Box flexDirection="column">
          {result.output
            .split('\n')
            .slice(0, 3)
            .map((line, i) => (
              <Text key={i} color={result.ok ? theme.muted : theme.error}>
                {line}
              </Text>
            ))}
          {result.output.split('\n').length > 3 ? (
            <Text color={theme.dim}>… {result.output.split('\n').length - 3} more lines</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

export function MessageView({ m }: { m: ChatMessage }) {
  if (m.role === 'user') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <MessageHeader role="user" createdAt={m.createdAt} />
        <AccentCard color={theme.user}>
          <Markdown text={m.content} />
        </AccentCard>
      </Box>
    )
  }

  const showWhale = m.streaming && !m.content && !m.thinking
  const { color } = decoration('assistant')

  return (
    <Box flexDirection="column" marginBottom={1}>
      <MessageHeader role="assistant" createdAt={m.createdAt} streaming={m.streaming} />
      <AccentCard color={color}>
        {m.thinking ? <ThinkingBlock thinking={m.thinking} streaming={m.streaming ?? false} /> : null}
        {showWhale ? <Whale label="thinking…" /> : null}
        {m.content ? <Markdown text={m.content} /> : null}
        {m.streaming && m.content ? (
          <Text color={theme.primary} bold>
            ▍
          </Text>
        ) : null}
        {m.toolCalls?.length
          ? m.toolCalls.map((tc) => (
              <ToolCard key={tc.id} call={tc} result={m.toolResults?.find((r) => r.toolCallId === tc.id)} />
            ))
          : null}
        {m.error ? (
          <Text color={theme.error}>
            ✖ {m.error}
          </Text>
        ) : null}
      </AccentCard>
    </Box>
  )
}
