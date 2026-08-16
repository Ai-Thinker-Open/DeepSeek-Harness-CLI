import { For } from "solid-js"
import { PERMISSION_MODES, type PermissionMode } from "../permission"
import { theme } from "../theme"

export function ModeHint(props: { mode: () => PermissionMode }) {
  return (
    <text>
      <span style={{ fg: theme.textMuted }}>Tab 切换模式: </span>
      <For each={PERMISSION_MODES}>
        {(item, index) => (
          <span style={{ fg: props.mode() === item.id ? theme.primary : theme.textMuted }}>
            {index() > 0 ? " / " : ""}
            {item.label}
          </span>
        )}
      </For>
    </text>
  )
}
