// @ts-nocheck
import { createSignal, For } from 'solid-js'
import { useKeyboard } from '@opentui/solid'
import type { OpenCodeQuestion } from '@dsh/core'

export function QuestionDialog(props: {
  question: OpenCodeQuestion
  onAnswer: (option: string) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = createSignal(0)

  useKeyboard((key) => {
    if (key.name === 'up') {
      setSelected((index) => Math.max(0, index - 1))
    } else if (key.name === 'down') {
      setSelected((index) => Math.min(props.question.options.length - 1, index + 1))
    } else if (key.name === 'return') {
      props.onAnswer(props.question.options[selected()] as string)
    } else if (key.name === 'escape') {
      props.onCancel()
    }
  })

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
          {props.question.kind === 'permission'
            ? 'Permission'
            : props.question.kind === 'plan-approval'
              ? 'Plan review'
              : 'Question'}
        </text>
        <text fg="#E4E4E7" bold>
          {props.question.title}
        </text>
        {props.question.body ? (
          <text fg="#A1A1AA" wrapMode="word">
            {props.question.body}
          </text>
        ) : null}
        <For each={props.question.options}>
          {(option, index) => (
            <text
              fg={index() === selected() ? '#111111' : '#A1A1AA'}
              backgroundColor={index() === selected() ? '#FF7A1A' : undefined}
              onMouseUp={() => props.onAnswer(option)}
            >
              {index() === selected() ? '› ' : '  '}
              {option}
            </text>
          )}
        </For>
        <text fg="#6B7280">Esc cancel</text>
      </box>
    </box>
  )
}
