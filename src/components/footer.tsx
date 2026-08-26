import fs from "node:fs"
import path from "node:path"
import { createSignal, onCleanup, onMount } from "solid-js"
import pkg from "../../package.json"
import { refreshMcpStatus, type McpServerStatus } from "../mcp"
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
    let alive = true
    const refresh = async () => {
      const list = await refreshMcpStatus()
      if (alive) setServers(list)
    }
    void refresh()
    const timer = setInterval(refresh, 3000)
    onCleanup(() => {
      alive = false
      clearInterval(timer)
    })
  })

  const count = () => servers().filter((item) => item.status === "connected").length
  const hasError = () => servers().some((item) => item.status === "failed")
  const dot = () => (hasError() ? theme.error : count() > 0 ? theme.success : theme.textMuted)

  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={theme.text}>
        <span style={{ fg: dot() }}>⊙ </span>
        {count()} MCP /mcp
      </text>
    </box>
  )
}

export function Footer() {
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
      <McpStatus />
      <box flexGrow={1} />
      <text fg={theme.textMuted}>v{pkg.version}</text>
    </box>
  )
}
