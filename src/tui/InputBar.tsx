import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme, type Mode, modeBorderColor, modeGlyph } from '../theme.ts'

export interface InputBarProps {
  value: string
  onChange: (v: string) => void
  onSubmit: (text: string) => void
  disabled?: boolean
  placeholder?: string
  busy?: boolean
  planMode?: boolean
  suppressEnter?: boolean
  mode?: Mode
  hint?: string
}

/**
 * The prompt bar is the main interactive surface. It keeps the original
 * single-line editing model, but gives it clearer mode/status signaling and a
 * calmer, more deliberate frame.
 */
export function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  placeholder,
  planMode,
  suppressEnter,
  mode = 'agent',
  hint,
}: InputBarProps) {
  const [cursor, setCursor] = useState(value.length)
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    setCursor((c) => Math.min(c, value.length))
  }, [value.length])

  useInput((input, key) => {
    if (disabled) return
    let text = input
    let submit = false
    while (text.endsWith('\r') || text.endsWith('\n')) {
      submit = true
      text = text.slice(0, -1)
    }
    if (key.return) submit = true
    if (submit && suppressEnter) return
    if (submit) {
      const cur = valueRef.current
      const pos = Math.min(cursor, cur.length)
      if (text) {
        const next = cur.slice(0, pos) + text + cur.slice(pos)
        onChange(next)
        setCursor(pos + text.length)
        onSubmit(next)
      } else {
        onSubmit(cur)
      }
      return
    }
    const cur = valueRef.current
    if (key.backspace || key.delete) {
      const pos = Math.min(cursor, cur.length)
      if (key.backspace && pos > 0) {
        const next = cur.slice(0, pos - 1) + cur.slice(pos)
        onChange(next)
        setCursor(pos - 1)
      } else if (key.delete && pos < cur.length) {
        const next = cur.slice(0, pos) + cur.slice(pos + 1)
        onChange(next)
      }
      return
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(cur.length, c + 1))
      return
    }
    if (key.pageUp || key.pageDown || key.upArrow || key.downArrow || key.tab || key.escape) {
      return
    }
    if (input) {
      const pos = Math.min(cursor, cur.length)
      const next = cur.slice(0, pos) + input + cur.slice(pos)
      onChange(next)
      setCursor(pos + input.length)
    }
  })

  const frameColor = disabled ? theme.dim : planMode ? theme.plan : modeBorderColor(mode)
  const display = value.length === 0 && placeholder && !disabled ? placeholder : value
  const before = display.slice(0, cursor)
  const after = display.slice(cursor + 1)
  const modeLabel = mode === 'yolo' ? 'YOLO' : mode === 'plan' ? 'PLAN' : 'AGENT'

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box
        borderStyle="round"
        borderColor={frameColor}
        paddingX={1}
        flexDirection="row"
        alignItems="center"
        gap={1}
      >
        <Text color={frameColor} bold>
          {modeGlyph(mode)}
        </Text>
        <Text color={theme.dim} bold>
          {modeLabel}
        </Text>
        <Box flexGrow={1} flexDirection="row">
          {value.length === 0 && placeholder && !disabled ? (
            <Text color={theme.dim}>
              {placeholder}
              <Text color={frameColor} bold>
                ▏
              </Text>
            </Text>
          ) : (
            <Text>
              {before}
              <Text color={frameColor} bold>
                ▏
              </Text>
              {after}
            </Text>
          )}
        </Box>
        {busy ? (
          <Text color={theme.warn}>working…</Text>
        ) : null}
      </Box>
      <Box flexDirection="row" justifyContent="space-between" paddingX={1} height={1}>
        <Text color={theme.dim}>{hint || 'Enter send · / commands'}</Text>
        <Text color={theme.dim}>{planMode ? 'plan mode' : ''}</Text>
      </Box>
    </Box>
  )
}
