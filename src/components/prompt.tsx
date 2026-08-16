import { createSignal, onCleanup, onMount } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { theme } from "../theme"

const NORMAL = ["帮我实现一个 TODO 应用", "排查这个报错的原因", "为这个模块写一组测试"]
const SHELL = ["ls -la", "git status --short", "pwd"]

export function Prompt(props: { onSubmit?: (text: string) => void } = {}) {
  const [value, setValue] = createSignal("")
  const [idx, setIdx] = createSignal(0)
  let ref: TextareaRenderable | undefined

  onMount(() => {
    const timer = setInterval(() => setIdx((i) => (i + 1) % Math.max(1, NORMAL.length)), 4000)
    onCleanup(() => clearInterval(timer))
  })

  const placeholder = () => SHELL[idx() % SHELL.length]

  const submit = () => {
    const text = (ref?.plainText ?? value()).trim()
    ref?.clear()
    setValue("")
    if (text) props.onSubmit?.(text)
  }

  return (
    <box
      border={["left"]}
      borderColor={theme.primary}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <textarea
        ref={(el) => (ref = el)}
        initialValue=""
        placeholder={placeholder()}
        minHeight={1}
        maxHeight={5}
        textColor={theme.text}
        placeholderColor={theme.textMuted}
        cursorColor={theme.primary}
        onContentChange={(next) => {
          setValue(next as string)
        }}
        onSubmit={submit}
      />
      <box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <text fg={theme.textMuted}>Enter 发送 · Ctrl+C 退出</text>
        <text fg={theme.textMuted}>$ DeepSeek Harness</text>
      </box>
    </box>
  )
}
