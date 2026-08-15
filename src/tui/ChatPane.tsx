import React, { memo, useLayoutEffect, useRef, useState } from 'react'
import { Box, Text, measureElement, useInput, useStdout } from 'ink'
import type { ChatMessage } from '../types.ts'
import { MessageView } from './MessageView.tsx'
import { Whale } from './Whale.tsx'
import { whaleBanner } from '../whale.ts'
import { theme } from '../theme.ts'

const EmptyState = memo(function EmptyState() {
  return (
    <Box flexDirection="column" alignItems="center" marginTop={2}>
      <Text color={theme.primary}>{whaleBanner()}</Text>
      <Text bold>
        dskharness — DeepSeek Harness terminal agent
      </Text>
      <Text dimColor>Ask me to build, debug, or explore your workspace.</Text>
      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text dimColor>⏎ send · / for commands · Ctrl+C stop/quit</Text>
      </Box>
    </Box>
  )
})

export function ChatPane({
  messages,
  focused,
  status,
  clearSignal,
}: {
  messages: ChatMessage[]
  focused: boolean
  status: string
  /** Bump to reset the scroll to the bottom (the /clear command). */
  clearSignal?: number
}) {
  const { stdout } = useStdout()
  const rows = stdout.rows && stdout.rows > 0 ? stdout.rows : 24
  const viewportH = Math.max(5, rows - 3) // minus input + status rows

  const contentRef = useRef<Parameters<typeof measureElement>[0]>(null)
  const [contentH, setContentH] = useState(0)
  const [offset, setOffset] = useState(0)
  const offsetRef = useRef(0)
  const autoPin = useRef(true)

  const setOff = (o: number) => {
    offsetRef.current = o
    setOffset(o)
  }

  // measure the rendered height of the message column
  useLayoutEffect(() => {
    if (!contentRef.current) return
    const el = measureElement(contentRef.current)
    setContentH(el.height)
  }, [messages, status])

  const maxScroll = Math.max(0, contentH - viewportH)
  const atBottom = offset >= maxScroll - 2

  // /clear: reset scroll position
  useLayoutEffect(() => {
    if (clearSignal) {
      offsetRef.current = 0
      autoPin.current = true
      setOffset(0)
    }
  }, [clearSignal])

  // snap to bottom while the agent is streaming, unless the user scrolled up
  useLayoutEffect(() => {
    if (autoPin.current || offsetRef.current >= maxScroll - 2) {
      setOff(maxScroll)
    } else {
      setOff(Math.min(offsetRef.current, maxScroll))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxScroll])

  useInput((_input, key) => {
    if (!focused) return
    const step = Math.max(1, Math.floor(viewportH / 2))
    if (key.pageUp) {
      autoPin.current = false
      setOff(Math.max(0, offsetRef.current - step))
    } else if (key.pageDown) {
      setOff(Math.min(maxScroll, offsetRef.current + step))
    } else if (key.shift && key.upArrow) {
      autoPin.current = false
      setOff(Math.max(0, offsetRef.current - 1))
    } else if (key.shift && key.downArrow) {
      setOff(Math.min(maxScroll, offsetRef.current + 1))
    }
  })

  const hasStreamingEmpty = messages.some((m) => m.streaming && !m.content && !m.thinking)

  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1}>
      <Box ref={contentRef} flexDirection="column" marginTop={-offset}>
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((m, i) => (
            <Box key={m.id} flexDirection="column">
              {i > 0 && m.role === 'user' && (
                <Text dimColor>{'─'.repeat(40)}</Text>
              )}
              <MessageView m={m} />
            </Box>
          ))
        )}
        {status === 'thinking' && !hasStreamingEmpty && <Whale />}
      </Box>
      {!atBottom && messages.length > 0 && (
        <Box>
          <Text dimColor>↑ PageUp / Shift+↑ to scroll</Text>
        </Box>
      )}
    </Box>
  )
}
