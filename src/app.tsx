import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid"
import { copySelection } from "./clipboard"
import { Toast, type ToastMessage } from "./components/toast"
import { createHarnessSession } from "./harness/session"
import type { HarnessClientLike } from "./harness/client"
import { nextMode, type PermissionMode } from "./permission"
import { Home } from "./screens/home"
import { SessionScreen } from "./screens/session"
import { HARNESS_COMMANDS, LOCAL_COMMANDS, bareCommandName, hostCommandItems, mergeCommands, type CommandItem, type CommandResultView } from "./commands"

/** The task message carried by `/plan <任务>` (the harness steers it to the agent). */
function planTaskMessage(line: string, name: string): string | undefined {
  if (name !== "plan") return undefined
  const args = line.trim().slice("/plan".length).trim()
  if (!args || args === "off") return undefined
  return args
}

export function App(props: { client?: HarnessClientLike } = {}) {
  const renderer = useRenderer()
  const [mode, setMode] = createSignal<PermissionMode>("workspace-write")
  const [toast, setToast] = createSignal<ToastMessage | null>(null)
  const [screen, setScreen] = createSignal<"home" | "session">("home")
  const [commandOpen, setCommandOpen] = createSignal(false)
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
    // The slash menu owns Tab while a command draft is live.
    if (commandOpen()) return
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
    return mergeCommands(LOCAL_COMMANDS, dynamic, HARNESS_COMMANDS)
  }

  const handleCommandOpen = (open: boolean) => {
    setCommandOpen(open)
    if (open) void session.refreshCommands()
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
    // Host commands need a live session: create one on demand so commands
    // still reach the harness when issued from the home screen.
    let createdSession = false
    if (!session.hasSession()) {
      const ok = await session.ensureSession()
      if (!ok) return { title: "命令", rows: ["无法创建会话，请检查 harness 连接"] }
      createdSession = true
      void session.refreshCommands()
    }
    const res = await session.runCommand(line)
    if (res.ok) {
      // `/plan <任务>` delivers the task to the agent on the harness; mirror it
      // as a user message so the conversation shows what is being worked on.
      const task = planTaskMessage(line, name)
      if (task) session.mirrorUserMessage(task)
      // The session now exists and may already be running; leave home so the
      // command card and the agent's plan are visible.
      if (createdSession) setScreen("session")
      return { title: `/${bare ?? name}`, rows: [res.text ?? "已执行（完整结果见消息窗口）"] }
    }
    // Unknown lines are a typing slip, not a failure worth a panel: toast and
    // let the input breathe (dsh-cli shows the same as a transient notice).
    if (res.text?.startsWith("未知或无法解析的命令")) {
      showToast(res.text, "error")
      return null
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
            onCommandPopupOpen={handleCommandOpen}
            commandsLoading={session.commandsLoading}
            planMode={session.planMode}
            planPending={session.planPending}
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
          planMode={session.planMode}
          planPending={session.planPending}
          question={session.question}
          onSend={handleSubmit}
          onBack={() => setScreen("home")}
          onQuestion={session.answer}
          commandItems={commandItems}
          onCommand={runCommand}
          onCommandPopupOpen={handleCommandOpen}
          commandsLoading={session.commandsLoading}
          queue={session.queue}
          onQueueAction={(itemId, action) => void session.updateQueueItem(itemId, action)}
          active={() => screen() === "session"}
        />
      </box>
    </box>
  )
}
