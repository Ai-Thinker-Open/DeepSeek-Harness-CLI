import { Show } from "solid-js"
import { theme } from "../theme"

export type ToastMessage = { text: string; kind: "success" | "error" }

export function Toast(props: { toast: () => ToastMessage | null }) {
  const color = () => (props.toast()!.kind === "error" ? theme.error : theme.primary)
  return (
    <Show when={props.toast()}>
      <box position="absolute" right={1} top={1} zIndex={6000}>
        <box
          border
          borderStyle="rounded"
          borderColor={color()}
          backgroundColor={color()}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={theme.text}>
            {props.toast()!.text}
          </text>
        </box>
      </box>
    </Show>
  )
}
