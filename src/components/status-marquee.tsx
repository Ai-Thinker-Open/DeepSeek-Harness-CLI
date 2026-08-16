import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { theme, tint } from "../theme"

const LIGHT_COUNT = 4
const LIGHTS = Array.from({ length: LIGHT_COUNT }, (_, i) => i)
/** Shine sweep cadence; the light dots advance every other tick. */
const SWEEP_STEP_MS = 110
/** Width of the moving highlight band sweeping left → right over the text. */
const SHINE_WIDTH = 4
/** Per-position brightness of the band: head brightest, tail fades out. */
const SHINE_STOPS = [0.55, 0.34, 0.18, 0.08]

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
  const spans = () => {
    const t = props.text
    if (!t) return []
    const total = t.length + SHINE_WIDTH
    const start = tick() % total
    return t.split("").map((ch, i) => {
      const dist = (i - start + total) % total
      if (dist >= SHINE_WIDTH) return { ch, fg: theme.primary }
      return { ch, fg: tint(theme.primary, theme.text, SHINE_STOPS[dist] ?? 0) }
    })
  }

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
