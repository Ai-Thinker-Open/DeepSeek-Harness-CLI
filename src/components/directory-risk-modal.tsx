import { Show, createSignal } from "solid-js"
import { RGBA } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { isDown, isEnter, isUp } from "./key-match"
import { theme } from "../theme"

/**
 * Startup gate shown before the home screen. Normal directories are remembered
 * after the first confirmation (next launch in the same directory skips the
 * gate); the home directory and filesystem roots get a red high-risk warning
 * on every launch and trust is per-session only.
 */
export function DirectoryRiskModal(props: {
  open: () => boolean
  dir: string
  highRisk: boolean
  onExit: () => void
  onProceed: () => void
}) {
  // 0 = 退出, 1 = 信任并继续。普通目录默认「信任并继续」（知情即可运行）；
  // 主目录/根目录这类敏感目录默认「退出（推荐）」。
  const [selected, setSelected] = createSignal(props.highRisk ? 0 : 1)

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
  const exitLabel = props.highRisk ? "退出（推荐）" : "退出"
  const trustLabel = props.highRisk ? "我了解风险，仅本次信任" : "信任此工作目录（记住）（推荐）"

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
                {"\n"}
                确认后，后续在本目录启动将不再提示风险。
              </text>
            }
          >
            <text fg={theme.error} wrapMode="char">
              你即将打开{props.dir === "/" ? "文件系统根目录" : "主目录"}：{props.dir}
              {"\n"}
              DeepSeek Harness 将能够访问你所有的个人文件 — SSH 密钥、凭证、浏览器配置等
              {props.dir === "/" ? "系统" : "主目录"}下的所有内容。
            </text>
          </Show>
          <box marginTop={1} marginBottom={1} flexDirection="column">
            {option(0, exitLabel)}
            {option(1, trustLabel)}
          </box>
          <text fg={theme.textMuted}>↑/↓ 选择 · Enter 确认 · Esc 退出</text>
        </box>
      </box>
    </Show>
  )
}
