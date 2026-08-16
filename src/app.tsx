import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid"
import { copySelection } from "./clipboard"
import { Toast, type ToastMessage } from "./components/toast"
import { createHarnessSession } from "./harness/session"
import type { HarnessClientLike } from "./harness/client"
import { nextMode, type PermissionMode } from "./permission"
import { Home } from "./screens/home"
import { SessionScreen } from "./screens/session"

export function App(props: { client?: HarnessClientLike } = {}) {
  const renderer = useRenderer()
  const [mode, setMode] = createSignal<PermissionMode>("workspace-write")
  const [toast, setToast] = createSignal<ToastMessage | null>(null)
  const [screen, setScreen] = createSignal<"home" | "session">("home")
  const session = createHarnessSession(props.client)
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const showToast = (text: string, kind: ToastMessage["kind"] = "success") => {
    setToast({ text, kind })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(null), 1800)
  }

  onCleanup(() => {
    if (toastTimer) clearTimeout(toastTimer)
    session.dispose()
  })

  useKeyboard((key) => {
    if (session.question()) return
    if (key.name === "tab") {
      setMode((current) => nextMode(current, key.shift))
    }
  })

  useSelectionHandler((selection) => {
    const result = copySelection(renderer, selection.getSelectedText())
    if (result === "ok") showToast("✓ 已复制到剪贴板")
    else if (result === "unsupported") showToast("✕ 终端不支持复制", "error")
  })

  createEffect(() => {
    const err = session.error()
    if (err) {
      showToast(err, "error")
      session.clearError()
    }
  })

  const handleSubmit = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (screen() === "home") {
      const ok = await session.start(trimmed)
      if (!ok) return
      setScreen("session")
    } else {
      await session.send(trimmed)
    }
  }

  return (
    <box position="relative" width="100%" height="100%">
      <Show when={screen() === "home"}>
        <box position="absolute" left={0} top={0} width="100%" height="100%">
          <Home
            mode={mode}
            model={session.modelName}
            toast={toast}
            onSubmit={handleSubmit}
            stream={session.streamInfo}
            motion
            active={() => true}
          />
        </box>
      </Show>
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        visible={screen() === "session"}
      >
        <SessionScreen
          messages={session.messages}
          mode={mode}
          model={session.modelName}
          toast={toast}
          stats={session.stats}
          statusText={session.statusText}
          question={session.question}
          onSend={handleSubmit}
          onBack={() => setScreen("home")}
          onQuestion={session.answer}
          stream={session.streamInfo}
          active={() => screen() === "session"}
        />
      </box>
    </box>
  )
}
