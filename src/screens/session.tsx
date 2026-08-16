import { For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Footer } from "../components/footer"
import { MessageView } from "../components/message-view"
import { Prompt } from "../components/prompt"
import { Thinking } from "../components/thinking"
import { Toast, type ToastMessage } from "../components/toast"
import type { PermissionMode } from "../permission"
import type { ChatMessage } from "../session"
import { theme } from "../theme"

export function SessionScreen(props: {
  title: () => string
  messages: () => ChatMessage[]
  busy: () => boolean
  mode: () => PermissionMode
  model: () => string
  toast: () => ToastMessage | null
  onSend: (text: string) => void
  onBack: () => void
  visible?: boolean
  active?: () => boolean
}) {
  useKeyboard((key) => {
    if ((props.active?.() ?? true) && key.name === "escape") props.onBack()
  })

  return (
    <box
      position="relative"
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.background}
      visible={props.visible ?? true}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        border={["bottom"]}
        borderColor={theme.borderSubtle}
        flexShrink={0}
      >
        <text fg={theme.text}>
          <b>{props.title()}</b>
        </text>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>esc 返回</text>
          <text fg={theme.text}>{props.model()}</text>
        </box>
      </box>

      <scrollbox
        flexGrow={1}
        minHeight={0}
        width="100%"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
      >
        <Show
          when={props.messages().length > 0}
          fallback={
            <box height="100%" alignItems="center" justifyContent="center">
              <text fg={theme.textMuted}>发送消息开始对话</text>
            </box>
          }
        >
          <For each={props.messages()}>{(message) => <MessageView message={message} />}</For>
          {props.busy() ? <Thinking /> : null}
        </Show>
      </scrollbox>

      <box
        width="100%"
        flexDirection="row"
        justifyContent="center"
        paddingTop={1}
        paddingBottom={1}
        flexShrink={0}
      >
        <box width="100%" maxWidth={75}>
          <Prompt
            mode={props.mode}
            model={props.model}
            onSubmit={(text) => props.onSend(text)}
            active={props.active}
            inputId="session-prompt-input"
          />
        </box>
      </box>

      <Footer />
      <Toast toast={props.toast} />
    </box>
  )
}
