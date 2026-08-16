import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { modeLabel, type PermissionMode } from "../permission"
import { theme } from "../theme"

const NORMAL = ["帮我实现一个 TODO 应用", "排查这个报错的原因", "为这个模块写一组测试"]
const SHELL = ["ls -la", "git status --short", "pwd"]

export function Prompt(props: {
  onSubmit?: (text: string) => void
  mode?: () => PermissionMode
  model?: () => string
  active?: () => boolean
  inputId?: string
} = {}) {
  const [value, setValue] = createSignal("")
  const [idx, setIdx] = createSignal(0)
  const mode = props.mode ?? (() => "workspace-write" as PermissionMode)
  const model = props.model ?? (() => "DeepSeek-V4-Flash")
  const active = props.active ?? (() => true)
  let ref: TextareaRenderable | undefined

  createEffect(() => {
    if (active()) ref?.focus()
  })

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
    <box backgroundColor={theme.backgroundPanel} flexDirection="row">
      <box width={1} backgroundColor={theme.primary} flexShrink={0} />
      <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexGrow={1} minWidth={0}>
        <textarea
          id={props.inputId ?? "prompt-input"}
          ref={(el) => (ref = el)}
          initialValue=""
          placeholder={placeholder()}
          minHeight={1}
          maxHeight={5}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "linefeed", action: "submit" },
            { name: "return", meta: true, action: "newline" },
          ]}
          textColor={theme.text}
          placeholderColor={theme.textMuted}
          cursorColor={theme.primary}
          onContentChange={(next) => {
            setValue(next as string)
          }}
          onSubmit={submit}
        />
        <box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <text>
            <span style={{ fg: theme.primary }}>{modeLabel(mode())}</span>
          </text>
          <text fg={theme.text}>{model()}</text>
        </box>
      </box>
    </box>
  )
}
