/**
 * Tool-row classification and display material, mirroring the DSH web
 * client's tool-call model: every model-facing action is classified into a
 * visual variant (Bash / Read / Edit / Write / Search / Code / Todo /
 * Question / Terminal / Job / others) with a title, leading glyph, one-line
 * summary and expanded-body text derived from the call args and result.
 *
 * The leading glyphs are single-cell Unicode stand-ins for the official DSH
 * web-client SVG icons (packages/client/ui-primitives/src/icons in
 * deepseek-ai/DeepSeek-Harness): each variant below names the icon it
 * approximates. Choices stay in blocks that common terminal monospace fonts
 * cover (Geometric Shapes / Dingbats / Misc Symbols).
 */
import type { ToolCallRecord, ToolResultRecord } from "../session"

export type ToolVariant =
  | "bash"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "code"
  | "todo"
  | "question"
  | "terminal"
  | "job"
  | "others"

const TOOL_VARIANTS: Record<string, ToolVariant> = {
  bash: "bash",
  pwsh: "bash",
  read: "read",
  read_image: "read",
  web_fetch: "read",
  web_search: "search",
  grep: "search",
  glob: "search",
  write: "write",
  edit: "edit",
  str_replace_editor: "edit",
  run_code: "code",
  todo_write: "todo",
  ask_user_question: "question",
  terminal_open: "terminal",
  terminal_close: "terminal",
  terminal_list: "terminal",
  terminal_read: "terminal",
  terminal_send: "terminal",
  terminal_signal: "terminal",
  job_kill: "job",
  job_list: "job",
  job_output: "job",
}

export function classifyTool(name: string): ToolVariant {
  return TOOL_VARIANTS[name] ?? "others"
}

/** Figma-style row titles per variant (design literals). */
const VARIANT_TITLES: Record<ToolVariant, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  search: "Search",
  code: "Code",
  todo: "Todo",
  question: "Question",
  terminal: "Terminal",
  job: "Job",
  others: "Tool call",
}

/** Tool-owned titles that refine a generic variant without replacing it. */
const TOOL_TITLES: Record<string, string> = {
  pwsh: "Pwsh",
  web_search: "Search",
  web_fetch: "Fetch",
  grep: "Grep",
  glob: "Glob",
  read_image: "Read image",
  run_code: "Code",
  str_replace_editor: "Edit",
  ask_user_question: "Ask user",
  todo_write: "Todo",
  subagent: "Subagent",
  subagent_fork: "Subagent",
  report: "Report",
  interrupt_agent: "Interrupt agent",
  list_agents: "List agents",
  send_message: "Send message",
  skill: "Skill",
  create_goal: "Goal",
  get_goal: "Goal",
  update_goal: "Goal",
  session_search: "Session",
  session_trace: "Session",
  session_event_read: "Session",
  session_event_search: "Session",
  session_event_trace: "Session",
  schedule_create: "Schedule",
  schedule_list: "Schedule",
  schedule_delete: "Schedule",
  workflow: "Workflow",
  ralph: "Ralph",
  lsp: "LSP",
  exit_plan_mode: "Plan",
  cordis_define: "Cordis",
  cordis_run: "Run Cordis Plugin",
  cordis_stop: "Stop Cordis Plugin",
  cordis_undefine: "Remove Cordis Plugin",
  cordis_package_inspect: "Inspect",
  cordis_runtime_inspect: "Inspect",
  cordis_inspect_list: "Inspect",
  cordis_inspect_query: "Inspect",
  cordis_inspect_self: "Inspect",
}

export function toolTitle(name: string): string {
  return TOOL_TITLES[name] ?? VARIANT_TITLES[classifyTool(name)]
}

