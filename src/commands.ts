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
  { name: "help", description: "显示全部快捷命令", kind: "local" },
]

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
  const rest = line.trim().slice(1)
  if (/^[a-z][a-z0-9_-]*$/i.test(rest)) return rest
  return undefined
}
