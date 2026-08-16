import { createSignal, onCleanup } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid"
import { copySelection } from "./clipboard"
import { Toast, type ToastMessage } from "./components/toast"
import { nextMode, type PermissionMode } from "./permission"
import { Home } from "./screens/home"

export function App() {
  const renderer = useRenderer()
  const [mode, setMode] = createSignal<PermissionMode>("workspace-write")
  const [model, setModel] = createSignal("deepseek-v4-flash")
  const [toast, setToast] = createSignal<ToastMessage | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const showToast = (text: string, kind: ToastMessage["kind"] = "success") => {
    setToast({ text, kind })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(null), 1800)
  }

  onCleanup(() => {
    if (toastTimer) clearTimeout(toastTimer)
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

  return <Home mode={mode} model={model} toast={toast} />
}
