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
