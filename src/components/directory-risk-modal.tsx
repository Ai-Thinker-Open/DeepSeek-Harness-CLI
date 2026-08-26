import { Show, createSignal } from "solid-js"
import { RGBA } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { isDown, isEnter, isUp } from "./key-match"
import { theme } from "../theme"

/**
 * Startup gate shown before the home screen on every launch. The user is
 * reminded what DeepSeek Harness can do with the current workspace; the home
 * directory and filesystem roots get a red high-risk warning. Trust is
 * per-session only ("仅本次信任") — nothing is persisted.
 */
export function DirectoryRiskModal(props: {
  open: () => boolean
  dir: string
  highRisk: boolean
  onExit: () => void
  onProceed: () => void
}) {
  // 0 = 退出（推荐）, 1 = 我了解风险，仅本次信任
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
      if (selected() === 1) props.onProceed()
      else props.onExit()
    } else if (key.name === "escape") {
      props.onExit()
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
          borderColor={props.highRisk ? theme.error : theme.accent}
          backgroundColor={theme.backgroundPanel}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
        >
          <text fg={props.highRisk ? theme.error : theme.accent}>
            <b>{props.highRisk ? "⚠️ 目录风险警告" : "⚠️ 目录确认"}</b>
          </text>
          <Show
            when={props.highRisk}
            fallback={
              <text fg={theme.text} wrapMode="char">
                你即将在此目录中启动 DeepSeek Harness：{props.dir}
                {"\n"}
                Harness 将能够读取、修改该目录及其子目录中的文件，并执行命令。请确认你信任此工作目录。
              </text>
            }
          >
            <text fg={theme.error} wrapMode="char">
              你即将打开{props.dir === "/" ? "文件系统根目录" : "主目录"}：{props.dir}
              {"\n"}
              DeepSeek Harness 将能够访问你所有的个人文件 — SSH 密钥、凭证、浏览器配置等
              {props.dir === "/" ? "系统" : "主目录"}下的所有内容。
              {"\n"}
              如果此目录中存在恶意插件，它们可以执行任意代码、读取、修改或窃取你的文件。
              {"\n"}
              除非有明确的理由，否则不要信任你的整个{props.dir === "/" ? "系统" : "主目录"}。
            </text>
          </Show>
          <box marginTop={1} marginBottom={1} flexDirection="column">
            {option(0, "退出（推荐）")}
            {option(1, "我了解风险，仅本次信任")}
          </box>
          <text fg={theme.textMuted}>↑/↓ 选择 · Enter 确认 · Esc 退出</text>
        </box>
      </box>
    </Show>
  )
}
