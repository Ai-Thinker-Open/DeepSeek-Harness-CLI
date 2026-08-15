import React, { memo, useLayoutEffect, useRef, useState } from 'react'
import { Box, Text, measureElement, useInput } from 'ink'
import type { ChatMessage } from '../types.ts'
import { theme } from '../theme.ts'
import { whaleBanner } from '../whale.ts'
import { MessageView } from './MessageView.tsx'
import { Whale } from './Whale.tsx'
import { KeyHint } from './ui.tsx'

const EmptyState = memo(function EmptyState({ width }: { width: number }) {
  return (
    <Box flexDirection="column" alignItems="center" marginTop={1}>
      <Text color={theme.brand}>{width >= 44 ? whaleBanner() : '(oᴗo)'}</Text>
      <Text bold color={theme.labelCaption}>
        DeepSeek Harness CLI
      </Text>
      <Text color={theme.labelCaption}>Terminal client for DeepSeek Harness</Text>
      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text color={theme.labelCaption}>Ask me to build, debug, or explore your workspace.</Text>
        <Box flexDirection="row" gap={2} marginTop={0}>
          <KeyHint keys="⏎" label="send" />
          <KeyHint keys="/" label="commands" />
          <KeyHint keys="Ctrl+C" label="stop / quit" />
        </Box>
      </Box>
    </Box>
  )
})

export function ChatPane({
  messages,
  focused,
  status,
  clearSignal,
  viewportH,
  width,
}: {
  messages: ChatMessage[]
  focused: boolean
  status: string
  clearSignal?: number
  viewportH: number
  width: number
}) {
  const contentRef = useRef<Parameters<typeof measureElement>[0]>(null)
  const [contentH, setContentH] = useState(0)
  const [offset, setOffset] = useState(0)
  const offsetRef = useRef(0)
  const autoPin = useRef(true)

  const setOff = (o: number) => {
    offsetRef.current = o
    setOffset(o)
  }

  useLayoutEffect(() => {
    if (!contentRef.current) return
    const el = measureElement(contentRef.current)
    setContentH(el.height)
  }, [messages, status, width])

  const maxScroll = Math.max(0, contentH - viewportH)
  const atBottom = offset >= maxScroll - 2

  useLayoutEffect(() => {
    if (clearSignal) {
      offsetRef.current = 0
      autoPin.current = true
      setOffset(0)
    }
  }, [clearSignal])

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
  const separator = '─'.repeat(Math.max(12, Math.min(48, width - 2)))

  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1}>
      <Box ref={contentRef} flexDirection="column" marginTop={-offset}>
        {messages.length === 0 ? (
          <EmptyState width={width} />
        ) : (
          messages.map((m, i) => (
            <Box key={m.id} flexDirection="column">
              {i > 0 && m.role === 'user' ? (
                <Box marginY={0}>
                  <Text color={theme.border1}>{separator}</Text>
                </Box>
              ) : null}
              <MessageView m={m} />
            </Box>
          ))
        )}
        {status === 'thinking' && !hasStreamingEmpty ? <Whale /> : null}
      </Box>
      {!atBottom && messages.length > 0 ? (
        <Box flexShrink={0}>
          <Text color={theme.labelCaption}>↑ PageUp / Shift+↑ to scroll</Text>
        </Box>
      ) : null}
    </Box>
  )
}
