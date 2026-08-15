/**
 * dskharness palette — DeepSeek Harness Web dark-theme design tokens.
 * Ported from the web shell's design-platform.css (--dsw-* tokens) so the
 * TUI keeps the exact look of the web interface:
 *   bg-base #151517 · sidebar #1B1B1C · brand #5686FE · active #43454A
 */
export const theme = {
  // surfaces
  bgBase: '#151517',
  bgLayer1: '#232324',
  bgLayer2: '#2C2C2E',
  bgLayer3: '#353536',
  sidebarFill: '#1B1B1C',
  inputFill: '#2C2C2E',
  // labels
  labelPrimary: '#F9FAFB',
  labelSecondary: '#CFD3D6',
  labelTertiary: '#ADB2B8',
  labelCaption: '#81858C',
  labelDimmed: '#43454A',
  // brand
  brand: '#5686FE',
  brandBright: '#679EFE',
  brandDeep: '#4176E6',
  // states
  success: '#22C55E',
  error: '#EF4444',
  warn: '#F59E0B',
  // borders
  border1: 'rgba(255,255,255,0.06)',
  border2: 'rgba(255,255,255,0.12)',
}

/** Truncate a string to a width, adding an ellipsis. */
export function truncate(text: string, width: number): string {
  if (text.length <= width) return text
  return text.slice(0, Math.max(0, width - 1)) + '…'
}

/** Shorten a cwd to ~/ form. */
export function shortPath(cwd: string): string {
  const home = process.env.HOME ?? ''
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`
  return cwd
}

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

/** Interaction modes (agent / plan / yolo). */
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
  if (mode === 'yolo') return theme.error
  return theme.brand
}

/** Contextual hint shown inside the input frame. */
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

/** Keep the last `maxLines` lines of text with an "earlier" marker. */
export function tailText(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return [`… ${lines.length - maxLines} earlier line(s)`, ...lines.slice(-maxLines)].join('\n')
}

/** Indent reasoning lines with a `│` gutter. */
export function formatReasoning(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line ? `│ ${line}` : '│'}`)
    .join('\n')
}

/** Sigils used as left-hand markers for transcript entries. */
export const SIGILS = {
  user: '▎',
  assistant: '▎',
  thinking: '✢',
  tool: '·',
  toolResult: '↳',
  error: '✖',
  system: '•',
} as const

export const ROLE_LABELS = {
  user: 'you',
  assistant: 'dskharness',
  thinking: 'thinking',
  tool: '',
  toolResult: '',
  error: 'error',
} as const

/** Decoration (sigil + color) for a message role/kind. */
export function decoration(kind: keyof typeof SIGILS): { sigil: string; color: string } {
  switch (kind) {
    case 'user':
      return { sigil: SIGILS.user, color: theme.brandBright }
    case 'assistant':
      return { sigil: SIGILS.assistant, color: theme.brandBright }
    case 'thinking':
      return { sigil: SIGILS.thinking, color: theme.labelCaption }
    case 'tool':
    case 'toolResult':
      return { sigil: kind === 'tool' ? SIGILS.tool : SIGILS.toolResult, color: theme.labelCaption }
    case 'error':
      return { sigil: SIGILS.error, color: theme.error }
    default:
      return { sigil: SIGILS.system, color: theme.labelCaption }
  }
}
