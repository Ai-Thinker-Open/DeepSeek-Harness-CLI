import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { theme } from "../theme"
import { SHINE_STOPS, SWEEP_STEP_MS, shineSpans } from "./shine-text"

const LIGHT_COUNT = 4
const LIGHTS = Array.from({ length: LIGHT_COUNT }, (_, i) => i)

/**
 * Busy status row. While `animated` is true, the text is followed by a
 * chasing-lights ("流水灯") animation: one bright light cycles through a row
 * of hollow lights, like an LED sweep. The status text itself is rendered in
 * the brand blue with a bright highlight band sweeping left → right over it
 * ("反光"), so the whole row reads as an active sweep.
 */
export function StatusMarquee(props: { text: string; animated?: boolean }) {
  const [tick, setTick] = createSignal(0)
  let timer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (props.animated) {
      if (!timer) timer = setInterval(() => setTick((t) => t + 1), SWEEP_STEP_MS)
    } else if (timer) {
      clearInterval(timer)
      timer = undefined
      setTick(0)
    }
  })

  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  const lightPos = () => Math.floor(tick() / 2) % LIGHT_COUNT
  /** Text chars with the moving shine band; base is brand blue. */
  const spans = () => shineSpans(props.text, tick())

  return (
    <Show when={props.animated} fallback={<text fg={theme.textMuted}>{props.text}</text>}>
      <box flexDirection="row">
        <text>
          <For each={spans()}>{(s) => <span style={{ fg: s.fg }}>{s.ch}</span>}</For>
        </text>
        <text fg={theme.textMuted}> </text>
        <For each={LIGHTS}>
          {(i) => (
            <text fg={i === lightPos() ? theme.accent : theme.textMuted}>
              {i === lightPos() ? "●" : "○"}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}
