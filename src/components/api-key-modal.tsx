import { Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { theme } from "../theme"

/**
 * Startup gate for a missing DeepSeek API key. The input is masked: the
 * OpenTUI input buffer is re-rendered as bullets after every edit, and the
 * real characters are recovered by diffing the reported buffer (typing at
 * the end, backspace and paste all round-trip; mid-line edits keep only the
 * non-bullet characters, which is fine for pasting a key).
 */
export function ApiKeyModal(props: {
  open: () => boolean
  onSave: (value: string) => Promise<boolean>
  onDone: (saved: boolean) => void
}) {
  const [real, setReal] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  const display = () => "•".repeat(real().length)

  const handleInput = (next: string) => {
    setError(null)
    const current = display()
    if (next === current) return
    if (next.startsWith(current)) {
      // Typed or pasted at the end: the appended segment is the real text.
      setReal(real() + next.slice(current.length))
    } else if (current.startsWith(next)) {
      // Backspace / delete: shrink the real value to the remaining length.
      setReal(real().slice(0, next.length))
    } else {
      // Wholesale replacement (e.g. paste over the selection): keep real chars.
      setReal(next.replace(/•/g, ""))
    }
  }

  const confirm = async () => {
    if (busy()) return
    const trimmed = real().trim()
    if (!trimmed) {
      setError("API Key 不能为空")
      return
    }
    setBusy(true)
    setError(null)
    const ok = await props.onSave(trimmed)
    setBusy(false)
    if (ok) {
      props.onDone(true)
    } else {
      setError("保存失败，请检查 harness 连接后重试")
    }
  }

  useKeyboard((key) => {
    if (!props.open()) return
    if (key.name === "return" || key.name === "enter") {
      key.preventDefault?.()
      void confirm()
    } else if (key.name === "escape") {
      props.onDone(false)
    }
  })

  return (
    <Show when={props.open()}>
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        zIndex={8100}
        alignItems="center"
        justifyContent="center"
        backgroundColor={theme.background}
      >
        <box
          width={72}
          border
          borderColor={theme.accent}
          backgroundColor={theme.backgroundPanel}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
        >
          <text fg={theme.accent}>
            <b>🔑 DeepSeek API Key</b>
          </text>
          <text fg={theme.text} wrapMode="char">
            未检测到 DEEPSEEK_API_KEY，请输入你的 DeepSeek API Key 以继续。
          </text>
          <box marginTop={1} marginBottom={1}>
            <input
              focused
              value={display()}
              placeholder="请输入DeepSeek API Key"
              placeholderColor={theme.textMuted}
              maxLength={256}
              onInput={handleInput}
              onSubmit={() => void confirm()}
            />
          </box>
          <Show when={error()}>
            <text fg={theme.error}>{error()}</text>
          </Show>
          <text fg={theme.textMuted}>{busy() ? "保存中…" : "Enter 保存 · Esc 跳过"}</text>
        </box>
      </box>
    </Show>
  )
}
