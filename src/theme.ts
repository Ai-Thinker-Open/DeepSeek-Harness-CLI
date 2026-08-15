/**
 * DeepSeek Harness CLI palette — semantic design tokens.
 *
 * The visual system is deliberately original: a warm graphite workspace with
 * one brand accent for actions, an indigo accent for the assistant, green for
 * the user, and quiet gray chrome for tool/thinking details. Hex values are
 * supported by Ink/Chalk on modern terminals and degrade gracefully to the
 * nearest ANSI color where the terminal cannot render truecolor.
 */
export const theme = {
  /** Brand and emphasis (actions, links, selected command). */
  brand: '#FF7A1A',
  /** Primary chrome: input frame, command highlight, links, headings. */
  primary: '#FF7A1A',
  /** Assistant role bar / messages. */
  assistant: '#8B9EFF',
  /** User role bar. */
  user: '#4ADE80',
  /** Thinking marker. */
  thinking: '#8A8A8E',
  /** Tool call / result chrome. */
  tool: '#9CA3AF',
  /** Success / completed. */
  success: '#4ADE80',
  /** Errors. */
  error: '#FB7185',
  /** Warnings / approvals. */
  warn: '#FBBF24',
  /** Plan mode. */
  plan: '#8B9EFF',
  /** Model name in the status line. */
  model: '#FACC15',
  /** Diff / branch markers. */
  diff: '#D8B4FE',
  /** Neutral dim text. */
  dim: '#6B7280',
  /** Slightly brighter secondary text. */
  muted: '#A1A1AA',
  /** Borders and separators. */
  border: '#3F3F46',
  /** Inline code background. */
  codeBg: '#27272A',
  /** Selected item background. */
  selectedBg: '#FF7A1A',
  /** Selected item foreground. */
  selectedFg: '#111111',
  /** Neutral surface tint used for small chips. */
  chipBg: '#3F3F46',
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
  assistant: 'dsh-cli',
  thinking: 'thinking',
  tool: '',
  toolResult: '',
  error: 'error',
} as const

/** Uppercase role labels used in the transcript chips. */
export const ROLE_CHIPS = {
  user: 'YOU',
  assistant: 'DSK',
  thinking: 'THINKING',
  tool: 'TOOL',
  toolResult: 'RESULT',
  error: 'ERROR',
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
  if (mode === 'plan') return 'PLAN'
  if (mode === 'yolo') return 'YOLO'
  return 'AGENT'
}

export function modeGlyph(mode: Mode): string {
  if (mode === 'plan') return '◆'
  if (mode === 'yolo') return '▲'
  return '✦'
}

export function modeBorderColor(mode: Mode): string {
  if (mode === 'yolo') return theme.error
  if (mode === 'plan') return theme.plan
  return theme.primary
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

/** Truncate a string to a display width without splitting wide characters. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  const chars = Array.from(text)
  let width = 0
  const out: string[] = []
  for (const ch of chars) {
    const w = ch.codePointAt(0)! > 0xffff || /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1
    if (width + w > max) break
    out.push(ch)
    width += w
  }
  const result = out.join('')
  return result === text ? text : `${result.slice(0, Math.max(0, max - 1))}…`
}

/** Shorten a path relative to the user's home directory. */
export function shortPath(cwd: string): string {
  const home = process.env.HOME ?? ''
  if (home && (cwd === home || cwd.startsWith(home + '/'))) {
    return `~${cwd.slice(home.length)}`
  }
  return cwd
}
