import type { ChatMessage } from "../session"
import { theme } from "../theme"

export function MessageView(props: { message: ChatMessage }) {
  if (props.message.role === "user") {
    return (
      <box
        border={["left"]}
        borderColor={theme.primary}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        marginBottom={1}
      >
        <text fg={theme.text}>{props.message.content}</text>
      </box>
    )
  }
  return (
    <box paddingBottom={1}>
      <text fg={theme.text}>{props.message.content}</text>
    </box>
  )
}
