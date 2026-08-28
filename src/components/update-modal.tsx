import { Show, createSignal } from "solid-js"
import { RGBA } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { isDown, isEnter, isUp } from "./key-match"
import { theme } from "../theme"

/**
 * Startup gate shown when a newer published version exists. The user decides
 * whether to update or keep the current version (skipping never blocks use).
 * Updating runs in place: the TUI shows the update progress, then restarts
 * automatically in the same terminal; declining continues with the current
 * version.
 */
export function UpdateModal(props: {
  open: () => boolean
  current: string
  latest: string
  phase: () => "ask" | "running" | "done" | "failed"
  status: () => string
  onUpdate: () => void
  onSkip: () => void
}) {
  // 0 = 立即更新（推荐）, 1 = 暂不更新
  const [selected, setSelected] = createSignal(0)

  useKeyboard((key) => {
    if (!props.open()) return
    const phase = props.phase()
    // No input while the updater is running or the restart is pending.
    if (phase === "running" || phase === "done") return
    if (phase === "failed") {
      if (isEnter(key) || key.name === "escape") {
        key.preventDefault?.()
        props.onSkip()
      }
      return
    }
    if (isUp(key)) {
      setSelected(0)
      key.preventDefault?.()
    } else if (isDown(key)) {
      setSelected(1)
      key.preventDefault?.()
    } else if (isEnter(key)) {
      key.preventDefault?.()
      if (selected() === 0) props.onUpdate()
      else props.onSkip()
    } else if (key.name === "escape") {
      props.onSkip()
    }
  })

  const option = (index: 0 | 1, label: string) => (
    <box
      width="100%"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={selected() === index ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
    >
      <text fg={selected() === index ? theme.background : theme.text}>
        {selected() === index ? "› " : "  "}
        {label}
      </text>
    </box>
  )

  return (
    <Show when={props.open()}>
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        zIndex={8100}
        alignItems="center"
        justifyContent="center"
        backgroundColor={theme.background}
      >
        <box
          width={80}
          border
          borderColor={theme.accent}
          backgroundColor={theme.backgroundPanel}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
        >
          <Show
            when={props.phase() === "ask"}
            fallback={
              <Show
                when={props.phase() === "failed"}
                fallback={
                  <box flexDirection="column">
                    <text fg={theme.accent}>
                      <b>{props.phase() === "done" ? "⬆ 更新完成" : "⬆ 正在更新"}</b>
                    </text>
                    <text fg={theme.text} wrapMode="char">
                      正在更新到 v{props.latest}…
                      {"\n"}
                      {props.status()}
                    </text>
                    <text fg={theme.textMuted}>请保持窗口打开，完成后将自动重启。</text>
                  </box>
                }
              >
                <box flexDirection="column">
                  <text fg={theme.error}>
                    <b>⬆ 更新失败</b>
                  </text>
                  <text fg={theme.text} wrapMode="char">
                    {props.status()}
                    {"\n"}
                    当前版本 v{props.current} 仍可正常使用。
                  </text>
                  <text fg={theme.textMuted}>按 Enter 继续使用当前版本</text>
                </box>
              </Show>
            }
          >
            <text fg={theme.accent}>
              <b>⬆ 发现新版本</b>
            </text>
            <text fg={theme.text} wrapMode="char">
              当前版本 v{props.current}，最新版本 v{props.latest}
              {"\n"}
              更新将直接在当前界面进行，完成后自动重启；跳过更新不影响使用。
            </text>
            <box marginTop={1} marginBottom={1} flexDirection="column">
              {option(0, "立即更新（推荐）")}
              {option(1, "暂不更新")}
            </box>
            <text fg={theme.textMuted}>↑/↓ 选择 · Enter 确认 · Esc 暂不更新</text>
          </Show>
        </box>
      </box>
    </Show>
  )
}