/** Leading glyph per variant (Unicode stand-ins for the DSH SVG icons). */
const VARIANT_ICONS: Record<ToolVariant, string> = {
  bash: "❯", // IconApiOutline14 (window+plug) → shell-prompt chevron
  read: "▤", // IconBrowseOutline16 (document with text lines)
  write: "✎", // IconEditOutline16 (pencil)
  edit: "✎", // IconEditOutline16 (pencil)
  search: "⌕", // IconSearchOutline16 (magnifier)
  code: "⟨", // IconCodeOutline16 (< > brackets)
  todo: "☑", // IconChecklistOutline14 (checklist)
  question: "?", // IconQuestionOutline14 (ring + question mark)
  terminal: "◉", // no official DSH counterpart (TUI extension)
  job: "⚙", // no official DSH counterpart (TUI extension)
  others: "✦", // IconSparkle16 (three sparkles)
}

/** Tool-owned leading glyphs that refine a variant without replacing it. */
const TOOL_ICONS: Record<string, string> = {
  web_search: "❍", // IconGlobeOutline14 (globe) — no reliable plain-Unicode globe, keep the web-ring stand-in
}

export function toolIcon(name: string): string {
  return TOOL_ICONS[name] ?? VARIANT_ICONS[classifyTool(name)]
}

/** Summary key preference per variant (args-derived). */
const SUMMARY_KEYS: Record<ToolVariant, readonly string[]> = {
  bash: ["description", "command"],
  read: ["file_path", "path", "url"],
  search: ["query", "pattern", "url"],
  write: ["file_path", "path"],
  edit: ["file_path", "path"],
  code: ["description"],
  todo: [],
  question: ["question"],
  terminal: ["sessionId", "id"],
  job: ["jobId", "id", "job_id"],
  others: [],
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = args[key]
    if (typeof v === "string" && v !== "") return v
  }
  return undefined
}

function firstLine(text: string): string {
  const nl = text.indexOf("\n")
  return nl === -1 ? text : text.slice(0, nl)
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export interface TodoItemLike {
  content: string
  status: string
}

/** Extract a well-formed todo list from `todo_write` args. */
export function todoItems(args: Record<string, unknown>): TodoItemLike[] {
  const todos = args.todos
  if (!Array.isArray(todos)) return []
  const out: TodoItemLike[] = []
  for (const raw of todos) {
    if (typeof raw !== "object" || raw === null) continue
    const t = raw as Record<string, unknown>
    const content = typeof t.content === "string" ? t.content : ""
    if (!content) continue
    out.push({ content, status: typeof t.status === "string" ? t.status : "pending" })
  }
  return out
}

/** One-line todo summary: "2/5 done · 1 running". */
export function todoSummary(args: Record<string, unknown>): string {
  const items = todoItems(args)
  if (items.length === 0) return ""
  const done = items.filter((i) => i.status === "completed").length
  const active = items.filter((i) => i.status === "in_progress").length
  return `${done}/${items.length} done${active > 0 ? ` · ${active} running` : ""}`
}

export interface QuestionItemLike {
  question: string
  options: string[]
}

/** Extract question text/options from `ask_user_question` args. */
export function questionItems(args: Record<string, unknown>): QuestionItemLike[] {
  const list = args.questions
  if (!Array.isArray(list)) return []
  const out: QuestionItemLike[] = []
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue
    const q = raw as Record<string, unknown>
    const question = typeof q.question === "string" ? q.question : ""
    if (!question) continue
    const options = Array.isArray(q.options)
      ? q.options
          .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
          .map((o) => (typeof o.label === "string" ? o.label : ""))
          .filter(Boolean)
      : []
    out.push({ question, options })
  }
  return out
}

