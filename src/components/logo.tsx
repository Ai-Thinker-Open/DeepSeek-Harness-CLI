// @ts-nocheck
import { BoxRenderable, MouseButton, RGBA, TextAttributes } from "@opentui/core"
import { For, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { tint, useTheme } from "../theme"
import { Sound } from "../util/sound"

const GAP = 1
const WIDTH = 0.76
const GAIN = 2.3
const FLASH = 2.15
const TRAIL = 0.28
const SWELL = 0.24
const WIDE = 1.85
const DRIFT = 1.45
const EXPAND = 1.62
const LIFE = 1020
const CHARGE = 3000
const HOLD = 90
const SINK = 40
const ARC = 2.2
const FORK = 1.2
const DIM = 1.04
const KICK = 0.86
const LAG = 60
const SUCK = 0.34
const SHIMMER_IN = 60
const SHIMMER_OUT = 2.8
const TRACE = 0.033
const TAIL = 1.8
const TRACE_IN = 200
const GLOW_OUT = 1600
/** Smooth cadence while an interaction or the periodic sweep is in flight. */
const ACTIVE_TICK_MS = 16
const SWEEP_INTERVAL = 10000
const SWEEP_DURATION = 1900
const SWEEP_BAND = 4.5
const SWEEP_AMP = 1.5
const PEAK = RGBA.fromInts(255, 255, 255)

const BRAND_BLUE = RGBA.fromInts(77, 107, 254)

type ShimmerConfig = {
  period: number
  rings: number
  sweepFraction: number
  coreWidth: number
  coreAmp: number
  softWidth: number
  softAmp: number
  tail: number
  tailAmp: number
  haloWidth: number
  haloOffset: number
  haloAmp: number
  breathBase: number
  noise: number
  ambientAmp: number
  ambientCenter: number
  ambientWidth: number
  shadowMix: number
  primaryMix: number
  originX: number
  originY: number
}

const shimmerConfig: ShimmerConfig = {
  period: 4600,
  rings: 2,
  sweepFraction: 1,
  coreWidth: 1.2,
  coreAmp: 1.9,
  softWidth: 10,
  softAmp: 1.6,
  tail: 5,
  tailAmp: 0.64,
  haloWidth: 4.3,
  haloOffset: 0.6,
  haloAmp: 0.16,
  breathBase: 0.04,
  noise: 0.1,
  ambientAmp: 0.36,
  ambientCenter: 0.5,
  ambientWidth: 0.34,
  shadowMix: 0.1,
  primaryMix: 0.3,
  originX: 4.5,
  originY: 13.5,
}

type Ring = { x: number; y: number; at: number; force: number; kick: number }
type Hold = { x: number; y: number; at: number; glyph: number | undefined }
type Release = { x: number; y: number; at: number; glyph: number | undefined; level: number; rise: number }
type Glow = { glyph: number; at: number; force: number }
type Sweep = { at: number }

type Frame = {
  t: number
  list: Ring[]
  hold: Hold | undefined
  release: Release | undefined
  glow: Glow | undefined
  spark: number
  sweep: Sweep | undefined
}

const NEAR = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const

type Trace = { glyph: number; i: number; l: number }

function clamp(n: number) {
  return Math.max(0, Math.min(1, n))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t)
}

function ease(t: number) {
  const p = clamp(t)
  return p * p * (3 - 2 * p)
}

function push(t: number) {
  const p = clamp(t)
  return ease(p * p)
}

function ramp(t: number, start: number, end: number) {
  if (end <= start) return ease(t >= end ? 1 : 0)
  return ease((t - start) / (end - start))
}

function glow(base: RGBA, theme: ReturnType<typeof useTheme>["theme"], n: number) {
  const mid = tint(base, theme.primary, 0.84)
  const top = tint(theme.primary, PEAK, 0.96)
  if (n <= 1) return tint(base, mid, Math.min(1, Math.sqrt(Math.max(0, n)) * 1.14))
  return tint(mid, top, Math.min(1, 1 - Math.exp(-2.4 * (n - 1))))
}

