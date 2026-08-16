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
  if (s.firstTokenMs != null) lines.push(`首 token ${formatDuration(s.firstTokenMs)}`)
  lines.push(`输入 ${formatTokens(s.inTokens)} tokens · 输出 ${formatTokens(s.outTokens)} tokens`)
  return lines
}

export function StatsBar(props: { stats?: () => SessionStats; status?: () => string } = {}) {
  const [hover, setHover] = createSignal(false)
  const stats = props.stats ?? (() => EMPTY_STATS)
  const status = props.status ?? (() => "")

  const short = () => {
    const statusText = status()
    if (statusText) return statusText
    const s = stats()
    if (s.turns === 0 && s.steps === 0 && s.inTokens === 0 && s.outTokens === 0) {
      return "等待对话…"
    }
    return `${s.turns} 轮 · ${s.steps} 步 | LLM ${formatDuration(s.llmMs)} · 工具 ${formatDuration(s.toolMs)} | 输入 ${formatTokens(s.inTokens)} · 输出 ${formatTokens(s.outTokens)}`
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
