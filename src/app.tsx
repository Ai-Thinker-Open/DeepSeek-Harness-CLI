import { createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { nextMode, type PermissionMode } from "./permission"
import { Home } from "./screens/home"

export function App() {
  const [mode, setMode] = createSignal<PermissionMode>("workspace-write")

  useKeyboard((key) => {
    if (key.name === "tab") {
      setMode((current) => nextMode(current, key.shift))
    }
  })

  return <Home mode={mode} />
}
