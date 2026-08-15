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
  /** Plan mode frames the input in blue. */
  planMode?: boolean
  /** When the slash palette is open, Enter belongs to the palette. */
  suppressEnter?: boolean
}

/**
 * MiMo-style input: a round-bordered frame with a `✦` prompt glyph.
 * The cursor is a cyan `▏` bar (Ink trims trailing spaces, so no inverse
 * space cursor).
 */
export function InputBar({ value, onChange, onSubmit, disabled, busy, placeholder, planMode, suppressEnter }: InputBarProps) {
  const [cursor, setCursor] = useState(value.length)
  const valueRef = useRef(value)
  valueRef.current = value

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
    if (submit && suppressEnter) return // the slash palette owns Enter
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

  const frameColor = planMode ? theme.plan : theme.primary
  const display = value.length === 0 && placeholder && !disabled ? placeholder : value
  const before = display.slice(0, cursor)
  const after = display.slice(cursor + 1)

  return (
    <Box borderStyle="round" borderColor={disabled ? 'gray' : frameColor} paddingX={1} flexShrink={0}>
      <Text color={frameColor} bold>
        ✦{' '}
      </Text>
      {value.length === 0 && placeholder && !disabled ? (
        <Text dimColor>
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
      {busy && (
        <Text dimColor>
          {' '}
          (working…)
        </Text>
      )}
    </Box>
  )
}
