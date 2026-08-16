/**
 * Tool-row classification and display material, mirroring the DSH web
 * client's tool-call model: every model-facing action is classified into a
 * visual variant (Bash / Read / Edit / Write / Search / Code / Todo /
 * Question / Terminal / Job / others) with a title, leading glyph, one-line
 * summary and expanded-body text derived from the call args and result.
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
  bash: "❯",
  read: "❐",
  write: "✎",
  edit: "✎",
  search: "⌕",
  code: "⟨",
  todo: "☑",
  question: "?",
  terminal: "◉",
  job: "⚙",
  others: "✦",
}

export function toolIcon(name: string): string {
  return VARIANT_ICONS[classifyTool(name)]
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

/** One-line summary for any tool call, mirroring the web's summary keys. */
export function toolSummary(name: string, args: Record<string, unknown>): string {
  const variant = classifyTool(name)
  if (variant === "todo") {
    const summary = todoSummary(args)
    return summary ? truncate(summary, 80) : ""
  }
  const picked = pickString(args, SUMMARY_KEYS[variant])
  if (picked !== undefined) return truncate(firstLine(picked))
  for (const v of Object.values(args)) {
    if (typeof v === "string" && v !== "") return truncate(firstLine(v))
  }
  return ""
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
}

/** Everything the TUI needs to draw one tool row, derived once. */
export function toolRowModel(call: ToolCallRecord, result: ToolResultRecord | undefined): ToolRowModel {
  const variant = classifyTool(call.name)
  const title = variant === "others" ? call.name : toolTitle(call.name)
  const args = (call.args ?? {}) as Record<string, unknown>
  const summary = toolSummary(call.name, args)
  const body = toolBody(call.name, args)
  const output = result?.output ?? null
  const markers = variant === "bash" && output !== null ? bashMarkers(output) : { text: output ?? "" }
  return { variant, title, icon: VARIANT_ICONS[variant], summary, body, output, markers }
}
