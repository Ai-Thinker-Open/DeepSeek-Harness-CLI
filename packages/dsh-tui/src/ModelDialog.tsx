// @ts-nocheck
import { For } from 'solid-js'
import type { OpenCodeModelOption } from '@dsh/core'

export function ModelDialog(props: {
  models: OpenCodeModelOption[]
  currentModel: string
  selected: number
  onSelect: (model: OpenCodeModelOption) => void
  onClose: () => void
}) {
  return (
    <box position="absolute" width="100%" height="100%" alignItems="center" justifyContent="center">
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
          models
        </text>
        <For each={props.models}>
          {(model, index) => (
            <text
              fg={index() === props.selected ? '#111111' : model.id === props.currentModel ? '#FF7A1A' : '#A1A1AA'}
              backgroundColor={index() === props.selected ? '#FF7A1A' : undefined}
              onMouseUp={() => props.onSelect(model)}
            >
              {index() === props.selected ? '› ' : model.id === props.currentModel ? '● ' : '  '}
              {model.name ?? model.id} <text fg={index() === props.selected ? '#111111' : '#6B7280'}>{model.provider}</text>
            </text>
          )}
        </For>
        <text fg="#6B7280">↑↓ choose · Enter switch · Esc close</text>
      </box>
    </box>
  )
}
