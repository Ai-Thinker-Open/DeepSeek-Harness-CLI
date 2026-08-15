import React from 'react'
import { Box, Text } from 'ink'
import type { ChatMessage, ToolCallRecord, ToolResultRecord } from '../types.ts'
import { Markdown } from '../markdown.tsx'
import { theme } from '../theme.ts'
import { MiniWhale, Whale } from './Whale.tsx'

function ToolIcon({ status }: { status: ToolCallRecord['status'] }) {
  switch (status) {
    case 'running':
      return <Text color={theme.cyan}>●</Text>
    case 'ok':
      return <Text color={theme.ok}>✓</Text>
    case 'error':
      return <Text color={theme.danger}>✗</Text>
    case 'denied':
      return <Text color={theme.warn}>⊘</Text>
    default:
      return <Text color={theme.subtle}>○</Text>
  }
}

// NOTE: no React.memo here — the store mutates message objects in place while
// streaming, so memoizing on the object reference would freeze the view.
export const ToolCard = function ToolCard({
  call,
  result,
}: {
  call: ToolCallRecord
  result?: ToolResultRecord
}) {
  const dur =
    call.startedAt && call.finishedAt ? ` (${((call.finishedAt - call.startedAt) / 1000).toFixed(1)}s)` : ''
  return (
    <Box flexDirection="column" marginY={0} marginTop={0}>
      <Box>
        <ToolIcon status={call.status} />
        <Text bold color={theme.text}>
          {' '}
          {call.name}
        </Text>
        {call.summary ? (
          <Text color={theme.textDim} wrap="wrap">
            {'  '}
            {call.summary}
          </Text>
        ) : null}
        <Text color={theme.subtle}>{dur}</Text>
      </Box>
      {call.status === 'running' && (
        <Box paddingLeft={2}>
          <MiniWhale label="running…" />
        </Box>
      )}
      {result && result.output.trim() && call.status !== 'running' ? (
        <Box paddingLeft={2} flexDirection="column">
          {result.output.split('\n').slice(0, 4).map((line, i) => (
            <Text key={i} color={theme.textDim} wrap="wrap">
              {line}
            </Text>
          ))}
          {result.output.split('\n').length > 4 && (
            <Text color={theme.subtle}>… ({result.output.split('\n').length - 4} more lines)</Text>
          )}
        </Box>
      ) : null}
    </Box>
  )
}

/** Collapsed thinking indicator (opencode-style): one quiet line, no content. */
const ThinkingBlock = function ThinkingBlock({ streaming }: { streaming?: boolean }) {
  return (
    <Box flexDirection="row">
      <Text color={theme.subtle} dimColor>
        ┆ thinking
      </Text>
      {streaming ? <MiniWhale /> : null}
    </Box>
  )
}

export const MessageView = function MessageView({ m }: { m: ChatMessage }) {
  if (m.role === 'user') {
    return (
      <Box flexDirection="column" marginY={0}>
        <Text color={theme.user} bold>
          You
        </Text>
        <Box paddingLeft={1}>
          <Markdown text={m.content} />
        </Box>
      </Box>
    )
  }

  const showWhale = m.streaming && !m.content && !m.thinking

  return (
    <Box flexDirection="column" marginY={0}>
      <Text color={theme.whale} bold>
        🐳
      </Text>
      {m.thinking ? <ThinkingBlock streaming={m.streaming} /> : null}
      {showWhale ? <Whale label={m.thinking ? 'still thinking…' : 'thinking…'} /> : null}
      {m.content ? (
        <Box paddingLeft={1}>
          <Markdown text={m.content} />
        </Box>
      ) : null}
      {m.streaming && m.content ? (
        <Text color={theme.accent} bold>
          ▍
        </Text>
      ) : null}
      {m.toolCalls?.length
        ? m.toolCalls.map((tc) => (
            <ToolCard key={tc.id} call={tc} result={m.toolResults?.find((r) => r.toolCallId === tc.id)} />
          ))
        : null}
      {m.error ? (
        <Text color={theme.danger}>
          ⚠ {m.error}
        </Text>
      ) : null}
    </Box>
  )
}
