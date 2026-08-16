// @ts-nocheck
import { For, Show, createSignal } from "solid-js"
import { EMPTY_STATS, type SessionStats } from "../session"
import { theme } from "../theme"

function formatDuration(ms: number): string {
  if (ms <= 0) return "—"
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  return `${Math.floor(totalSeconds / 60)}m${String(totalSeconds % 60).padStart(2, "0")}s`
}

/** Sub-second precision for first-token averages ("0.6s"). */
function formatPrecise(ms: number): string {
  if (ms <= 0) return "—"
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`
  return formatDuration(ms)
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fullStats(s: SessionStats): string[] {
  const lines = [
    `轮次 ${s.turns} · 步骤 ${s.steps}`,
    `LLM 用时 ${formatDuration(s.llmMs)} · 工具调用 ${formatDuration(s.toolMs)}`,
  ]
  if (s.firstTokenMs != null && s.firstTokenCount > 0) {
    lines.push(`首 token 平均 ${formatPrecise(s.firstTokenMs)}（${s.firstTokenCount} 步）`)
  }
  lines.push(`输入 ${formatTokens(s.inTokens)} tokens · 缓存读取 ${formatTokens(s.cacheReadTokens)} · 缓存写入 ${formatTokens(s.cacheWriteTokens)}`)
  lines.push(`输出 ${formatTokens(s.outTokens)} tokens · 推理 ${formatTokens(s.reasoningTokens)} tokens`)
  return lines
}

function cacheHitPct(s: SessionStats): number | null {
  const billed = s.inTokens + s.cacheReadTokens
  if (billed <= 0) return null
  return Math.round((s.cacheReadTokens / billed) * 100)
}

export function StatsBar(props: { stats?: () => SessionStats } = {}) {
  const [hover, setHover] = createSignal(false)
  const stats = props.stats ?? (() => EMPTY_STATS)

  const short = () => {
    const s = stats()
    const parts: string[] = []
    if (s.turns > 0 || s.steps > 0) parts.push(`${s.turns} 轮 · ${s.steps} 步`)
    if (s.llmMs > 0) parts.push(`LLM ${formatDuration(s.llmMs)}`)
    if (s.firstTokenMs != null && s.firstTokenCount > 0) {
      let seg = `首 token 平均 ${formatPrecise(s.firstTokenMs)}`
      if (s.outTokens > 0 && s.llmMs > 0) {
        const tokPerSec = Math.round((s.outTokens * 1000) / s.llmMs)
        if (tokPerSec > 0) seg += ` · ${tokPerSec} tok/s`
      }
      parts.push(seg)
    }
    const hit = cacheHitPct(s)
    if (hit != null) parts.push(`缓存命中 ${hit}%`)
    if (s.inTokens > 0 || s.outTokens > 0 || s.cacheReadTokens > 0) {
      parts.push(`输入 ${formatTokens(s.inTokens + s.cacheReadTokens)} · 输出 ${formatTokens(s.outTokens)} tok`)
    }
    return parts.length ? parts.join(" | ") : "等待对话…"
  }

  return (
    <box width="100%" position="relative" flexShrink={0}>
      <box
        onMouse={(evt) => {
          if (evt.type === "over") setHover(true)
          else if (evt.type === "out") setHover(false)
        }}
      >
        <text fg={theme.textMuted}>{short()}</text>
      </box>
      <Show when={hover()}>
        <box
          position="absolute"
          bottom={2}
          left={0}
          zIndex={7000}
          backgroundColor={theme.backgroundPanel}
          border
          borderColor={theme.border}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
          gap={0}
        >
          <For each={fullStats(stats())}>{(line) => <text fg={theme.text}>{line}</text>}</For>
        </box>
      </Show>
    </box>
  )
}
