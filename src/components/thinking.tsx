import { createSignal, onCleanup, onMount } from "solid-js"
import { theme } from "../theme"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Thinking() {
  const [frame, setFrame] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => setFrame((i) => (i + 1) % FRAMES.length), 80)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <text fg={theme.textMuted}>
      {FRAMES[frame()]} DeepSeek 思考中…
    </text>
  )
}
