// @ts-nocheck
import { For, Show, createSignal } from "solid-js"
import { theme } from "../theme"

const SHORT_STATS =
  "30 轮 · 1080 步 | LLM 124m57s · 工具调用 957m23s | 首 token 平均 2.5s · 143 tok/s | 缓存命中 100% | 输入 395M tok.."

const FULL_STATS = [
  "轮次 30 · 步骤 1080",
  "LLM 用时 124m57s · 工具调用 957m23s",
  "首 token 平均 2.5s · 143 tok/s",
  "缓存命中 100%",
  "输入 395M tokens · 输出 128M tokens",
]

export function StatsBar() {
  const [hover, setHover] = createSignal(false)

  return (
    <box width="100%" position="relative" flexShrink={0}>
      <box
        onMouse={(evt) => {
          if (evt.type === "over") setHover(true)
          else if (evt.type === "out") setHover(false)
        }}
      >
        <text fg={theme.textMuted}>{SHORT_STATS}</text>
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
          <For each={FULL_STATS}>{(line) => <text fg={theme.text}>{line}</text>}</For>
        </box>
      </Show>
    </box>
  )
}
