import { For } from "solid-js"
import { PERMISSION_MODES, type PermissionMode } from "../permission"
import { theme } from "../theme"

export function ModeHint(props: { mode: () => PermissionMode }) {
  return (
    <box flexDirection="row" justifyContent="center">
      <text>
        <span style={{ fg: theme.secondary }}>Tab 切换模式: </span>
        <For each={PERMISSION_MODES}>
          {(item, index) => (
            <span style={{ fg: theme.primary }}>
              {index() > 0 ? " / " : ""}
              {props.mode() === item.id ? <b>{item.label}</b> : item.label}
            </span>
          )}
        </For>
      </text>
    </box>
  )
}
