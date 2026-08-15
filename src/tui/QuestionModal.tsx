import React, { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { Question } from '../types.ts'
import { theme } from '../theme.ts'
import { Badge } from './ui.tsx'

function truncateBody(body: string, maxChars = 1200, maxLines = 14): string {
  let b = body
  if (b.length > maxChars) b = b.slice(0, maxChars) + '\n… (truncated)'
  const lines = b.split('\n')
  if (lines.length > maxLines) {
    b = lines.slice(0, maxLines).join('\n') + `\n… (${lines.length - maxLines} more lines)`
  }
  return b
}

export function QuestionModal({ question }: { question: Question }) {
  const { stdout } = useStdout()
  const [sel, setSel] = useState(0)
  const width = Math.max(36, Math.min(78, (stdout.columns || 80) - 4))

  useEffect(() => {
    setSel(0)
  }, [question.id])

  useInput((input, key) => {
    if (key.upArrow) setSel((s) => Math.max(0, s - 1))
    else if (key.downArrow) setSel((s) => Math.min(question.options.length - 1, s + 1))
    else if (key.return || input.includes('\r') || input.includes('\n')) question.resolve(question.options[sel] as string)
    else if (key.escape) question.cancel()
  })

  const kindColor =
    question.kind === 'permission'
      ? theme.warn
      : question.kind === 'plan-approval'
        ? theme.plan
        : theme.primary

  const kindLabel =
    question.kind === 'permission'
      ? 'PERMISSION'
      : question.kind === 'plan-approval'
        ? 'PLAN REVIEW'
        : 'QUESTION'

  return (
    <Box height="100%" flexDirection="column" alignItems="center" justifyContent="center" paddingX={1}>
      <Box width={width} flexDirection="column" borderStyle="round" borderColor={kindColor} paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Badge color={theme.selectedFg} bg={kindColor}>
            {kindLabel}
          </Badge>
          <Text color={theme.dim}>Esc cancel</Text>
        </Box>
        <Box marginTop={1}>
          <Text bold color={kindColor} wrap="wrap">
            {question.title}
          </Text>
        </Box>
        {question.body ? (
          <Box flexDirection="column" marginY={1} borderTop borderTopColor={theme.border} paddingTop={1}>
            {truncateBody(question.body)
              .split('\n')
              .map((l, i) => (
                <Text key={i} color={theme.muted} wrap="wrap">
                  {l}
                </Text>
              ))}
          </Box>
        ) : null}
        <Box flexDirection="column" marginTop={1}>
          {question.options.map((o, i) => {
            const active = i === sel
            return (
              <Text
                key={i}
                color={active ? theme.selectedFg : theme.muted}
                backgroundColor={active ? kindColor : undefined}
                wrap="wrap"
              >
                {active ? '› ' : '  '}
                {o}
              </Text>
            )
          })}
        </Box>
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Text color={theme.dim}>↑↓ choose</Text>
          <Text color={theme.dim}>⏎ confirm</Text>
        </Box>
      </Box>
    </Box>
  )
}
