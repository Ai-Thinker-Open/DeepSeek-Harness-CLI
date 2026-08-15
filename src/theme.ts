/**
 * dskharness palette — semantic design tokens.
 * Blue is the emphasis color for important information (brand, session title,
 * links, command highlight, input frame); cyan marks the assistant; green the
 * user; gray keeps tool/thinking chrome in the background. All values are
 * terminal-safe named colors so the UI sits well on any theme.
 */
export const theme = {
  /** Brand and emphasis (important information). */
  brand: 'blue',
  /** Primary chrome: input frame, command highlight, links, headings. */
  primary: 'blue',
  /** Assistant role bar / messages. */
  assistant: 'cyan',
  /** User role bar. */
  user: 'green',
  /** Thinking marker. */
  thinking: 'gray',
  /** Tool call / result chrome. */
  tool: 'gray',
  /** Success / completed. */
  success: 'green',
  /** Errors. */
  error: 'red',
  /** Warnings / approvals. */
  warn: 'yellow',
  /** Plan mode. */
  plan: 'blue',
  /** Model name in the status line. */
  model: 'yellow',
  /** Diff / branch markers. */
  diff: 'magenta',
  /** Neutral dim text. */
  dim: 'gray',
}

/** Sigils used as left-hand markers for transcript entries (MiMo-Code style). */
export const SIGILS = {
  user: '▎',
  assistant: '▎',
  thinking: '✢',
  tool: '·',
  toolResult: '↳',
  error: '✖',
  system: '•',
} as const

/** Headline labels shown next to each sigil. */
export const ROLE_LABELS = {
  user: 'you',
  assistant: 'mimo',
  thinking: 'thinking',
  tool: '',
  toolResult: '',
  error: 'error',
} as const

/** Map a tool name to a short verb (MiMo-style "Reading…", "Running…"). */
export function verbForTool(toolName: string): string {
  const map: Record<string, string> = {
    bash: 'Running',
    fs_read: 'Reading',
    fs_write: 'Writing',
    fs_edit: 'Editing',
    fs_ls: 'Listing',
    fs_glob: 'Searching',
    fs_grep: 'Searching',
    fs_delete: 'Deleting',
    web_fetch: 'Fetching',
    web_search: 'Searching',
    todo_write: 'Updating todos',
    todo_list: 'Reading todos',
    goal: 'Managing goal',
    subagent: 'Delegating',
    workflow: 'Orchestrating',
    skill_list: 'Listing skills',
    skill_load: 'Loading skill',
    jobs_list: 'Listing jobs',
    job_output: 'Reading job',
    job_kill: 'Killing job',
  }
  return map[toolName] ?? 'Working'
}

/** Interaction modes (agent / plan / yolo), MiMo-style. */
export type Mode = 'agent' | 'plan' | 'yolo'

export function modeIndicator(mode: Mode): string {
  if (mode === 'plan') return '◆ PLAN'
  if (mode === 'yolo') return '▲ YOLO'
  return '◆ AGENT'
}

export function modeGlyph(mode: Mode): string {
  if (mode === 'plan') return '◇'
  if (mode === 'yolo') return '▲'
  return '✦'
}

export function modeBorderColor(mode: Mode): string {
  if (mode === 'yolo') return 'red'
  return 'blue'
}

/** Contextual hint shown inside the input frame (MiMo-style). */
export function footerHint(intent: string): string {
  switch (intent) {
    case 'running':
      return 'Ctrl+C interrupt · typing is kept'
    case 'completion':
      return '↑↓ select · Enter run · Esc close'
    case 'approval':
      return '↑↓ choose · Enter confirm · Esc deny'
    default:
      return 'Enter send · / for commands · /help'
  }
}

/** Keep the last `maxLines` lines of text with an "earlier" marker (MiMo tailText). */
export function tailText(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return [`… ${lines.length - maxLines} earlier line(s)`, ...lines.slice(-maxLines)].join('\n')
}

/** Indent reasoning lines with a `│` gutter (MiMo formatReasoning). */
export function formatReasoning(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line ? `│ ${line}` : '│'}`)
    .join('\n')
}

/** Decoration (sigil + color) for a message role/kind. */
export function decoration(kind: keyof typeof SIGILS): { sigil: string; color: string } {
  switch (kind) {
    case 'user':
      return { sigil: SIGILS.user, color: theme.user }
    case 'assistant':
      return { sigil: SIGILS.assistant, color: theme.assistant }
    case 'thinking':
      return { sigil: SIGILS.thinking, color: theme.thinking }
    case 'tool':
    case 'toolResult':
      return { sigil: kind === 'tool' ? SIGILS.tool : SIGILS.toolResult, color: theme.tool }
    case 'error':
      return { sigil: SIGILS.error, color: theme.error }
    default:
      return { sigil: SIGILS.system, color: theme.dim }
  }
}
