import type { CommandDescriptor } from "./harness/client"

/** One discoverable slash command shown in the popup (no leading slash). */
export interface CommandItem {
  name: string
  description: string
  input?: { hint: string }
  kind: "local" | "host" | "skill" | "mcp"
  /**
   * How the palette treats the command once picked, by its actual function:
   * `run` commands are display/action commands that execute immediately
   * (sessions/help/compact/export); `fill` commands take arguments and are
   * filled into the composer for the user to complete (plan/goal/feedback).
   */
  behavior: "run" | "fill"
}

/** One result row: plain text, or text with an optional click action. */
export type CommandResultRow = string | { text: string; onClick?: () => void }

/** Command result shown above the prompt after a command runs. */
export interface CommandResultView {
  title: string
  rows: CommandResultRow[]
}

/** TUI-local commands that run inside the client, no host session needed. */
export const LOCAL_COMMANDS: CommandItem[] = [
  { name: "mcp", description: "显示 MCP 服务器列表与状态", kind: "local", behavior: "run" },
  { name: "sessions", description: "列出主机上的全部会话", kind: "local", behavior: "run" },
  { name: "resume", description: "浏览已保存的会话（只读列表）", kind: "local", behavior: "run" },
  { name: "model", description: "切换当前会话的 LLM 模型", kind: "local", behavior: "run" },
  { name: "rename", description: "重命名当前会话", kind: "local", input: { hint: "<标题>" }, behavior: "fill" },
  { name: "fork", description: "从当前会话分叉出新会话", kind: "local", behavior: "run" },
  { name: "help", description: "显示全部快捷命令", kind: "local", behavior: "run" },
]

/**
 * The harness's shipped slash commands, hardcoded so the palette always shows
 * them even when `commands.list` discovery is unavailable or stale. They are
 * still dispatched to the host via `commands.execute`.
 */
export const HARNESS_COMMANDS: CommandItem[] = [
  { name: "compact", description: "压缩较早的会话历史", kind: "host", behavior: "run" },
  { name: "feedback", description: "记录关于当前会话的反馈", kind: "host", input: { hint: "<text>" }, behavior: "fill" },
  {
    name: "goal",
    description: "设置或查看长期任务的目标",
    kind: "host",
    input: { hint: "[<objective>|clear|edit <objective>|pause|resume]" },
    behavior: "fill",
  },
  { name: "plan", description: "描述你的任务以生成计划（进入/退出计划模式）", kind: "host", input: { hint: "[<任务描述|off>]" }, behavior: "fill" },
  { name: "permission", description: "切换权限预设（沙箱模式与审批策略）", kind: "host", input: { hint: "<preset>" }, behavior: "fill" },
  { name: "export", description: "导出会话日志", kind: "host", behavior: "run" },
]

/** Canonical Chinese descriptions for host commands, so the palette never
 *  mixes languages regardless of what `commands.list` reports. */
const HOST_DESCRIPTIONS_ZH: Record<string, string> = {
  compact: "压缩较早的会话历史",
  export: "导出会话日志",
  feedback: "记录关于当前会话的反馈",
  goal: "设置或查看长期任务的目标",
  permission: "切换权限预设（沙箱模式与审批策略）",
  plan: "描述你的任务以生成计划（进入/退出计划模式）",
}

/** Localize a host command's description; unknown commands keep their text. */
function describeHostCommand(name: string, fallback: string): string {
  return HOST_DESCRIPTIONS_ZH[name] ?? fallback
}

/** Merge command lists by name; later sources win, preserving first-seen order. */
export function mergeCommands(...lists: CommandItem[][]): CommandItem[] {
  const byName = new Map<string, CommandItem>()
  for (const list of lists) {
    for (const item of list) byName.set(item.name, item)
  }
  return [...byName.values()]
}

/** Map the host's dynamic command directory into popup items. */
export function hostCommandItems(descriptors: CommandDescriptor[]): CommandItem[] {
  return descriptors.map((d) => ({
    name: d.name,
    description: describeHostCommand(d.name, d.description),
    input: d.input,
    kind: "host" as const,
    // The harness's `input.hint` is its function signal: commands that take
    // free-form input advertise a hint; everything else is an action.
    behavior: d.input?.hint ? ("fill" as const) : ("run" as const),
  }))
}

/**
 * Filter by command name: prefix matches rank first, then case-insensitive
 * substring matches, preserving item order within each tier.
 */
export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  const prefix: CommandItem[] = []
  const substring: CommandItem[] = []
  for (const item of items) {
    const name = item.name.toLowerCase()
    if (name.startsWith(q)) prefix.push(item)
    else if (name.includes(q)) substring.push(item)
  }
  return [...prefix, ...substring]
}

/** True when the line is exactly "/name" with a bare command name. */
export function bareCommandName(line: string): string | undefined {
  if (!line.startsWith("/")) return undefined
  const rest = line.slice(1)
  if (/^[a-z][a-z0-9_-]*$/i.test(rest)) return rest
  return undefined
}
