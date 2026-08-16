import type { ChatMessage } from "../session"
import { theme } from "../theme"

export function MessageView(props: { message: ChatMessage }) {
  return (
    <box paddingBottom={1}>
      <text fg={theme.text}>{props.message.content}</text>
    </box>
  )
}
