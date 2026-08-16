import { onCleanup, onMount } from "solid-js"
import { createSignal } from "solid-js"
import { Logo } from "../components/logo"
import { ModeHint } from "../components/mode-hint"
import { Prompt } from "../components/prompt"
import { Toast, type ToastMessage } from "../components/toast"
import { Tips } from "../components/tips"
import { Footer } from "../components/footer"
import { StartupLoading } from "../components/startup-loading"
import { deepseek, harness } from "../logo-art"
import type { PermissionMode } from "../permission"
import { theme } from "../theme"

export function Home(props: {
  motion?: boolean
  loading?: boolean
  mode?: () => PermissionMode
  model?: () => string
  toast?: () => ToastMessage | null
} = {}) {
  const motion = props.motion ?? true
  const showLoading = props.loading ?? true
  const mode = props.mode ?? (() => "workspace-write" as PermissionMode)
  const model = props.model ?? (() => "DeepSeek-V4-Flash")
  const toast = props.toast ?? (() => null)
  const [ready, setReady] = createSignal(props.loading === false)

  onMount(() => {
    if (props.loading === false) return
    const timer = setTimeout(() => setReady(true), 350)
    onCleanup(() => clearTimeout(timer))
  })

  return (
    <box
      position="relative"
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.background}
    >
      <box
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
      >
        <box flexGrow={1} minHeight={0} />

        <box flexShrink={0} alignItems="center" gap={1}>
          <Logo art={deepseek} ink={theme.primary} animated={motion} idle sweep />
          <Logo art={harness} ink={theme.textMuted} animated={motion} idle />
          <text fg={theme.textMuted} marginTop={1}>
            DeepSeek Harness CLI
          </text>
        </box>

        <box height={1} minHeight={0} flexShrink={1} />

        <box width="100%" maxWidth={75} flexShrink={0}>
          <Prompt mode={mode} model={model} />
        </box>

        <box width="100%" maxWidth={75} paddingTop={1} flexShrink={0}>
          <ModeHint />
        </box>

        <box width="100%" maxWidth={75} paddingTop={2} flexShrink={0}>
          <Tips />
        </box>

        <box flexGrow={1} minHeight={0} />
      </box>

      <Footer />
      {showLoading ? <StartupLoading ready={ready} /> : null}
      <Toast toast={toast} />
    </box>
  )
}
