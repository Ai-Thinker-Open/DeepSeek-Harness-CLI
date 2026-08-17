import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid"
import { copySelection } from "./clipboard"
import { Toast, type ToastMessage } from "./components/toast"
import { createHarnessSession } from "./harness/session"
import type { HarnessClientLike } from "./harness/client"
import { nextMode, type PermissionMode } from "./permission"
import { Home } from "./screens/home"
import { SessionScreen } from "./screens/session"
import { HARNESS_COMMANDS, LOCAL_COMMANDS, bareCommandName, hostCommandItems, mergeCommands, type CommandItem } from "./commands"
import type { CommandResultView } from "./components/command-popup"

export function App(props: { client?: HarnessClientLike } = {}) {
  const renderer = useRenderer()
  const [mode, setMode] = createSignal<PermissionMode>("workspace-write")
  const [toast, setToast] = createSignal<ToastMessage | null>(null)
  const [screen, setScreen] = createSignal<"home" | "session">("home")
  const session = createHarnessSession(props.client)
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const showToast = (text: string, kind: ToastMessage["kind"] = "success") => {
    setToast({ text, kind })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => setToast(null), 1800)
  }

  onCleanup(() => {
    if (toastTimer) clearTimeout(toastTimer)
    session.dispose()
  })

  useKeyboard((key) => {
    if (session.question()) return
    if (key.name === "tab") {
      setMode((current) => nextMode(current, key.shift))
    }
  })

  useSelectionHandler((selection) => {
    const result = copySelection(renderer, selection.getSelectedText())
    if (result === "ok") showToast("✓ 已复制到剪贴板")
    else if (result === "unsupported") showToast("✕ 终端不支持复制", "error")
  })

  createEffect(() => {
    const err = session.error()
    if (err) {
      showToast(err, "error")
      session.clearError()
    }
  })

  const handleSubmit = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (screen() === "home") {
      const ok = await session.start(trimmed)
      if (!ok) return
      void session.refreshCommands()
      setScreen("session")
    } else {
      await session.send(trimmed)
    }
  }

  const commandItems = (): CommandItem[] => {
    const dynamic = hostCommandItems(session.commands())
    // Hardcoded harness commands win over stale/partial dynamic discovery.
    const host = session.hasSession() ? dynamic : []
    const hardcoded = session.hasSession() ? HARNESS_COMMANDS : []
    return mergeCommands(LOCAL_COMMANDS, host, hardcoded)
  }

  const runCommand = async (line: string): Promise<CommandResultView | null> => {
    const bare = bareCommandName(line)
    const name = (bare ?? line.trim().slice(1).split(/\s+/)[0]?.toLowerCase() ?? "").toLowerCase()
    if (name === "sessions" || name === "resume") {
      const items = await session.listSessions()
      const rows = items.length
        ? items.map((s) => {
            const state = s.running ? "运行中" : s.blank ? "空白" : "已结束"
            const when = new Date(s.updatedAt).toLocaleString()
            return `${s.sessionId}  ${state}  ${s.cwd ?? ""}  ${when}`
          })
        : ["（没有会话）"]
      return { title: `会话列表（${items.length}）`, rows }
    }
    if (name === "help") {
      const rows = commandItems().map((i) => `/${i.name}  ${i.description}`)
      return { title: "快捷命令", rows }
    }
    const res = await session.runCommand(line)
    if (res.ok) {
      return { title: `/${bare ?? name}`, rows: [res.text ?? "已执行（完整结果见消息窗口）"] }
    }
    return { title: "命令", rows: [res.text ?? "执行失败"] }
  }

  return (
    <box position="relative" width="100%" height="100%">
      <Show when={screen() === "home"}>
        <box position="absolute" left={0} top={0} width="100%" height="100%">
          <Home
            mode={mode}
            model={session.modelName}
            toast={toast}
            onSubmit={handleSubmit}
            commandItems={commandItems}
            onCommand={runCommand}
            onCommandPopupOpen={() => void session.refreshCommands()}
            commandsLoading={session.commandsLoading}
            motion
            active={() => true}
          />
        </box>
      </Show>
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        visible={screen() === "session"}
      >
        <SessionScreen
          messages={session.messages}
          mode={mode}
          model={session.modelName}
          toast={toast}
          stats={session.stats}
          statusText={session.statusText}
          question={session.question}
          onSend={handleSubmit}
          onBack={() => setScreen("home")}
          onQuestion={session.answer}
          commandItems={commandItems}
          onCommand={runCommand}
          onCommandPopupOpen={() => void session.refreshCommands()}
          commandsLoading={session.commandsLoading}
          active={() => screen() === "session"}
        />
      </box>
    </box>
  )
}