function shade(base: RGBA, theme: ReturnType<typeof useTheme>["theme"], n: number) {
  if (n >= 0) return glow(base, theme, n)
  return tint(base, theme.background, Math.min(0.82, -n * 0.64))
}

function ghost(n: number, scale: number) {
  if (n < 0) return n
  return n * scale
}

function noise(x: number, y: number, t: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + t * 0.043) * 43758.5453
  return n - Math.floor(n)
}

function lit(char: string) {
  return char !== " " && char !== "_" && char !== "~" && char !== ","
}

function key(x: number, y: number) {
  return `${x},${y}`
}

function route(list: Array<{ x: number; y: number }>) {
  const left = new Map(list.map((item) => [key(item.x, item.y), item]))
  const path: Array<{ x: number; y: number }> = []
  let cur = [...left.values()].sort((a, b) => a.y - b.y || a.x - b.x)[0]
  let dir = { x: 1, y: 0 }

  while (cur) {
    path.push(cur)
    left.delete(key(cur.x, cur.y))
    if (!left.size) return path

    const next = NEAR.map(([dx, dy]) => left.get(key(cur.x + dx, cur.y + dy)))
      .filter((item): item is { x: number; y: number } => !!item)
      .sort((a, b) => {
        const ax = a.x - cur.x
        const ay = a.y - cur.y
        const bx = b.x - cur.x
        const by = b.y - cur.y
        const adot = ax * dir.x + ay * dir.y
        const bdot = bx * dir.x + by * dir.y
        if (adot !== bdot) return bdot - adot
        return Math.abs(ax) + Math.abs(ay) - (Math.abs(bx) + Math.abs(by))
      })[0]

    if (!next) {
      cur = [...left.values()].sort((a, b) => {
        const da = (a.x - cur.x) ** 2 + (a.y - cur.y) ** 2
        const db = (b.x - cur.x) ** 2 + (b.y - cur.y) ** 2
        return da - db
      })[0]
      dir = { x: 1, y: 0 }
      continue
    }

    dir = { x: next.x - cur.x, y: next.y - cur.y }
    cur = next
  }

  return path
}

function mapGlyphs(full: string[]) {
  const cells = [] as Array<{ x: number; y: number }>

  for (let y = 0; y < full.length; y++) {
    for (let x = 0; x < (full[y]?.length ?? 0); x++) {
      if (lit(full[y]?.[x] ?? " ")) cells.push({ x, y })
    }
  }

  const all = new Map(cells.map((item) => [key(item.x, item.y), item]))
  const seen = new Set<string>()
  const glyph = new Map<string, number>()
  const trace = new Map<string, Trace>()
  const center = new Map<number, { x: number; y: number }>()
  let id = 0

  for (const item of cells) {
    const start = key(item.x, item.y)
    if (seen.has(start)) continue
    const stack = [item]
    const part = [] as Array<{ x: number; y: number }>
    seen.add(start)

    while (stack.length) {
      const cur = stack.pop()!
      part.push(cur)
      glyph.set(key(cur.x, cur.y), id)
      for (const [dx, dy] of NEAR) {
        const next = all.get(key(cur.x + dx, cur.y + dy))
        if (!next) continue
        const mark = key(next.x, next.y)
        if (seen.has(mark)) continue
        seen.add(mark)
        stack.push(next)
      }
    }

    const path = route(part)
    path.forEach((cell, i) => trace.set(key(cell.x, cell.y), { glyph: id, i, l: path.length }))
    center.set(id, {
      x: part.reduce((sum, item) => sum + item.x, 0) / part.length + 0.5,
      y: (part.reduce((sum, item) => sum + item.y, 0) / part.length) * 2 + 1,
    })
    id++
  }

  return { glyph, trace, center }
}

type LogoContext = { FULL: string[]; SPAN: number; MAP: ReturnType<typeof mapGlyphs> }

