import { For, Show, createEffect, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { isDown, isEnter, isUp } from "./key-match"
import type { HarnessQuestion } from "../session"
import { theme } from "../theme"

function truncateBody(body: string, maxChars = 1200, maxLines = 14): string {
  let b = body
  if (b.length > maxChars) b = b.slice(0, maxChars) + "\n… (truncated)"
  const lines = b.split("\n")
  if (lines.length > maxLines) {
    b = lines.slice(0, maxLines).join("\n") + `\n… (${lines.length - maxLines} more lines)`
  }
  return b
}

export function QuestionModal(props: {
  question: () => HarnessQuestion | null
  onAnswer: (choice: string) => void
}) {
  const [sel, setSel] = createSignal(0)

  createEffect(() => {
    void props.question()?.id
    setSel(0)
  })

  useKeyboard((key) => {
    const q = props.question()
    if (!q) return
    if (isUp(key)) setSel((s) => Math.max(0, s - 1))
    else if (isDown(key)) setSel((s) => Math.min(q.options.length - 1, s + 1))
    else if (isEnter(key)) props.onAnswer(q.options[sel()] as string)
    else if (key.name === "escape") props.onAnswer(q.options[q.options.length - 1] as string)
  })

  const q = props.question()
  if (!q) return null
  const kindColor =
    q.kind === "permission"
      ? theme.warning
      : q.kind === "plan-approval"
        ? theme.accent
        : theme.info
  const title =
    q.kind === "permission" ? "🔒 Permission" : q.kind === "plan-approval" ? "📋 Plan review" : "❓ Question"

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      zIndex={8000}
      alignItems="center"
      justifyContent="center"
      backgroundColor={theme.background}
    >
      <box
        width={72}
        border
        borderColor={kindColor}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <text fg={kindColor}>
          <b>{title}</b>
        </text>
        <text fg={theme.text} wrapMode="char">
          {q.title}
        </text>
        <Show when={q.detail}>
          <box flexDirection="column" marginTop={1} marginBottom={1}>
            <For each={truncateBody(q.detail as string).split("\n")}>
              {(line) => (
                <text fg={theme.textMuted} wrapMode="char">
                  {line}
                </text>
              )}
            </For>
          </box>
        </Show>
        <box flexDirection="column" marginTop={1}>
          <For each={q.options}>
            {(option, i) => {
              const active = i() === sel()
              return (
                <box backgroundColor={active ? kindColor : undefined}>
                  <text fg={active ? theme.background : theme.text} wrapMode="char">
                    {active ? "› " : "  "}
                    {option}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
        <text fg={theme.textMuted}>↑↓ 选择 · Enter 确认 · Esc 拒绝</text>
      </box>
    </box>
  )
}
