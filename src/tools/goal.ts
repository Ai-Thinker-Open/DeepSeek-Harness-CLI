import type { ToolDef } from './types.ts'

export interface GoalState {
  id: string
  objective: string
  revision: number
  phase: 'active' | 'completed' | 'blocked' | 'paused'
  roundsStarted: number
  maxGoalRounds?: number
  blockedReason?: string
  updatedAt: number
}

/** Per-session goal state (mirrors dsh-goal). */
export class GoalManager {
  private goal: GoalState | null = null

  get(): GoalState | null {
    return this.goal
  }

  create(objective: string, maxGoalRounds?: number): GoalState {
    if (this.goal && this.goal.phase === 'active') {
      throw new Error(
        `a goal is already active (revision ${this.goal.revision}). Update it with action "edit" instead of creating another.`,
      )
    }
    this.goal = {
      id: `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      objective,
      revision: 1,
      phase: 'active',
      roundsStarted: 0,
      maxGoalRounds,
      updatedAt: Date.now(),
    }
    return this.goal
  }

  update(action: string, extra: Partial<GoalState> = {}): GoalState {
    const g = this.goal
    if (!g) throw new Error('no goal exists — create one first with action "create"')
    let next: GoalState
    switch (action) {
      case 'edit':
        next = { ...g, ...extra, revision: g.revision + 1, updatedAt: Date.now() }
        break
      case 'complete':
        next = { ...g, phase: 'completed', updatedAt: Date.now() }
        break
      case 'blocked':
        if (!extra.blockedReason) throw new Error('action "blocked" requires blockedReason')
        next = { ...g, phase: 'blocked', blockedReason: extra.blockedReason, updatedAt: Date.now() }
        break
      case 'pause':
        next = { ...g, phase: 'paused', updatedAt: Date.now() }
        break
      case 'resume':
        next = { ...g, phase: 'active', updatedAt: Date.now() }
        break
      default:
        throw new Error(`unknown action "${action}"`)
    }
    this.goal = next
    return next
  }
}

export const goalTool: ToolDef = {
  name: 'goal',
  description:
    'Manage one long-running completion objective for this session. Actions: create (objective, max_goal_rounds?), get, update (action: edit|complete|blocked|pause|resume, with optional objective/blocked_reason).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'get', 'update'] },
      objective: { type: 'string', description: 'The concrete completion objective (create / edit).' },
      update_action: { type: 'string', enum: ['edit', 'complete', 'blocked', 'pause', 'resume'] },
      max_goal_rounds: { type: 'number' },
      blocked_reason: { type: 'string' },
    },
    required: ['action'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `goal ${a.action}`,
  async execute(args, ctx) {
    const manager = (ctx as unknown as { goalManager: GoalManager }).goalManager as GoalManager
    const action = String(args.action)
    if (action === 'create') {
      const objective = String(args.objective ?? '')
      if (!objective) throw new Error('goal create requires objective')
      const g = manager.create(objective, args.max_goal_rounds as number | undefined)
      return formatGoal(g)
    }
    if (action === 'get') {
      const g = manager.get()
      return g ? formatGoal(g) : 'No goal is set for this session.'
    }
    if (action === 'update') {
      const g = manager.update(String(args.update_action ?? 'edit'), {
        objective: args.objective as string | undefined,
        blockedReason: args.blocked_reason as string | undefined,
        maxGoalRounds: args.max_goal_rounds as number | undefined,
      })
      return formatGoal(g)
    }
    throw new Error(`unknown action "${action}"`)
  },
}

function formatGoal(g: GoalState): string {
  return [
    `Goal: ${g.objective}`,
    `id: ${g.id}  revision: ${g.revision}  phase: ${g.phase}`,
    g.blockedReason ? `blocked_reason: ${g.blockedReason}` : '',
    g.maxGoalRounds ? `max_goal_rounds: ${g.maxGoalRounds}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
