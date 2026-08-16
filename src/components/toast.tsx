import { Show } from "solid-js"
import { theme } from "../theme"

export type ToastMessage = { text: string; kind: "success" | "error" }

export function Toast(props: { toast: () => ToastMessage | null }) {
  return (
    <Show when={props.toast()}>
      <box position="absolute" left={0} right={0} bottom={3} justifyContent="center" zIndex={6000}>
        <box
          backgroundColor={theme.backgroundPanel}
          border
          borderColor={props.toast()!.kind === "error" ? theme.error : theme.primary}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
        >
          <text fg={props.toast()!.kind === "error" ? theme.error : theme.primary}>
            {props.toast()!.text}
          </text>
        </box>
      </box>
    </Show>
  )
}
