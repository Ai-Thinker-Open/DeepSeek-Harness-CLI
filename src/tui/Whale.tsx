import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { miniWhaleFrames, whaleFrames } from '../whale.ts'
import { theme } from '../theme.ts'

/** Full-size animated little whale, shown while the model is thinking. */
export function Whale({ label = 'thinking…' }: { label?: string }) {
  const frames = React.useMemo(() => whaleFrames(8), [])
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % frames.length), 260)
    return () => clearInterval(t)
  }, [frames.length])
  const frame = frames[i] as string

  return (
    <Box flexDirection="row" marginY={1}>
      <Box flexDirection="column" marginRight={2}>
        {frame.split('\n').map((line, idx) => (
          <Text key={idx} color={theme.whale}>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" justifyContent="center">
        <Text color={theme.textDim} italic>
          {label}
        </Text>
        <Text color={theme.subtle} dimColor>
          DeepSeek 小鲸鱼 · diving for answers
        </Text>
      </Box>
    </Box>
  )
}

/** Single-line animated whale for the status bar. */
export function MiniWhale({ label }: { label?: string }) {
  const frames = React.useMemo(() => miniWhaleFrames(6), [])
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % frames.length), 180)
    return () => clearInterval(t)
  }, [frames.length])
  return (
    <Text color={theme.whale}>
      {frames[i]}
      {label ? ` ${label}` : ''}
    </Text>
  )
}
