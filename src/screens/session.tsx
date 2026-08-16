import { For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Footer } from "../components/footer"
import { MessageView } from "../components/message-view"
import { Prompt } from "../components/prompt"
import { QuestionModal } from "../components/question-modal"
import { StatsBar } from "../components/stats-bar"
import { Toast, type ToastMessage } from "../components/toast"
import type { PermissionMode } from "../permission"
import type { ChatMessage, HarnessQuestion, SessionStats } from "../session"
import { theme } from "../theme"

export function SessionScreen(props: {
  messages: () => ChatMessage[]
  mode: () => PermissionMode
  model: () => string
  toast: () => ToastMessage | null
  stats: () => SessionStats
  statusText: () => string
  question: () => HarnessQuestion | null
  onSend: (text: string) => void
  onBack: () => void
  onQuestion: (choice: string) => void
  visible?: boolean
  active?: () => boolean
}) {
  useKeyboard((key) => {
    if (props.question()) return
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
      <scrollbox
        flexGrow={1}
        minHeight={0}
        width="100%"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        stickyScroll
        stickyStart="bottom"
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
        </Show>
      </scrollbox>

      <Show when={!props.question()}>
        <box width="100%" paddingLeft={2} paddingRight={2} paddingTop={1} flexShrink={0}>
          <Prompt
            mode={props.mode}
            model={props.model}
            onSubmit={(text) => props.onSend(text)}
            active={props.active}
            inputId="session-prompt-input"
          />
          <StatsBar stats={props.stats} status={props.statusText} />
        </box>
      </Show>

      <Footer />
      <Toast toast={props.toast} />
      <Show when={props.question()}>
        <QuestionModal question={props.question} onAnswer={props.onQuestion} />
      </Show>
    </box>
  )
}
