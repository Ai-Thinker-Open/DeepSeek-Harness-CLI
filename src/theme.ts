/**
 * dskharness palette — MiMo-Code style: deliberately restrained.
 * Primary chrome is terminal-default cyan + dim, with green/red/yellow/blue
 * reserved for roles, errors, warnings, and plan mode. Named colors (not hex)
 * so the UI sits well on any terminal theme.
 */
export const theme = {
  /** Assistant role bar, input frame, brand. */
  primary: 'cyan',
  /** User role bar. */
  user: 'green',
  /** Thinking marker. */
  thinking: 'gray',
  /** Tool call / result chrome. */
  tool: 'gray',
  /** Errors. */
  error: 'red',
  /** Warnings / approvals. */
  warn: 'yellow',
  /** Plan mode. */
  plan: 'blue',
  /** Model name in the status line. */
  model: 'yellow',
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

/** Decoration (sigil + color) for a message role/kind. */
export function decoration(kind: keyof typeof SIGILS): { sigil: string; color: string } {
  switch (kind) {
    case 'user':
      return { sigil: SIGILS.user, color: theme.user }
    case 'assistant':
      return { sigil: SIGILS.assistant, color: theme.primary }
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
