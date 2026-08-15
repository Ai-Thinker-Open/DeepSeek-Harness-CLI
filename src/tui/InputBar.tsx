import React from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
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

export function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  placeholder,
  planMode,
  mode = 'agent',
  hint,
}: InputBarProps) {
  const frameColor = disabled ? theme.labelCaption : planMode ? theme.brand : modeBorderColor(mode)
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
        <Text color={theme.labelCaption} bold>
          {modeLabel}
        </Text>
        <Box flexGrow={1}>
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            focus={!disabled}
            showCursor
            placeholder={placeholder}
          />
        </Box>
        {busy ? (
          <Text color={theme.warn}>working…</Text>
        ) : null}
      </Box>
      <Box flexDirection="row" justifyContent="space-between" paddingX={1} height={1}>
        <Text color={theme.labelCaption}>{hint || 'Enter send · / commands'}</Text>
        <Text color={theme.labelCaption}>{planMode ? 'plan mode' : ''}</Text>
      </Box>
    </Box>
  )
}
