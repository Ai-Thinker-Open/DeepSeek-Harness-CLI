import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { theme } from "../theme"

const LIGHT_COUNT = 4
const STEP_MS = 200
const LIGHTS = Array.from({ length: LIGHT_COUNT }, (_, i) => i)

/**
 * Busy status row. While `animated` is true, the text is followed by a
 * chasing-lights ("流水灯") animation: one bright light cycles through a
 * row of hollow lights, like an LED sweep.
 */
export function StatusMarquee(props: { text: string; animated?: boolean }) {
  const [pos, setPos] = createSignal(0)
  let timer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (props.animated) {
      if (!timer) timer = setInterval(() => setPos((p) => (p + 1) % LIGHT_COUNT), STEP_MS)
    } else if (timer) {
      clearInterval(timer)
      timer = undefined
      setPos(0)
    }
  })

  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  return (
    <Show when={props.animated} fallback={<text fg={theme.textMuted}>{props.text}</text>}>
      <box flexDirection="row">
        <text fg={theme.textMuted}>{props.text}</text>
        <text fg={theme.textMuted}> </text>
        <For each={LIGHTS}>
          {(i) => (
            <text fg={i === pos() ? theme.primary : theme.textMuted}>{i === pos() ? "●" : "○"}</text>
          )}
        </For>
      </box>
    </Show>
  )
}