function build(art: string[]): LogoContext {
  const FULL = art
  const SPAN = Math.hypot(FULL[0]?.length ?? 0, FULL.length * 2) * 0.94
  return { FULL, SPAN, MAP: mapGlyphs(FULL) }
}

function shimmer(x: number, y: number, frame: Frame, ctx: LogoContext) {
  return frame.list.reduce((best, item) => {
    const age = frame.t - item.at
    if (age < SHIMMER_IN || age > LIFE) return best
    const dx = x + 0.5 - item.x
    const dy = y * 2 + 1 - item.y
    const dist = Math.hypot(dx, dy)
    const p = age / LIFE
    const r = ctx.SPAN * (1 - (1 - p) ** EXPAND)
    const lag = r - dist
    if (lag < 0.18 || lag > SHIMMER_OUT) return best
    const band = Math.exp(-(((lag - 1.05) / 0.68) ** 2))
    const wobble = 0.5 + 0.5 * Math.sin(frame.t * 0.035 + x * 0.9 + y * 1.7)
    const n = band * wobble * (1 - p) ** 1.45
    if (n > best) return n
    return best
  }, 0)
}

function remain(x: number, y: number, item: Release, t: number, ctx: LogoContext) {
  const age = t - item.at
  if (age < 0 || age > LIFE) return 0
  const p = age / LIFE
  const dx = x + 0.5 - item.x - 0.5
  const dy = y * 2 + 1 - item.y * 2 - 1
  const dist = Math.hypot(dx, dy)
  const r = ctx.SPAN * (1 - (1 - p) ** EXPAND)
  if (dist > r) return 1
  return clamp((r - dist) / 1.35 < 1 ? 1 - (r - dist) / 1.35 : 0)
}

function wave(x: number, y: number, frame: Frame, live: boolean, ctx: LogoContext) {
  return frame.list.reduce((sum, item) => {
    const age = frame.t - item.at
    if (age < 0 || age > LIFE) return sum
    const p = age / LIFE
    const dx = x + 0.5 - item.x
    const dy = y * 2 + 1 - item.y
    const dist = Math.hypot(dx, dy)
    const r = ctx.SPAN * (1 - (1 - p) ** EXPAND)
    const fade = (1 - p) ** 1.32
    const j = 1.02 + noise(x + item.x * 0.7, y + item.y * 0.7, item.at * 0.002 + age * 0.06) * 0.52
    const edge = Math.exp(-(((dist - r) / WIDTH) ** 2)) * GAIN * fade * item.force * j
    const swell = Math.exp(-(((dist - Math.max(0, r - DRIFT)) / WIDE) ** 2)) * SWELL * fade * item.force
    const trail = dist < r ? Math.exp(-(r - dist) / 2.4) * TRAIL * fade * item.force * lerp(0.92, 1.22, j) : 0
    const flash = Math.exp(-(dist * dist) / 3.2) * FLASH * item.force * Math.max(0, 1 - age / 140) * lerp(0.95, 1.18, j)
    const kick = Math.exp(-(dist * dist) / 2) * item.kick * Math.max(0, 1 - age / 100)
    const suck = Math.exp(-(((dist - 1.25) / 0.75) ** 2)) * item.kick * SUCK * Math.max(0, 1 - age / 110)
    const wake = live && dist < r ? Math.exp(-(r - dist) / 1.25) * 0.32 * fade : 0
    return sum + edge + swell + trail + flash + wake - kick - suck
  }, 0)
}

