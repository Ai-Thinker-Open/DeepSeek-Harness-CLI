import { For } from 'solid-js'
import type { OpenCodeSession } from '@dsh/core'

export function SessionListDialog(props: {
  sessions: OpenCodeSession[]
  currentId: string
  selected: number
  onSelect: (session: OpenCodeSession) => void
  onClose: () => void
}) {
  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={72}
        flexDirection="column"
        border="round"
        borderColor="#FF7A1A"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor="#141414"
      >
        <text fg="#FF7A1A" bold>
          sessions
        </text>
        <For each={props.sessions}>
          {(session, index) => (
            <text
              fg={index() === props.selected ? '#111111' : session.id === props.currentId ? '#FF7A1A' : '#A1A1AA'}
              backgroundColor={index() === props.selected ? '#FF7A1A' : undefined}
              onMouseUp={() => props.onSelect(session)}
            >
              {index() === props.selected ? '› ' : session.id === props.currentId ? '● ' : '  '}
              {session.title}
            </text>
          )}
        </For>
        <text fg="#6B7280">↑↓ choose · Enter open · Esc close</text>
      </box>
    </box>
  )
}
