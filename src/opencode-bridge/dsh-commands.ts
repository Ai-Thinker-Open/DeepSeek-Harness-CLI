/**
 * DeepSeek Harness human-command compatibility contract.
 *
 * DSH does not treat every slash-prefixed string as a model prompt. A slash
 * line is parsed by the host `commands` registry and executed by a UI adapter
 * outside the model history. This module mirrors that grammar and the shipped
 * base command set so both the existing Ink TUI and the future OpenCode bridge
 * can share one source of truth.
 */

export type DshCommandName = 'plan' | 'goal' | 'compact' | 'permission'

export interface DshCommandDescriptor {
  name: DshCommandName
  description: string
  inputHint: string
  /** DSH command names accept no argument, except plan/goal/permission. */
  acceptsArgs: boolean
}

export const DSH_COMMANDS: readonly DshCommandDescriptor[] = [
  {
    name: 'plan',
    description: 'Enter or leave plan mode',
    inputHint: '[off|message]',
    acceptsArgs: true,
  },
  {
    name: 'goal',
    description: 'Set or view the goal for a long-running task',
    inputHint: '[<objective>|clear|edit <objective>|pause|resume]',
    acceptsArgs: true,
  },
  {
    name: 'compact',
    description: 'Compact older conversation history',
    inputHint: '',
    acceptsArgs: false,
  },
  {
    name: 'permission',
    description: 'Switch the permission preset (sandbox mode + approval policy)',
    inputHint: '<preset>',
    acceptsArgs: true,
  },
]

export const DSH_PERMISSION_PRESETS = ['workspace-write', 'danger-full-access'] as const

export interface ParsedDshCommand {
  name: DshCommandName
  rawInput: string
}

/**
 * The same byte-level grammar as DSH's `parseCommand`:
 * a slash at byte zero, a lowercase name containing letters, digits, `_` or
 * `-`, followed by end-of-input or whitespace.
 */
export function parseDshCommand(line: string): ParsedDshCommand | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line)
  if (match === null) return undefined
  const name = match[1]
  if (name === undefined) return undefined
  if (name !== 'plan' && name !== 'goal' && name !== 'compact' && name !== 'permission') {
    return undefined
  }
  return { name: name as DshCommandName, rawInput: line.slice(match[0].length) }
}

export type PlanCommand = { kind: 'on'; message?: string } | { kind: 'off' }

/** DSH `/plan`: exact argument `off` exits; otherwise plan mode is entered and any non-empty suffix becomes a steering message. */
export function planCommand(rawInput: string): PlanCommand {
  const message = rawInput.trim()
  if (message === 'off') return { kind: 'off' }
  if (message === '') return { kind: 'on' }
  return { kind: 'on', message }
}

export type GoalCommand =
  | { kind: 'view' }
  | { kind: 'clear' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'edit'; objective: string }
  | { kind: 'create'; objective: string }

/**
 * DSH `/goal` grammar. Control words are case-insensitive only when they
 * occupy the complete input. Every other non-empty suffix is an objective.
 */
export function goalCommand(rawInput: string): GoalCommand {
  const text = rawInput.trim()
  const lower = text.toLowerCase()
  if (text === '') return { kind: 'view' }
  if (lower === 'clear') return { kind: 'clear' }
  if (lower === 'pause') return { kind: 'pause' }
  if (lower === 'resume') return { kind: 'resume' }
  if (lower === 'edit') return { kind: 'edit', objective: '' }
  if (lower.startsWith('edit ')) return { kind: 'edit', objective: text.slice(5).trim() }
  return { kind: 'create', objective: text }
}

export type PermissionCommand = { kind: 'view' } | { kind: 'set'; preset: string } | { kind: 'unknown'; preset: string }

/** DSH `/permission`: bare reports the current preset; a known preset switches. */
export function permissionCommand(rawInput: string): PermissionCommand {
  const preset = rawInput.trim()
  if (preset === '') return { kind: 'view' }
  if ((DSH_PERMISSION_PRESETS as readonly string[]).includes(preset)) {
    return { kind: 'set', preset }
  }
  return { kind: 'unknown', preset }
}

/** DSH `/compact`: no arguments are accepted. */
export function compactCommand(rawInput: string): { ok: boolean; error?: string } {
  if (rawInput.trim() === '') return { ok: true }
  return { ok: false, error: 'Usage: /compact (no arguments)' }
}

export function commandDescriptors(): DshCommandDescriptor[] {
  return [...DSH_COMMANDS]
}