function field(x: number, y: number, frame: Frame, ctx: LogoContext) {
  const held = frame.hold
  const rest = frame.release
  const item = held ?? rest
  if (!item) return 0
  const rise = held ? ramp(frame.t - held.at, HOLD, CHARGE) : rest!.rise
  const level = held ? push(rise) : rest!.level
  const body = rise
  const storm = level * level
  const sink = held ? ramp(frame.t - held.at, SINK, CHARGE) : rest!.rise
  const dx = x + 0.5 - item.x - 0.5
  const dy = y * 2 + 1 - item.y * 2 - 1
  const dist = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const spin = frame.t * lerp(0.008, 0.018, storm)
  const dim = lerp(0, DIM, sink) * lerp(0.99, 1.01, 0.5 + 0.5 * Math.sin(frame.t * 0.014))
  const core = Math.exp(-(dist * dist) / Math.max(0.22, lerp(0.22, 3.2, body))) * lerp(0.42, 2.45, body)
  const shell =
    Math.exp(-(((dist - lerp(0.16, 2.05, body)) / Math.max(0.18, lerp(0.18, 0.82, body))) ** 2)) * lerp(0.1, 0.95, body)
  const ember =
    Math.exp(-(((dist - lerp(0.45, 2.65, body)) / Math.max(0.14, lerp(0.14, 0.62, body))) ** 2)) *
    lerp(0.02, 0.78, body)
  const arc = Math.max(0, Math.cos(angle * 3 - spin + frame.spark * 2.2)) ** 8
  const seam = Math.max(0, Math.cos(angle * 5 + spin * 1.55)) ** 12
  const ring = Math.exp(-(((dist - lerp(1.05, 3, level)) / 0.48) ** 2)) * arc * lerp(0.03, 0.5 + ARC, storm)
  const fork = Math.exp(-(((dist - (1.55 + storm * 2.1)) / 0.36) ** 2)) * seam * storm * FORK
  const spark = Math.max(0, noise(x, y, frame.t) - lerp(0.94, 0.66, storm)) * lerp(0, 5.4, storm)
  const glitch = spark * Math.exp(-dist / Math.max(1.2, 3.1 - storm))
  const crack = Math.max(0, Math.cos((dx - dy) * 1.6 + spin * 2.1)) ** 18
  const lash = crack * Math.exp(-(((dist - (1.95 + storm * 2)) / 0.28) ** 2)) * storm * 1.1
  const flicker =
    Math.max(0, noise(item.x * 3.1, item.y * 2.7, frame.t * 1.7) - 0.72) *
    Math.exp(-(dist * dist) / 0.15) *
    lerp(0.08, 0.42, body)
  const fade = frame.release && !frame.hold ? remain(x, y, frame.release, frame.t, ctx) : 1
  return (core + shell + ember + ring + fork + glitch + lash + flicker - dim) * fade
}

function pick(x: number, y: number, frame: Frame, ctx: LogoContext) {
  const held = frame.hold
  const rest = frame.release
  const item = held ?? rest
  if (!item) return 0
  const rise = held ? ramp(frame.t - held.at, HOLD, CHARGE) : rest!.rise
  const dx = x + 0.5 - item.x - 0.5
  const dy = y * 2 + 1 - item.y * 2 - 1
  const dist = Math.hypot(dx, dy)
  const fade = frame.release && !frame.hold ? remain(x, y, frame.release, frame.t, ctx) : 1
  return Math.exp(-(dist * dist) / 1.7) * lerp(0.2, 0.96, rise) * fade
}

function select(x: number, y: number, ctx: LogoContext) {
  const direct = ctx.MAP.glyph.get(key(x, y))
  if (direct !== undefined) return direct

  const near = NEAR.map(([dx, dy]) => ctx.MAP.glyph.get(key(x + dx, y + dy))).find(
    (item): item is number => item !== undefined,
  )
  return near
}

