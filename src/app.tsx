import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid"
import { copySelection } from "./clipboard"
import { Toast, type ToastMessage } from "./components/toast"
import { createHarnessSession } from "./harness/session"
import type { HarnessClientLike, ModelCatalog } from "./harness/client"
import { nextMode, type PermissionMode } from "./permission"
import { Home } from "./screens/home"
import { SessionScreen } from "./screens/session"
import { HARNESS_COMMANDS, LOCAL_COMMANDS, bareCommandName, hostCommandItems, mergeCommands, type CommandItem, type CommandResultView } from "./commands"
import type { SkillEntry } from "./harness/client"

/** Terminal display width: CJK glyphs occupy two cells in a monospace font. */
function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    width += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1
  }
  return width
}

/** Truncate to `width` terminal cells, appending an ellipsis when cut. */
function truncateTo(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  let out = ""
  let used = 0
  for (const ch of text) {
    const w = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1
    if (used + w > width - 1) break
    out += ch
    used += w
  }
  return `${out}…`
}

/** Right-pad to `width` terminal cells so the session rows line up. */
function padTo(text: string, width: number): string {
  const pad = width - displayWidth(text)
  return pad > 0 ? text + " ".repeat(pad) : text
}

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
  const [resultOverride, setResultOverride] = createSignal<CommandResultView | null>(null)
  const [skills, setSkills] = createSignal<SkillEntry[]>([])
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
    const skillItems: CommandItem[] = skills().map((s) => ({
      name: s.name,
      description: `技能：${s.description}`,
      kind: "skill" as const,
      behavior: "run" as const,
    }))
    // Hardcoded harness commands win over stale/partial dynamic discovery.
    return mergeCommands(LOCAL_COMMANDS, dynamic, HARNESS_COMMANDS, skillItems)
  }

  const handleCommandOpen = (open: boolean) => {
    setCommandOpen(open)
    if (open) {
      void session.refreshCommands()
      void refreshSkills()
    }
  }

  /** Load the session's user-invocable skills into the slash palette. */
  const refreshSkills = async () => {
    if (!session.hasSession()) return
    setSkills(await session.listSkills())
  }

  const runCommand = async (line: string): Promise<CommandResultView | null> => {
    const bare = bareCommandName(line)
    const name = (bare ?? line.trim().slice(1).split(/\s+/)[0]?.toLowerCase() ?? "").toLowerCase()
    // Skills are invoked as ordinary user messages: the harness's pre-step
    // recognizes a leading `/<skill>` line and injects the skill's
    // instructions (they are not commands in the harness command registry).
    // MCP-style `/server:tool` lines fall back to the same message path so
    // the model can act on them.
    if (skills().some((s) => s.name === name) || line.trim().slice(1).includes(":")) {
      if (!session.hasSession()) {
        const ok = await session.start(line.trim())
        if (!ok) return { title: "技能", rows: ["无法创建会话，请检查 harness 连接"] }
        void session.refreshCommands()
        void refreshSkills()
        setScreen("session")
        return null
      }
      await session.send(line.trim())
      setScreen("session")
      return null
    }
    if (name === "sessions" || name === "resume") {
      const items = await session.listSessions()
      const rows = items.length
        ? items.map((s) => {
            const first = truncateTo(s.preview ?? "（空白会话）", 34)
            const when = new Date(s.updatedAt)
            const time = `${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`
            const state = s.running ? "●" : s.blank ? "○" : "·"
            // The harness session ids are prefixed (`s-…`); the meaningful
            // tail is the random part, so keep its first 8 chars.
            const shortId = s.sessionId.replace(/^s-/, "").slice(0, 8)
            const text = `${state} ${padTo(first, 34)}  ${time}  ${shortId}`
            return {
              text,
              onClick: async () => {
                const ok = await session.resumeSession(s.sessionId)
                if (ok) {
                  void session.refreshCommands()
                  setScreen("session")
                }
              },
            }
          })
        : ["（没有会话）"]
      return {
        title: `会话列表（${items.length}）· 点击行恢复会话`,
        rows,
      }
    }
    if (name === "help") {
      const rows = commandItems().map((i) => `/${i.name}  ${i.description}`)
      return { title: "快捷命令", rows }
    }
    if (name === "model") {
      if (!session.hasSession()) {
        const ok = await session.ensureSession()
        if (!ok) return { title: "模型", rows: ["无法创建会话，请检查 harness 连接"] }
        void session.refreshCommands()
      }
      const catalog = await session.listModels()
      if (!catalog) {
        const view = { title: "模型", rows: ["无法读取模型目录，请检查 harness 连接"] }
        setResultOverride(view)
        return view
      }
      const build = (c: ModelCatalog) => {
        const current = `${c.current.provider}/${c.current.model}`
        const rows: Array<string | { text: string; onClick: () => void }> = [
          `当前模型：${current}`,
          "",
        ]
        for (const group of c.groups) {
          rows.push(`── ${group.name} ──`)
          for (const m of group.models) {
            const isCurrent = c.current.provider === group.id && c.current.model === m.id
            const label = `${isCurrent ? "● " : "○ "}${m.name}${m.description ? `  ${truncateTo(m.description, 36)}` : ""}`
            rows.push({
              text: label,
              onClick: async () => {
                const ok = await session.selectModel(group.id, m.id)
                // The panel closes on confirm; the toast reports the outcome.
                showToast(ok ? `已切换到 ${m.name}` : "模型切换失败", ok ? "success" : "error")
              },
            })
          }
        }
        return { title: "模型（点击行切换）", rows }
      }
      const view = build(catalog)
      setResultOverride(view)
      return view
    }
    if (name === "rename") {
      const title = line.trim().slice("/rename".length).trim()
      if (!title) return { title: "重命名", rows: ["用法：/rename <标题>"] }
      if (!session.hasSession()) {
        const ok = await session.ensureSession()
        if (!ok) return { title: "重命名", rows: ["无法创建会话，请检查 harness 连接"] }
        void session.refreshCommands()
      }
      const ok = await session.renameSession(title)
      const view = { title: "重命名", rows: [ok ? `已重命名为：${title}` : "重命名失败"] }
      setResultOverride(view)
      return view
    }
    if (name === "fork") {
      if (!session.hasSession()) {
        const ok = await session.ensureSession()
        if (!ok) return { title: "分叉", rows: ["无法创建会话，请检查 harness 连接"] }
        void session.refreshCommands()
      }
      const childId = await session.forkSession()
      if (!childId) {
        const view = { title: "分叉", rows: ["分叉失败"] }
        setResultOverride(view)
        return view
      }
      void session.refreshCommands()
      const view = { title: "分叉", rows: [`已创建新会话 ${childId.replace(/^s-/, "").slice(0, 8)}`] }
      setResultOverride(view)
      return view
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
            resultOverride={resultOverride}
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
          resultOverride={resultOverride}
          queue={session.queue}
          onQueueAction={(itemId, action) => void session.updateQueueItem(itemId, action)}
          active={() => screen() === "session"}
        />
      </box>
    </box>
  )
}
