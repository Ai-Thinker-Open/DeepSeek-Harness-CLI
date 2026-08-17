import type { CommandDescriptor } from "./harness/client"

/** One discoverable slash command shown in the popup (no leading slash). */
export interface CommandItem {
  name: string
  description: string
  input?: { hint: string }
  kind: "local" | "host"
}

/** TUI-local commands that run inside the client, no host session needed. */
export const LOCAL_COMMANDS: CommandItem[] = [
  { name: "sessions", description: "列出主机上的全部会话", kind: "local" },
  { name: "resume", description: "浏览已保存的会话（只读列表）", kind: "local" },
  { name: "help", description: "显示全部快捷命令", kind: "local" },
]

/**
 * The harness's shipped slash commands, hardcoded so the palette always shows
 * them even when `commands.list` discovery is unavailable or stale. They are
 * still dispatched to the host via `commands.execute`.
 */
export const HARNESS_COMMANDS: CommandItem[] = [
  { name: "compact", description: "Compact older conversation history", kind: "host" },
  { name: "feedback", description: "record feedback about this session", kind: "host", input: { hint: "<text>" } },
  {
    name: "goal",
    description: "set or view the goal for a long-running task",
    kind: "host",
    input: { hint: "[<objective>|clear|edit <objective>|pause|resume]" },
  },
  { name: "plan", description: "描述你的任务以生成计划（进入/退出计划模式）", kind: "host", input: { hint: "<任务描述|off>" } },
  { name: "export", description: "Export the session log", kind: "host" },
]

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
  return descriptors.map((d) => ({ name: d.name, description: d.description, input: d.input, kind: "host" as const }))
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