/** Per-tool summary key preference for the generic (others) family. */
const TOOL_SUMMARY_KEYS: Record<string, readonly string[]> = {
  subagent: ["description", "prompt"],
  subagent_fork: ["description", "prompt"],
  report: ["output"],
  skill: ["name"],
  create_goal: ["objective"],
  schedule_create: ["prompt"],
  schedule_delete: ["id"],
  session_search: ["query"],
  session_event_search: ["query"],
  session_event_read: ["seq"],
  session_event_trace: ["seq"],
  session_trace: ["session_id"],
  interrupt_agent: ["agent_id"],
  send_message: ["message"],
  job_output: ["job_id"],
  job_kill: ["job_id"],
  exit_plan_mode: ["plan"],
  cordis_define: ["name", "purpose"],
  cordis_run: ["pluginId"],
  cordis_stop: ["pluginId"],
  cordis_undefine: ["pluginId"],
  cordis_inspect_self: ["pluginId"],
  cordis_inspect_query: ["method", "provider"],
}

/** Tool-specific one-line summaries that need more than a plain key pick. */
function toolSpecificSummary(name: string, args: Record<string, unknown>): string | undefined {
  const meta = args.meta
  if (name === "workflow" && typeof meta === "object" && meta !== null) {
    const m = meta as Record<string, unknown>
    const title = str(m.name) ?? str(m.description)
    return title ? truncate(firstLine(title)) : undefined
  }
  if (name === "lsp") {
    const op = str(args.operation)
    const file = str(args.file_path)
    const line = num(args.line)
    const col = num(args.character)
    if (!op) return undefined
    const at = file ? `${file}${line != null ? `:${line}` : ""}${col != null ? `:${col}` : ""}` : undefined
    return at ? `${op} · ${at}` : op
  }
  if (name === "update_goal") {
    const action = str(args.action)
    const id = str(args.goal_id)
    return action ? (id ? `${action} · ${id}` : action) : undefined
  }
  if (name === "send_message") {
    const id = str(args.subagent_id)
    if (id) return `→ ${id}`
    const message = str(args.message)
    return message ? truncate(firstLine(message)) : undefined
  }
  if (name === "schedule_create") {
    const prompt = str(args.prompt)
    const after = num(args.after_seconds)
    const every = num(args.every_seconds)
    const at = str(args.at)
    const when = at ?? (after != null ? `in ${after}s` : every != null ? `every ${every}s` : undefined)
    const head = prompt ? truncate(firstLine(prompt)) : undefined
    return when ? (head ? `${head} · ${when}` : when) : head
  }
  if (name === "interrupt_agent") {
    const id = str(args.agent_id)
    return id ? `✕ ${id}` : undefined
  }
  return undefined
}

/** One-line summary for any tool call, mirroring the web's summary keys. */
export function toolSummary(name: string, args: Record<string, unknown>): string {
  const variant = classifyTool(name)
  if (variant === "todo") {
    const summary = todoSummary(args)
    return summary ? truncate(summary, 80) : ""
  }
  const specific = toolSpecificSummary(name, args)
  if (specific !== undefined && specific !== "") return specific
  const toolKeys = TOOL_SUMMARY_KEYS[name]
  if (toolKeys) {
    const picked = pickString(args, toolKeys)
    if (picked !== undefined) return truncate(firstLine(picked))
  }
  const picked = pickString(args, SUMMARY_KEYS[variant])
  if (picked !== undefined) return truncate(firstLine(picked))
  for (const v of Object.values(args)) {
    if (typeof v === "string" && v !== "") return truncate(firstLine(v))
  }
  return ""
}

