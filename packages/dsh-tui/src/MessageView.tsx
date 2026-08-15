import { For, Show } from 'solid-js'
import type { OpenCodeMessage, OpenCodePart } from '@dsh/core'

export function MessageView(props: { message: OpenCodeMessage; parts: OpenCodePart[] }) {
  const roleColor = props.message.role === 'user' ? '#4ADE80' : '#8B9EFF'

  return (
    <box flexDirection="column" marginTop={1} border="left" borderColor={roleColor} paddingLeft={2}>
      <text fg={roleColor} bold>
        {props.message.role === 'user' ? 'you' : 'dsh'}
      </text>
      <For each={props.parts}>
        {(part) => (
          <Show
            when={part.type === 'text'}
            fallback={
              part.type === 'reasoning' ? (
                <box flexDirection="column" paddingLeft={1}>
                  <text fg="#6B7280">✢ reasoning</text>
                  <text fg="#9CA3AF" wrapMode="word">
                    {part.text}
                  </text>
                </box>
              ) : (
                <box
                  flexDirection="column"
                  border="left"
                  borderColor="#9CA3AF"
                  backgroundColor="#141414"
                  paddingLeft={2}
                  paddingTop={1}
                  paddingBottom={1}
                  marginTop={0}
                >
                  <text fg="#9CA3AF" bold>
                    · {part.tool}
                  </text>
                  <text fg="#A1A1AA">
                    {part.state.status === 'running'
                      ? 'running…'
                      : part.state.status === 'error'
                        ? 'error'
                        : 'completed'}
                  </text>
                  <Show when={part.state.output}>
                    <text fg="#A1A1AA" wrapMode="word">
                      {part.state.output}
                    </text>
                  </Show>
                </box>
              )
            }
          >
            <text fg="#E4E4E7" wrapMode="word">
              {part.text}
            </text>
          </Show>
        )}
      </For>
    </box>
  )
}
