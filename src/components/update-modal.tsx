import { Show, createSignal } from "solid-js"
import { RGBA } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { isDown, isEnter, isUp } from "./key-match"
import { theme } from "../theme"

/**
 * Startup gate shown when a newer published version exists: the user decides
 * whether to update before the app starts. Updating exits the TUI, reinstalls
 * in the background and relaunches; declining continues with the current
 * version.
 */
export function UpdateModal(props: {
  open: () => boolean
  current: string
  latest: string
  onUpdate: () => void
  onSkip: () => void
}) {
  // 0 = 立即更新（推荐）, 1 = 暂不更新
  const [selected, setSelected] = createSignal(0)

  useKeyboard((key) => {
    if (!props.open()) return
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
          <text fg={theme.accent}>
            <b>⬆ 发现新版本</b>
          </text>
          <text fg={theme.text} wrapMode="char">
            当前版本 v{props.current}，最新版本 v{props.latest}
            {"\n"}
            更新需要退出当前界面，后台安装完成后会自动重新启动。
          </text>
          <box marginTop={1} marginBottom={1} flexDirection="column">
            {option(0, "立即更新（推荐）")}
            {option(1, "暂不更新")}
          </box>
          <text fg={theme.textMuted}>↑/↓ 选择 · Enter 确认 · Esc 暂不更新</text>
        </box>
      </box>
    </Show>
  )
}
