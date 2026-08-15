import React from 'react'
import { Box, Text } from 'ink'
import type { ChatMessage, ToolCallRecord, ToolResultRecord } from '../types.ts'
import { Markdown } from '../markdown.tsx'
import { decoration, formatReasoning, tailText, theme, verbForTool } from '../theme.ts'
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
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    if (call.status !== 'running' || !call.startedAt) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [call.status, call.startedAt])
  const elapsed = call.startedAt && call.status === 'running' ? formatDuration(now - call.startedAt) : undefined
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
          <MiniWhale label={`${verbForTool(call.name)}${elapsed ? ` · ${elapsed}` : ''}`} />
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return `${m}m${sec}s`
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
      <Text>
        <Header kind="assistant" title="mimo" />
        {m.streaming ? (
          <Text dimColor>
            {' '}
            · streaming
          </Text>
        ) : null}
      </Text>
      {m.thinking ? (
        <Box flexDirection="column">
          <Text dimColor>
            ✢ thinking{m.streaming ? '…' : ''}
            {m.streaming ? '  ' : ''}
            {m.streaming ? <MiniWhale /> : null}
          </Text>
          {m.streaming ? (
            <Text dimColor wrap="wrap">
              {formatReasoning(tailText(m.thinking, 6))}
            </Text>
          ) : null}
        </Box>
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
