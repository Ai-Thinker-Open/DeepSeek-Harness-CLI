import { theme } from "../theme"

export function ModeHint() {
  return (
    <text>
      <span style={{ fg: theme.text }}>tab </span>
      <span style={{ fg: theme.textMuted }}>切换权限</span>
    </text>
  )
}