function trace(x: number, y: number, frame: Frame, ctx: LogoContext) {
  const held = frame.hold
  const rest = frame.release
  const item = held ?? rest
  if (!item || item.glyph === undefined) return 0
  const step = ctx.MAP.trace.get(key(x, y))
  if (!step || step.glyph !== item.glyph || step.l < 2) return 0
  const age = frame.t - item.at
  const rise = held ? ramp(age, HOLD, CHARGE) : rest!.rise
  const appear = held ? ramp(age, 0, TRACE_IN) : 1
  const speed = lerp(TRACE * 0.48, TRACE * 0.88, rise)
  const head = (age * speed) % step.l
  const dist = Math.min(Math.abs(step.i - head), step.l - Math.abs(step.i - head))
  const tail = (head - TAIL + step.l) % step.l
  const lag = Math.min(Math.abs(step.i - tail), step.l - Math.abs(step.i - tail))
  const fade = frame.release && !frame.hold ? remain(x, y, frame.release, frame.t, ctx) : 1
  const core = Math.exp(-((dist / 1.05) ** 2)) * lerp(0.8, 2.35, rise)
  const glow = Math.exp(-((dist / 1.85) ** 2)) * lerp(0.08, 0.34, rise)
  const trail = Math.exp(-((lag / 1.45) ** 2)) * lerp(0.04, 0.42, rise)
  return (core + glow + trail) * appear * fade
}

type IdleState = {
  cfg: ShimmerConfig
  reach: number
  rings: number
  active: Array<{ head: number; eased: number; ambient: number }>
}

function idle(x: number, pixelY: number, frame: Frame, ctx: LogoContext, state: IdleState) {
  const cfg = state.cfg
  const dx = x + 0.5 - cfg.originX
  const dy = pixelY - cfg.originY
  const dist = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)
  const wob1 = noise(x * 0.32, pixelY * 0.25, frame.t * 0.0005) - 0.5
  const wob2 = noise(x * 0.12, pixelY * 0.08, frame.t * 0.00022) - 0.5
  const ripple = Math.sin(angle * 3 + frame.t * 0.0012) * 0.3
  const jitter = (wob1 * 0.55 + wob2 * 0.32 + ripple * 0.18) * cfg.noise
  const traveled = dist + jitter
  let glow = 0
  let peak = 0
  let halo = 0
  let primary = 0
  let ambient = 0
  for (const active of state.active) {
    const head = active.head
    const eased = active.eased
    const delta = traveled - head
    const core = Math.exp(-(Math.abs(delta / cfg.coreWidth) ** 1.8))
    const soft = Math.exp(-(Math.abs(delta / cfg.softWidth) ** 1.6))
    const tailRange = cfg.tail * 2.6
    const tail = delta < 0 && delta > -tailRange ? (1 + delta / tailRange) ** 2.6 : 0
    const haloDelta = delta + cfg.haloOffset
    const haloBand = Math.exp(-(Math.abs(haloDelta / cfg.haloWidth) ** 1.6))
    glow += (soft * cfg.softAmp + tail * cfg.tailAmp) * eased
    peak += core * cfg.coreAmp * eased
    halo += haloBand * cfg.haloAmp * eased
    primary += (haloBand + tail * 0.6) * eased
    ambient += active.ambient
  }
  ambient /= state.rings
  return {
    glow: glow / state.rings,
    peak: cfg.breathBase + ambient + (peak + halo) / state.rings,
    primary: (primary / state.rings) * cfg.primaryMix,
  }
}

function bloom(x: number, y: number, frame: Frame, ctx: LogoContext) {
  const item = frame.glow
  if (!item) return 0
  const glyph = ctx.MAP.glyph.get(key(x, y))
  if (glyph !== item.glyph) return 0
  const age = frame.t - item.at
  if (age < 0 || age > GLOW_OUT) return 0
  const p = age / GLOW_OUT
  const flash = (1 - p) ** 2
  const dx = x + 0.5 - ctx.MAP.center.get(item.glyph)!.x
  const dy = y * 2 + 1 - ctx.MAP.center.get(item.glyph)!.y
  const bias = Math.exp(-((Math.hypot(dx, dy) / 2.8) ** 2))
  return lerp(item.force, item.force * 0.18, p) * lerp(0.72, 1.1, bias) * flash
}

