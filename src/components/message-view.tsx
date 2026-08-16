import type { ChatMessage } from "../session"
import { theme } from "../theme"

export function MessageView(props: { message: ChatMessage }) {
  const isUser = props.message.role === "user"
  return (
    <box flexDirection="column" paddingBottom={1}>
      <text fg={isUser ? theme.primary : theme.secondary}>
        <b>{isUser ? "user" : "DeepSeek"}</b>
      </text>
      <text fg={theme.text}>{props.message.content}</text>
    </box>
  )
}
