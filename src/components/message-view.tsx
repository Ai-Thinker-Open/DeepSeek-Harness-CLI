import type { ChatMessage } from "../session"
import { theme } from "../theme"

export function MessageView(props: { message: ChatMessage }) {
  if (props.message.role === "user") {
    return (
      <box backgroundColor={theme.backgroundPanel} flexDirection="row" marginBottom={1}>
        <box width={2} backgroundColor={theme.primary} flexShrink={0} />
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexGrow={1} minWidth={0}>
          <text fg={theme.text}>{props.message.content}</text>
        </box>
      </box>
    )
  }
  return (
    <box paddingBottom={1}>
      <text fg={theme.text}>{props.message.content}</text>
    </box>
  )
}
