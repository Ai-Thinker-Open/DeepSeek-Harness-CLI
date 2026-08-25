import { For, createEffect, createSignal, onCleanup } from "solid-js"
import { RGBA } from "@opentui/core"
import { theme, tint } from "../theme"

/** Shine sweep cadence; the highlight band advances every tick. */
export const SWEEP_STEP_MS = 110
/** Width of the moving highlight band sweeping left → right over the text. */
export const SHINE_WIDTH = 4
/** Per-position brightness of the band: head brightest, tail fades out. */
export const SHINE_STOPS = [0.55, 0.34, 0.18, 0.08]

export interface ShineChar {
  ch: string
  fg: RGBA
}

/**
 * Per-character colors for the "Deep Diving" shine sweep: a bright band
 * travels left → right over `text` while the rest keeps `base`.
 */
export function shineSpans(text: string, tick: number, base: RGBA = theme.primary): ShineChar[] {
  const total = text.length + SHINE_WIDTH
  const start = tick % total
  return text.split("").map((ch, i) => {
    const dist = (i - start + total) % total
    if (dist >= SHINE_WIDTH) return { ch, fg: base }
    return { ch, fg: tint(base, theme.text, SHINE_STOPS[dist] ?? 0) }
  })
}

/**
 * Span-only self-animating sweep (no `<text>` wrapper), so it can be nested
 * inside another text node without violating TextNode's string-only children.
 */
export function ShineSpans(props: { text: string; base?: RGBA }) {
  const [tick, setTick] = createSignal(0)

  createEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), SWEEP_STEP_MS)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <For each={shineSpans(props.text, tick(), props.base)}>
      {(s) => <span style={{ fg: s.fg }}>{s.ch}</span>}
    </For>
  )
}

/** A self-animating text: the sweep band keeps rolling over the letters. */
export function ShineText(props: { text: string; base?: RGBA }) {
  return (
    <text>
      <ShineSpans text={props.text} base={props.base} />
    </text>
  )
}
