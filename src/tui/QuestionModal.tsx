import React, { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { Question } from '../types.ts'
import { theme } from '../theme.ts'

function truncateBody(body: string, maxChars = 1200, maxLines = 14): string {
  let b = body
  if (b.length > maxChars) b = b.slice(0, maxChars) + '\n… (truncated)'
  const lines = b.split('\n')
  if (lines.length > maxLines) {
    b = lines.slice(0, maxLines).join('\n') + `\n… (${lines.length - maxLines} more lines)`
  }
  return b
}

/**
 * Renders a question (ask_user / permission / plan approval) as the whole view.
 * The App swaps to this component while a question is open, so every key here
 * belongs to the modal.
 */
export function QuestionModal({ question }: { question: Question }) {
  const [sel, setSel] = useState(0)

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

  return (
    <Box height="100%" flexDirection="column" alignItems="center" justifyContent="center">
      <Box
        width={72}
        flexDirection="column"
        borderStyle="round"
        borderColor={kindColor}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={kindColor}>
          {question.kind === 'permission' ? '🔒 Permission' : question.kind === 'plan-approval' ? '📋 Plan review' : '❓ Question'}
        </Text>
        <Text bold wrap="wrap">
          {question.title}
        </Text>
        {question.body ? (
          <Box flexDirection="column" marginTop={1} marginBottom={1}>
            {truncateBody(question.body)
              .split('\n')
              .map((l, i) => (
                <Text key={i} dimColor wrap="wrap">
                  {l}
                </Text>
              ))}
          </Box>
        ) : null}
        <Box flexDirection="column" marginTop={1}>
          {question.options.map((o, i) => {
            const active = i === sel
            return (
              <Text key={i} color={active ? '#000000' : undefined} backgroundColor={active ? kindColor : undefined} wrap="wrap">
                {active ? '› ' : '  '}
                {o}
              </Text>
            )
          })}
        </Box>
        <Text dimColor>
          ↑↓ choose · ⏎ confirm · Esc cancel
        </Text>
      </Box>
    </Box>
  )
}
