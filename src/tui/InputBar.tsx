import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from '../theme.ts'

export interface InputBarProps {
  value: string
  onChange: (v: string) => void
  /** Called with the final text (which may differ from `value` when text and Enter arrive in one chunk). */
  onSubmit: (text: string) => void
  disabled?: boolean
  placeholder?: string
  /** When busy, Enter is ignored and Ctrl+C interrupts instead. */
  busy?: boolean
}

/**
 * A single-line text input with a visible cursor, readline-style editing.
 * Up/Down (history) and Ctrl+C are handled by the parent via `onHistory*`
 * props — those keys are not consumed here.
 */
export function InputBar({ value, onChange, onSubmit, disabled, busy, placeholder }: InputBarProps) {
  const [cursor, setCursor] = useState(value.length)
  const valueRef = useRef(value)
  valueRef.current = value

  // keep cursor within bounds when value changes externally
  useEffect(() => {
    setCursor((c) => Math.min(c, value.length))
  }, [value.length])

  useInput((input, key) => {
    if (disabled) return
    // Pasted text and Enter can arrive in one chunk ("text\r"). Split it.
    let text = input
    let submit = false
    while (text.endsWith('\r') || text.endsWith('\n')) {
      submit = true
      text = text.slice(0, -1)
    }
    if (key.return) submit = true
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
      return // handled by parent
    }
    if (input) {
      const pos = Math.min(cursor, cur.length)
      const next = cur.slice(0, pos) + input + cur.slice(pos)
      onChange(next)
      setCursor(pos + input.length)
    }
  })

  const display = value.length === 0 && placeholder && !disabled ? placeholder : value
  const before = display.slice(0, cursor)
  const at = display[cursor]
  const after = display.slice(cursor + 1)

  return (
    <Box>
      <Text color={theme.cyan}>❯ </Text>
      {value.length === 0 && placeholder && !disabled ? (
        <Text dimColor>
          {placeholder}
          <Text color={theme.accent} bold>
            ▏
          </Text>
        </Text>
      ) : (
        <Text color={theme.text}>
          {before}
          <Text color={theme.accent} bold>
            ▏
          </Text>
          {after}
        </Text>
      )}
      {busy && <Text color={theme.textDim}> (working…)</Text>}
    </Box>
  )
}