/** Readable expanded-body text for the generic action families. */
function toolSpecificBody(name: string, args: Record<string, unknown>): string | undefined {
  const meta = args.meta
  switch (name) {
    case "subagent":
    case "subagent_fork": {
      const parts: string[] = []
      const desc = str(args.description)
      if (desc) parts.push(desc)
      const prompt = str(args.prompt)
      if (prompt) parts.push(`prompt: ${truncate(prompt, 300)}`)
      if (args.run_in_background === true) parts.push("background: yes")
      return parts.length ? parts.join("\n") : undefined
    }
    case "report": {
      const output = str(args.output)
      return output ? truncate(output, 400) : undefined
    }
    case "interrupt_agent": {
      const id = str(args.agent_id)
      return id ? `agent: ${id}` : undefined
    }
    case "list_agents": {
      const scope = str(args.scope)
      return scope ? `scope: ${scope}` : undefined
    }
    case "send_message": {
      const parts: string[] = []
      const id = str(args.subagent_id)
      if (id) parts.push(`→ ${id}`)
      const message = str(args.message)
      if (message) parts.push(truncate(message, 200))
      return parts.length ? parts.join("\n") : undefined
    }
    case "create_goal": {
      const parts: string[] = []
      const objective = str(args.objective)
      if (objective) parts.push(objective)
      const rounds = num(args.max_goal_rounds)
      if (rounds != null) parts.push(`max rounds: ${rounds}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "update_goal": {
      const parts: string[] = []
      const id = str(args.goal_id)
      const rev = num(args.revision)
      const action = str(args.action)
      if (id) parts.push(`goal: ${id}`)
      if (rev != null) parts.push(`revision: ${rev}`)
      if (action) parts.push(`action: ${action}`)
      const objective = str(args.objective)
      if (objective) parts.push(objective)
      const reason = str(args.blocked_reason)
      if (reason) parts.push(`blocked: ${reason}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "schedule_create": {
      const parts: string[] = []
      const prompt = str(args.prompt)
      if (prompt) parts.push(truncate(prompt, 300))
      const after = num(args.after_seconds)
      const every = num(args.every_seconds)
      const at = str(args.at)
      if (after != null) parts.push(`after: ${after}s`)
      if (every != null) parts.push(`every: ${every}s`)
      if (at) parts.push(`at: ${at}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "schedule_delete": {
      const id = str(args.id)
      return id ? `schedule: ${id}` : undefined
    }
    case "lsp": {
      const parts: string[] = []
      const op = str(args.operation)
      const file = str(args.file_path)
      const line = num(args.line)
      const col = num(args.character)
      if (op) parts.push(op)
      if (file) parts.push(`${file}${line != null ? `:${line}` : ""}${col != null ? `:${col}` : ""}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "ralph": {
      const parts: string[] = []
      const objective = str(args.objective)
      if (objective) parts.push(objective)
      const rounds = num(args.maxRounds)
      if (rounds != null) parts.push(`max rounds: ${rounds}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "skill": {
      const name = str(args.name)
      return name ? name : undefined
    }
    case "session_search": {
      const query = str(args.query)
      return query ? `query: ${query}` : undefined
    }
    case "session_trace": {
      const id = str(args.session_id)
      return id ? `session: ${id}` : undefined
    }
    case "session_event_read":
    case "session_event_trace": {
      const seq = num(args.seq)
      const id = str(args.session_id)
      const parts: string[] = []
      if (seq != null) parts.push(`seq: ${seq}`)
      if (id) parts.push(`session: ${id}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "session_event_search": {
      const query = str(args.query)
      const parts: string[] = []
      if (query) parts.push(`query: ${query}`)
      const types = args.event_types
      if (Array.isArray(types) && types.length) parts.push(`types: ${types.join(",")}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "workflow": {
      const parts: string[] = []
      if (typeof meta === "object" && meta !== null) {
        const m = meta as Record<string, unknown>
        const title = str(m.name)
        if (title) parts.push(title)
        const desc = str(m.description)
        if (desc) parts.push(desc)
        const phases = m.phases
        if (Array.isArray(phases) && phases.length) parts.push(`phases: ${phases.length}`)
      }
      const script = str(args.script)
      if (script) parts.push(`script: ${truncate(script, 200)}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "exit_plan_mode": {
      const plan = str(args.plan)
      return plan ? truncate(plan, 300) : undefined
    }
    case "cordis_define": {
      const parts: string[] = []
      const title = str(args.name)
      if (title) parts.push(title)
      const purpose = str(args.purpose)
      if (purpose) parts.push(purpose)
      const plugin = args.plugin
      if (typeof plugin === "object" && plugin !== null) {
        const kind = (plugin as Record<string, unknown>).kind
        if (typeof kind === "string") parts.push(`kind: ${kind}`)
      }
      return parts.length ? parts.join("\n") : undefined
    }
    case "cordis_run": {
      const pluginId = str(args.pluginId)
      const packageId = str(args.packageId)
      const mode = str(args.mode)
      const parts: string[] = []
      if (pluginId) parts.push(`plugin: ${pluginId}`)
      if (packageId) parts.push(`package: ${packageId}`)
      if (mode) parts.push(`mode: ${mode}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "cordis_stop":
    case "cordis_undefine": {
      const pluginId = str(args.pluginId)
      return pluginId ? `plugin: ${pluginId}` : undefined
    }
    case "cordis_inspect_query": {
      const platform = str(args.platform)
      const provider = str(args.provider)
      const method = str(args.method)
      const parts: string[] = []
      if (platform || provider || method) parts.push([platform, provider, method].filter(Boolean).join("."))
      const input = args.input
      if (input !== undefined && input !== "") {
        try {
          parts.push(`input: ${JSON.stringify(input).slice(0, 200)}`)
        } catch {
          /* ignore */
        }
      }
      return parts.length ? parts.join("\n") : undefined
    }
    case "cordis_inspect_self": {
      const pluginId = str(args.pluginId)
      const packageId = str(args.packageId)
      const parts: string[] = []
      if (pluginId) parts.push(`plugin: ${pluginId}`)
      if (packageId) parts.push(`package: ${packageId}`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "job_output": {
      const parts: string[] = []
      const id = str(args.job_id)
      if (id) parts.push(`job: ${id}`)
      const wait = args.wait
      if (wait === true) parts.push("wait: yes")
      const timeout = num(args.timeout_ms)
      if (timeout != null) parts.push(`timeout: ${timeout}ms`)
      return parts.length ? parts.join("\n") : undefined
    }
    case "job_kill": {
      const parts: string[] = []
      const id = str(args.job_id)
      if (id) parts.push(`job: ${id}`)
      const reason = str(args.reason)
      if (reason) parts.push(`reason: ${reason}`)
      return parts.length ? parts.join("\n") : undefined
    }
    default:
      return undefined
  }
}

/**
 * Expanded-body input text: the command for shell tools, the program for
 * run_code, pretty-printed args for generic calls, null when the row has no
 * args body (file paths and search terms live in the summary slot).
 */
export function toolBody(name: string, args: Record<string, unknown>): string | null {
  const variant = classifyTool(name)
  if (variant === "bash") {
    const command = typeof args.command === "string" ? args.command.trim() : ""
    return command || null
  }
  if (variant === "code") {
    const code = typeof args.code === "string" ? args.code.trim() : ""
    return code || null
  }
  if (variant === "todo" || variant === "question" || variant === "read" || variant === "write" || variant === "edit" || variant === "search") {
    return null
  }
  const specific = toolSpecificBody(name, args)
  if (specific !== undefined) return specific
  const hasArgs = Object.keys(args).some((k) => args[k] !== undefined && args[k] !== "")
  if (!hasArgs) return null
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return null
  }
}

export interface BashMarkers {
  /** Output with recognized bracket markers stripped. */
  text: string
  exitCode?: number
  sandbox?: string
  truncated?: string
}

const MARKER_LINES = [/^\[exit code: (-?\d+)\]$/, /^\[sandbox: (.*)\]$/, /^\[([^\]]*(?:truncat|saved|spill)[^\]]*)\]$/i]

/** Split trailing bracket markers (`[exit code: N]`, `[sandbox: …]`) off shell output. */
export function bashMarkers(output: string): BashMarkers {
  const lines = output.split("\n")
  const markers: string[] = []
  while (lines.length > 0) {
    const last = lines[lines.length - 1]?.trim()
    const matched = last ? MARKER_LINES.find((re) => re.test(last)) : undefined
    if (!last || !matched) break
    markers.unshift(lines.pop() as string)
  }
  const result: BashMarkers = { text: lines.join("\n") }
  for (const marker of markers) {
    const exit = /^\[exit code: (-?\d+)\]$/.exec(marker)
    if (exit) {
      result.exitCode = Number(exit[1])
      continue
    }
    const sandbox = /^\[sandbox: (.*)\]$/.exec(marker)
    if (sandbox) {
      result.sandbox = sandbox[1]
      continue
    }
    result.truncated = marker.slice(1, -1)
  }
  return result
}

export interface EditPair {
  oldText?: string
  newText?: string
}

/** Old/new text for edit-style tools (edit, str_replace_editor). */
export function editPair(args: Record<string, unknown>): EditPair {
  const oldText = typeof args.old_string === "string" ? args.old_string : typeof args.old_str === "string" ? args.old_str : undefined
  const newText = typeof args.new_string === "string" ? args.new_string : typeof args.new_str === "string" ? args.new_str : undefined
  return { oldText: oldText === undefined || oldText === "" ? undefined : oldText, newText: newText === undefined || newText === "" ? undefined : newText }
}

/** Full text for `write` calls (the whole file becomes an added diff). */
export function writeText(args: Record<string, unknown>): string | undefined {
  const content = typeof args.content === "string" ? args.content : typeof args.file_text === "string" ? args.file_text : undefined
  return content === "" ? undefined : content
}

/** One replacement hunk fed into the diff viewer (old/new text pair). */
export interface DiffHunkLike {
  path?: string
  oldText?: string
  newText?: string
}

/** A unified-diff text plus the real content-line count (before truncation). */
export interface DiffTextResult {
  diff: string
  totalLines: number
}

/**
 * Build a unified-diff string for the OpenTUI Diff viewer from replacement
 * hunks. The OpenTUI viewer only renders the first patch of a diff, so hunks
 * are grouped per file and each file emits exactly one patch (one `---/+++`
 * header plus all of its `@@` hunks). `newFile` renders the file as a
 * creation (`--- /dev/null`). Content lines are capped at `maxLines`;
 * `totalLines` keeps the real count so the caller can show a truncation note.
 */
export function buildDiffText(
  hunks: DiffHunkLike[],
  options: { newFile?: boolean; maxLines?: number } = {},
): DiffTextResult | null {
  const maxLines = options.maxLines ?? 1000
  const byPath = new Map<string, DiffHunkLike[]>()
  for (const hunk of hunks) {
    const path = hunk.path || "file"
    const group = byPath.get(path) ?? []
    group.push(hunk)
    byPath.set(path, group)
  }
  const parts: string[] = []
  let totalLines = 0
  let remaining = maxLines
  for (const [path, group] of byPath) {
    if (remaining <= 0) break
    let emittedHeader = false
    for (const hunk of group) {
      const oldLines = options.newFile ? [] : hunk.oldText ? hunk.oldText.split("\n") : []
      const newLines = hunk.newText ? hunk.newText.split("\n") : []
      const oldCount = oldLines.length
      const newCount = newLines.length
      if (oldCount === 0 && newCount === 0) continue
      if (remaining <= 0) break
      if (!emittedHeader) {
        parts.push(options.newFile ? `--- /dev/null\n+++ b/${path}` : `--- a/${path}\n+++ b/${path}`)
        emittedHeader = true
      }
      parts.push(`@@ -${oldCount > 0 ? 1 : 0},${oldCount} +${newCount > 0 ? 1 : 0},${newCount} @@`)
      for (const line of oldLines) {
        totalLines++
        if (remaining > 0) {
          parts.push(`-${line}`)
          remaining--
        }
      }
      for (const line of newLines) {
        totalLines++
        if (remaining > 0) {
          parts.push(`+${line}`)
          remaining--
        }
      }
    }
  }
  if (parts.length === 0) return null
  return { diff: parts.join("\n") + "\n", totalLines }
}

/** Result text for a settled call; null while running or when empty. */
export function resultOutput(call: ToolCallRecord, result: ToolResultRecord | undefined): string | null {
  if (!result) return null
  return result.output || null
}

export interface ToolRowModel {
  variant: ToolVariant
  title: string
  icon: string
  summary: string
  body: string | null
  output: string | null
  markers: BashMarkers
  /** Structured card material from `tool/result` meta, when present. */
  card: ToolCardMeta | null
}

/** Narrowed `tool/result` presentation payload (the web's card models). */
export interface ToolCardMeta {
  kind: "terminal" | "diff" | "read" | "search"
  terminal?: { output?: string; exitCode?: number }
  diffs?: Array<{ path: string; oldText?: string; newText: string }>
  lines?: Array<{ number: number; text: string }>
  totalLines?: number
  files?: Array<{ path: string; matches: Array<{ lineNumber: number; line: string }> }>
  paths?: string[]
  total?: number
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined
}

/**
 * Parse the harness's `tool/result` `meta` into renderable card material.
 *
 * The wire metas carry no `card` discriminator (diff = `{diffs}`, read =
 * `{lines,path,…}`, search = `{shape,…}`); the `card` wrapper is a web-client
 * presentation concern. Detection is shape-first so real metas parse, with the
 * `{card:…}` forms kept for legacy fixtures.
 */
export function parseCardMeta(meta: unknown): ToolCardMeta | null {
  if (typeof meta !== "object" || meta === null) return null
  const m = meta as Record<string, unknown>
  if (Array.isArray(m.diffs)) {
    const diffs = m.diffs
      .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
      .map((d) => ({
        path: str(d.path) ?? "",
        // `oldText` may be null on the wire (pure insertion) → undefined.
        oldText: str(d.oldText),
        newText: str(d.newText) ?? "",
      }))
      .filter((d) => d.path !== "")
    return diffs.length > 0 ? { kind: "diff", diffs } : null
  }
  if (Array.isArray(m.lines)) {
    const lines = m.lines
      .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
      .map((l) => ({ number: num(l.number) ?? 0, text: str(l.text) ?? "" }))
    return { kind: "read", lines, totalLines: num(m.totalLines) }
  }
  if (m.shape === "paths" && Array.isArray(m.paths)) {
    return {
      kind: "search",
      paths: m.paths.filter((p): p is string => typeof p === "string"),
      total: num(m.total),
    }
  }
  if (m.shape === "matches" && Array.isArray(m.files)) {
    const files = m.files
      .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
      .map((f) => ({
        path: str(f.path) ?? "",
        matches: Array.isArray(f.matches)
          ? f.matches
              .filter((mt): mt is Record<string, unknown> => typeof mt === "object" && mt !== null)
              .map((mt) => ({ lineNumber: num(mt.lineNumber) ?? 0, line: str(mt.line) ?? "" }))
          : [],
      }))
      .filter((f) => f.path !== "")
    return files.length > 0 ? { kind: "search", files, total: num(m.total) } : null
  }
  if (m.card === "terminal") {
    return { kind: "terminal", terminal: { output: str(m.output), exitCode: num(m.exitCode) } }
  }
  return null
}

/** Everything the TUI needs to draw one tool row, derived once. */
export function toolRowModel(call: ToolCallRecord, result: ToolResultRecord | undefined): ToolRowModel {
  const variant = classifyTool(call.name)
  const title = variant === "others" ? call.name : toolTitle(call.name)
  const args = (call.args ?? {}) as Record<string, unknown>
  const summary = toolSummary(call.name, args)
  const body = toolBody(call.name, args)
  const output = result?.output ?? null
  const card = result?.meta !== undefined ? parseCardMeta(result.meta) : null
  const markers =
    variant === "bash"
      ? bashMarkers(card?.kind === "terminal" && card.terminal?.output !== undefined ? card.terminal.output : output ?? "")
      : { text: output ?? "" }
  return { variant, title, icon: toolIcon(call.name), summary, body, output, markers, card }
}
