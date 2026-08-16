import { createSignal, onCleanup } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid"
import { copySelection } from "./clipboard"
import { Toast, type ToastMessage } from "./components/toast"
import { nextMode, type PermissionMode } from "./permission"
import { Home } from "./screens/home"
import { SessionScreen } from "./screens/session"
import type { ChatMessage } from "./session"

const REPLY_DELAY_MS = 700

export function App() {
  const renderer = useRenderer()
  const [mode, setMode] = createSignal<PermissionMode>("workspace-write")
  const [model, setModel] = createSignal("DeepSeek-V4-Flash")
  const [toast, setToast] = createSignal<ToastMessage | null>(null)
  const [screen, setScreen] = createSignal<"home" | "session">("home")
  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [title, setTitle] = createSignal("新会话")
  const [busy, setBusy] = createSignal(false)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let replyTimer: ReturnType<typeof setTimeout> | undefined
  let messageId = 0

  const nextId = () => `m${++messageId}`

  const showToast = (text: string, kind: ToastMessage["kind"] = "success") => {
    setToast({ text, kind })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(null), 1800)
  }

  onCleanup(() => {
    if (toastTimer) clearTimeout(toastTimer)
    if (replyTimer) clearTimeout(replyTimer)
  })

  useKeyboard((key) => {
    if (key.name === "tab") {
      setMode((current) => nextMode(current, key.shift))
    }
  })

  useSelectionHandler((selection) => {
    const result = copySelection(renderer, selection.getSelectedText())
    if (result === "ok") showToast("✓ 已复制到剪贴板")
    else if (result === "unsupported") showToast("✕ 终端不支持复制", "error")
  })

  const simulateReply = (text: string) => {
    setBusy(true)
    replyTimer = setTimeout(() => {
      setMessages((list) => [
        ...list,
        {
          id: nextId(),
          role: "assistant",
          content: `已收到：“${text}”。这是演示回复，接入 Agent 后端后会在这里显示真实输出。`,
        },
      ])
      setBusy(false)
    }, REPLY_DELAY_MS)
  }

  const handleSubmit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy()) return
    if (screen() === "home") {
      if (replyTimer) clearTimeout(replyTimer)
      setBusy(false)
      setTitle(trimmed.length > 16 ? `${trimmed.slice(0, 16)}…` : trimmed)
      setMessages([])
      setScreen("session")
    } else {
      setMessages((list) => [...list, { id: nextId(), role: "user", content: trimmed }])
      simulateReply(trimmed)
    }
  }

  return (
    <box position="relative" width="100%" height="100%">
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        visible={screen() === "home"}
      >
        <Home
          mode={mode}
          model={model}
          toast={toast}
          onSubmit={handleSubmit}
          motion={screen() === "home"}
          active={() => screen() === "home"}
        />
      </box>
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        visible={screen() === "session"}
      >
        <SessionScreen
          title={title}
          messages={messages}
          busy={busy}
          mode={mode}
          model={model}
          toast={toast}
          onSend={handleSubmit}
          onBack={() => setScreen("home")}
          active={() => screen() === "session"}
        />
      </box>
    </box>
  )
}
