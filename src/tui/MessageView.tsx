import React from 'react'
import { Box, Text } from 'ink'
import type { ChatMessage, ToolCallRecord, ToolResultRecord } from '../types.ts'
import { Markdown } from '../markdown.tsx'
import { decoration, theme } from '../theme.ts'
import { MiniWhale, Whale } from './Whale.tsx'

/** MiMo-style transcript header: `▎ you` / `▎ mimo` / `· tool` / `↳ result`. */
function Header({
  kind,
  title,
  summary,
  dim,
}: {
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'toolResult' | 'error' | 'system'
  title: string
  summary?: string
  dim?: boolean
}) {
  const { sigil, color } = decoration(kind)
  return (
    <Text>
      <Text color={color} bold={!dim}>
        {sigil} {title}
      </Text>
      {summary ? (
        <Text dimColor>
          {' '}
          {summary}
        </Text>
      ) : null}
    </Text>
  )
}

export const ToolCard = function ToolCard({ call, result }: { call: ToolCallRecord; result?: ToolResultRecord }) {
  return (
    <Box flexDirection="column" marginY={0}>
      <Header
        kind="tool"
        title={call.name}
        summary={call.summary}
        dim
      />
      {call.status === 'running' && (
        <Text dimColor>
          {'  '}
          <MiniWhale label="running…" />
        </Text>
      )}
      {result && result.output.trim() && call.status !== 'running' ? (
        <Box flexDirection="column">
          <Header kind="toolResult" title="" dim />
          {result.output.split('\n').slice(0, 3).map((line, i) => (
            <Text key={i} dimColor>
              {'  '}
              {line}
            </Text>
          ))}
          {result.output.split('\n').length > 3 && (
            <Text dimColor>
              {'  '}… {result.output.split('\n').length - 3} more lines
            </Text>
          )}
        </Box>
      ) : null}
    </Box>
  )
}

export const MessageView = function MessageView({ m }: { m: ChatMessage }) {
  if (m.role === 'user') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Header kind="user" title="you" />
        <Markdown text={m.content} />
      </Box>
    )
  }

  const showWhale = m.streaming && !m.content && !m.thinking

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Header kind="assistant" title="mimo" />
      {m.thinking ? (
        <Text dimColor>
          ✢ thinking{m.streaming ? '…' : ''}
          {m.streaming ? '  ' : ''}
          {m.streaming ? <MiniWhale /> : null}
        </Text>
      ) : null}
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
    </Box>
  )
}
