import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { theme } from "../theme"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function StartupLoading(props: { ready: () => boolean }) {
  const [frame, setFrame] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => setFrame((i) => (i + 1) % FRAMES.length), 80)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={!props.ready()}>
      <box position="absolute" zIndex={5000} left={0} right={0} bottom={1} justifyContent="center">
        <box backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>
            {FRAMES[frame()]} Starting DeepSeek Harness…
          </text>
        </box>
      </box>
    </Show>
  )
}
