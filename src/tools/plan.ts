import type { ToolDef } from './types.ts'

export const exitPlanModeTool: ToolDef = {
  name: 'exit_plan_mode',
  description:
    'Exit plan mode and present your plan for the user\u2019s review. Call it with the complete plan as markdown when you have finished planning. The user approves it (then you may execute), asks for revisions (you keep planning), or rejects it.',
  parameters: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'The complete plan, as markdown.' },
    },
    required: ['plan'],
  },
  permission: 'auto',
  planSafe: true,
  summary: () => 'exit_plan_mode',
  async execute(args, ctx) {
    if (!ctx.planMode()) {
      return 'Plan mode is not active. (You can toggle it in the TUI with Ctrl+E.)'
    }
    const plan = String(args.plan ?? '(no plan text)')
    const answer = await ctx.askUser({
      kind: 'plan-approval',
      title: 'Approve this plan?',
      body: plan,
      options: ['Approve plan', 'Request revisions', 'Reject plan'],
    })
    if (answer === 'Approve plan') {
      ctx.setPlanMode(false)
      return 'Plan approved. Plan mode is off — you may now execute the plan. Begin with the first step.'
    }
    if (answer === 'Request revisions') {
      return 'The user requested revisions. Revise the plan and call exit_plan_mode again.'
    }
    return 'The user rejected the plan. Stop planning work and ask what they would prefer instead.'
  },
}