function sweepGlow(x: number, y: number, frame: Frame, ctx: LogoContext) {
  const item = frame.sweep
  if (!item) return 0
  const age = frame.t - item.at
  if (age < 0 || age > SWEEP_DURATION) return 0
  const p = age / SWEEP_DURATION
  const width = ctx.FULL[0]?.length ?? 1
  const head = -3 + (width + 6) * ease(p)
  const dx = x + 0.5 - head
  const band = Math.exp(-((dx / SWEEP_BAND) ** 2))
  const core = Math.exp(-((dx / 1.3) ** 2)) * 1.7
  const env = Math.sin(p * Math.PI)
  return (band * 0.7 + core) * env * SWEEP_AMP
}

function buildIdleState(t: number, ctx: LogoContext): IdleState {
  const cfg = shimmerConfig
  const w = ctx.FULL[0]?.length ?? 1
  const h = ctx.FULL.length * 2
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]
  let maxCorner = 0
  for (const [cx, cy] of corners) {
    const d = Math.hypot(cx - cfg.originX, cy - cfg.originY)
    if (d > maxCorner) maxCorner = d
  }
  const reach = maxCorner + cfg.tail * 2
  const rings = Math.max(1, Math.floor(cfg.rings))
  const active = [] as IdleState["active"]
  for (let i = 0; i < rings; i++) {
    const offset = i / rings
    const cyclePhase = (t / cfg.period + offset) % 1
    if (cyclePhase >= cfg.sweepFraction) continue
    const phase = cyclePhase / cfg.sweepFraction
    const envelope = Math.sin(phase * Math.PI)
    const eased = envelope * envelope * (3 - 2 * envelope)
    const d = (phase - cfg.ambientCenter) / cfg.ambientWidth
    active.push({
      head: phase * reach,
      eased,
      ambient: Math.abs(d) < 1 ? (1 - d * d) ** 2 * cfg.ambientAmp : 0,
    })
  }
  return { cfg, reach, rings, active }
}

