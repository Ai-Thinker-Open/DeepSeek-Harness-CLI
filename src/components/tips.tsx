import { createSignal, onCleanup, onMount } from "solid-js"
import { theme } from "../theme"

const TIPS = [
  "输入 / 可以查看命令",
  "支持多行输入，Enter 发送",
  "Ctrl+C 随时退出",
  "后续将接入会话、模型与工作区",
]

export function Tips() {
  const [idx, setIdx] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => setIdx((i) => (i + 1) % TIPS.length), 10000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box flexDirection="row" justifyContent="center">
      <text>
        <span style={{ fg: theme.primary }}>● 提示:</span>
        <span style={{ fg: theme.textMuted }}>{TIPS[idx()]}</span>
      </text>
    </box>
  )
}
