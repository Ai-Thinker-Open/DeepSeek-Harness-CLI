// @ts-nocheck
import { measureText } from '@opentui/core'

/**
 * opencode-style home screen using OpenTUI's official `ascii_font`
 * component (cfonts fonts) — the same way the OpenTUI examples render
 * their title ("OPENTUI EXAMPLES" with font "tiny").
 */
export function HomeScreen() {
  const { width: titleWidth } = measureText({ text: 'DeepSeek Harness', font: 'slick' })

  return (
    <box flexDirection="column" alignItems="center" paddingTop={3}>
      <ascii_font text="DeepSeek Harness" style={{ font: 'slick', color: '#E4E4E7' }} />
      <text style={{ fg: '#6B7280', marginTop: 2 }}>
        Terminal client for DeepSeek Harness
      </text>
      <text style={{ fg: '#52525B', marginTop: 1 }}>
        Enter to send · / for commands · Ctrl+R sessions · Ctrl+M model · Ctrl+C quit
      </text>
    </box>
  )
}