export function Logo(
  props: { art: string[]; ink?: RGBA; animated?: boolean; idle?: boolean; sweep?: boolean } = {},
) {
  const { theme } = useTheme()
  const ctx = build(props.art)
  const [rings, setRings] = createSignal<Ring[]>([])
  const [hold, setHold] = createSignal<Hold>()
  const [release, setRelease] = createSignal<Release>()
  const [glow, setGlow] = createSignal<Glow>()
  const [sweep, setSweep] = createSignal<Sweep>()
  const [now, setNow] = createSignal(0)
  let box: BoxRenderable | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let sweepStart: ReturnType<typeof setTimeout> | undefined
  let sweepTimer: ReturnType<typeof setInterval> | undefined
  let hum = false

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  const fireSweep = () => {
    setSweep({ at: performance.now() })
    start()
  }

  const tick = () => {
    const t = performance.now()
    setNow(t)
    const item = hold()
    if (item && !hum && t - item.at >= HOLD) {
      hum = true
      Sound.start()
    }
    if (item && t - item.at >= CHARGE) {
      burst(item.x, item.y)
    }
    let live = false
    setRings((list) => {
      const next = list.filter((item) => t - item.at < LIFE)
      live = next.length > 0
      return next
    })
    const flash = glow()
    if (flash && t - flash.at >= GLOW_OUT) {
      setGlow(undefined)
    }
    const sw = sweep()
    if (sw && t - sw.at >= SWEEP_DURATION) {
      setSweep(undefined)
    }
    if (!live) setRelease(undefined)
    if (live || hold() || release() || glow() || sweep()) {
      // An interaction or sweep is in flight — keep it smooth.
      return
    }
    // Idle between sweeps: go fully static so the landing screen stays cool.
    stop()
  }

  const start = () => {
    if (timer) return
    timer = setInterval(tick, ACTIVE_TICK_MS)
  }

  const stopSweep = () => {
    if (sweepStart) {
      clearTimeout(sweepStart)
      sweepStart = undefined
    }
    if (sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = undefined
    }
    setSweep(undefined)
  }

  createEffect(() => {
    if (props.animated === false || !props.sweep) {
      stopSweep()
      return
    }
    if (sweepStart || sweepTimer) return
    sweepStart = setTimeout(() => {
      sweepStart = undefined
      if (!props.sweep) return
      fireSweep()
      sweepTimer = setInterval(fireSweep, SWEEP_INTERVAL)
    }, 1500)
  })

  createEffect(() => {
    if (props.animated !== false) {
      if (props.idle) {
        setNow(performance.now())
      }
      return
    }
    stopSweep()
    setRings([])
    setHold(undefined)
    setRelease(undefined)
    setGlow(undefined)
    stop()
    hum = false
    Sound.dispose()
  })

  onCleanup(() => {
    stop()
    stopSweep()
    hum = false
    Sound.dispose()
  })

  const hit = (x: number, y: number) => {
    const char = ctx.FULL[y]?.[x]
    return char !== undefined && char !== " "
  }

  const press = (x: number, y: number, t: number) => {
    const last = hold()
    if (last) burst(last.x, last.y)
    setNow(t)
    if (!last) setRelease(undefined)
    setHold({ x, y, at: t, glyph: select(x, y, ctx) })
    hum = false
    start()
  }

  const burst = (x: number, y: number) => {
    const item = hold()
    if (!item) return
    hum = false
    const t = performance.now()
    const age = t - item.at
    const rise = ramp(age, HOLD, CHARGE)
    const level = push(rise)
    setHold(undefined)
    setRelease({ x, y, at: t, glyph: item.glyph, level, rise })
    if (item.glyph !== undefined) {
      setGlow({ glyph: item.glyph, at: t, force: lerp(0.18, 1.5, rise * level) })
    }
    setRings((list) => [
      ...list,
      {
        x: x + 0.5,
        y: y * 2 + 1,
        at: t,
        force: lerp(0.82, 2.55, level),
        kick: lerp(0.32, 0.32 + KICK, level),
      },
    ])
    setNow(t)
    start()
    Sound.pulse(lerp(0.8, 1, level))
  }

  const frame = createMemo<Frame>(() => {
    const t = now()
    const item = hold()
    return {
      t,
      list: rings(),
      hold: item,
      release: release(),
      glow: glow(),
      spark: item ? noise(item.x, item.y, t) : 0,
      sweep: sweep(),
    }
  })

  const dusk = createMemo<Frame>(() => {
    const base = frame()
    const t = base.t - LAG
    const item = base.hold
    return {
      t,
      list: base.list,
      hold: item,
      release: base.release,
      glow: base.glow,
      spark: item ? noise(item.x, item.y, t) : 0,
      sweep: base.sweep,
    }
  })

  // Fully static logo: no per-character shimmer pulse either, so nothing on
  // the landing screen moves except user interactions that may be added later.
  const idleState = createMemo<IdleState | undefined>(() => undefined)

  const renderLine = (
    line: string,
    y: number,
    ink: RGBA,
    bold: boolean,
    frame: Frame,
    dusk: Frame,
    state: IdleState | undefined,
  ): ReturnType<typeof Array.from> => {
    const shadow = tint(theme.background, ink, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined

    return Array.from(line).map((char, i) => {
      if (char === " ") {
        return (
          <text fg={ink} attributes={attrs} selectable={false}>
            {char}
          </text>
        )
      }

      const h = field(i, y, frame, ctx)
      const charLit = lit(char)
      const pulseTop = state ? idle(i, y * 2, frame, ctx, state) : { glow: 0, peak: 0, primary: 0 }
      const pulseBot = state ? idle(i, y * 2 + 1, frame, ctx, state) : { glow: 0, peak: 0, primary: 0 }
      const peakMixTop = charLit ? Math.min(1, pulseTop.peak) : 0
      const peakMixBot = charLit ? Math.min(1, pulseBot.peak) : 0
      const primaryMixTop = charLit ? Math.min(1, pulseTop.primary) : 0
      const primaryMixBot = charLit ? Math.min(1, pulseBot.primary) : 0
      const inkTopTint = primaryMixTop > 0 ? tint(ink, theme.primary, primaryMixTop) : ink
      const inkBotTint = primaryMixBot > 0 ? tint(ink, theme.primary, primaryMixBot) : ink
      const inkTop = peakMixTop > 0 ? tint(inkTopTint, PEAK, peakMixTop) : inkTopTint
      const inkBot = peakMixBot > 0 ? tint(inkBotTint, PEAK, peakMixBot) : inkBotTint
      const pulse = {
        glow: (pulseTop.glow + pulseBot.glow) / 2,
        peak: (pulseTop.peak + pulseBot.peak) / 2,
        primary: (pulseTop.primary + pulseBot.primary) / 2,
      }
      const peakMix = charLit ? Math.min(1, pulse.peak) : 0
      const primaryMix = charLit ? Math.min(1, pulse.primary) : 0
      const inkPrimary = primaryMix > 0 ? tint(ink, theme.primary, primaryMix) : ink
      const inkTinted = peakMix > 0 ? tint(inkPrimary, PEAK, peakMix) : inkPrimary
      const shadowMixCfg = state?.cfg.shadowMix ?? shimmerConfig.shadowMix
      const shadowMixTop = Math.min(1, pulseTop.peak * shadowMixCfg)
      const shadowMixBot = Math.min(1, pulseBot.peak * shadowMixCfg)
      const shadowTop = shadowMixTop > 0 ? tint(shadow, PEAK, shadowMixTop) : shadow
      const shadowBot = shadowMixBot > 0 ? tint(shadow, PEAK, shadowMixBot) : shadow
      const shadowMix = Math.min(1, pulse.peak * shadowMixCfg)
      const shadowTinted = shadowMix > 0 ? tint(shadow, PEAK, shadowMix) : shadow
      const n = wave(i, y, frame, charLit, ctx) + h + (charLit ? sweepGlow(i, y, frame, ctx) : 0)
      const s = wave(i, y, dusk, false, ctx) + h
      const p = charLit ? pick(i, y, frame, ctx) : 0
      const e = charLit ? trace(i, y, frame, ctx) : 0
      const b = charLit ? bloom(i, y, frame, ctx) : 0
      const q = shimmer(i, y, frame, ctx)

      if (char === "_") {
        return (
          <text
            fg={shade(inkTinted, theme, s * 0.08)}
            bg={shade(shadowTinted, theme, ghost(s, 0.24) + ghost(q, 0.06))}
            attributes={attrs}
            selectable={false}
          >
            {" "}
          </text>
        )
      }

      if (char === "^") {
        return (
          <text
            fg={shade(inkTop, theme, n + p + e + b)}
            bg={shade(shadowBot, theme, ghost(s, 0.18) + ghost(q, 0.05) + ghost(b, 0.08))}
            attributes={attrs}
            selectable={false}
          >
            ▀
          </text>
        )
      }

      if (char === "~") {
        return (
          <text fg={shade(shadowTop, theme, ghost(s, 0.22) + ghost(q, 0.05))} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }

      if (char === ",") {
        return (
          <text fg={shade(shadowBot, theme, ghost(s, 0.22) + ghost(q, 0.05))} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }

      if (char === "█") {
        return (
          <text
            fg={shade(inkTop, theme, n + p + e + b)}
            bg={shade(inkBot, theme, n + p + e + b)}
            attributes={attrs}
            selectable={false}
          >
            ▀
          </text>
        )
      }

      if (char === "▀") {
        return (
          <text fg={shade(inkTop, theme, n + p + e + b)} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }

      if (char === "▄") {
        return (
          <text fg={shade(inkBot, theme, n + p + e + b)} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }

      return (
        <text fg={shade(inkTinted, theme, n + p + e + b)} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  return (
    <box ref={(item: BoxRenderable) => (box = item)}>
      <box flexDirection="column">
        <For each={ctx.FULL}>
          {(line, index) => (
            <box flexDirection="row">
              {renderLine(line, index(), props.ink ?? BRAND_BLUE, true, frame(), dusk(), idleState())}
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
