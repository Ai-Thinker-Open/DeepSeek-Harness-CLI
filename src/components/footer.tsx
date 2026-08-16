import fs from "node:fs"
import path from "node:path"
import { Show, createSignal, onCleanup, onMount } from "solid-js"
import pkg from "../../package.json"
import { getMcpServers, type McpServerStatus } from "../mcp"
import { theme } from "../theme"

function abbreviate(dir: string) {
  const home = process.env.HOME
  if (home && dir.startsWith(home)) return "~" + dir.slice(home.length)
  return dir
}

function readBranch(): string {
  try {
    const git = path.resolve(process.cwd(), ".git")
    if (fs.existsSync(git) && fs.statSync(git).isFile()) {
      const ref = fs.readFileSync(git, "utf8").trim().split(":")[1]?.trim() ?? ""
      return ref.replace(/^refs\/heads\//, "")
    }
    const ref = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim()
    return ref.replace(/^ref: refs\/heads\//, "")
  } catch {
    return ""
  }
}

function McpStatus() {
  const [servers, setServers] = createSignal<McpServerStatus[]>([])

  onMount(() => {
    setServers(getMcpServers())
  })

  const count = () => servers().filter((item) => item.status === "connected").length
  const hasError = () => servers().some((item) => item.status === "failed")
  const dot = () => (hasError() ? theme.error : count() > 0 ? theme.success : theme.textMuted)

  return (
    <box flexDirection="row" gap={2} flexShrink={0}>
      <text fg={theme.text}>
        <span style={{ fg: dot() }}>⊙ </span>
        {count()} MCP
      </text>
      <text fg={theme.textMuted}>/status</text>
    </box>
  )
}

export interface StreamSnapshot {
  connected: boolean
  lastFrameAt: number
  eventCount: number
  lastEventType: string
}

function StreamStatus(props: { stream: () => StreamSnapshot | null }) {
  const [snap, setSnap] = createSignal<StreamSnapshot | null>(null)

  onMount(() => {
    const poll = () => setSnap(props.stream())
    poll()
    const timer = setInterval(poll, 1000)
    onCleanup(() => clearInterval(timer))
  })

  const state = () => {
    const s = snap()
    if (!s) return { color: theme.textMuted, label: "事件流 —" }
    const age = s.lastFrameAt > 0 ? Math.round((Date.now() - s.lastFrameAt) / 1000) : null
    if (!s.connected) return { color: theme.error, label: `事件流 断开` }
    if (age === null) return { color: theme.textMuted, label: "事件流 —" }
    const color = age < 8 ? theme.success : age < 20 ? theme.warning : theme.error
    const last = s.lastEventType ? ` · ${s.lastEventType}` : ""
    return { color, label: `事件流 ${s.eventCount} · ${age}s 前${last}` }
  }

  return (
    <text fg={theme.textMuted}>
      <span style={{ fg: state().color }}>● </span>
      {state().label}
    </text>
  )
}

export function Footer(props: { stream?: () => StreamSnapshot | null } = {}) {
  const [dir, setDir] = createSignal(abbreviate(process.cwd()))
  const [branch, setBranch] = createSignal("")

  onMount(() => {
    const value = readBranch()
    if (value) setBranch(value)
    setDir(abbreviate(process.cwd()))
  })

  return (
    <box
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      gap={2}
      border={["top"]}
      borderColor={theme.borderSubtle}
    >
      <text fg={theme.textMuted}>
        {dir()}
        {branch() ? `:${branch()}` : ""}
      </text>
      <Show when={props.stream}>
        <StreamStatus stream={props.stream as () => StreamSnapshot | null} />
      </Show>
      <McpStatus />
      <box flexGrow={1} />
      <text fg={theme.textMuted}>v{pkg.version}</text>
    </box>
  )
}
