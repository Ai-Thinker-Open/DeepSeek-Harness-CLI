import type { ToolContext } from '../types.ts'
import type { ToolDef } from './types.ts'

export interface ExecOptions {
  autoApprove: boolean
  alwaysAllow: Set<string>
}

export interface ExecResult {
  ok: boolean
  output: string
  denied?: boolean
}

/**
 * Gate and run one tool call: plan-mode enforcement, permission approval,
 * then execution. Errors become tool results the model can read (DSH-style).
 */
export async function runToolCall(
  def: ToolDef,
  args: Record<string, unknown>,
  ctx: ToolContext,
  opts: ExecOptions,
): Promise<ExecResult> {
  const planActive = ctx.planMode()
  if (planActive && !def.planSafe) {
    return {
      ok: false,
      denied: true,
      output: `Plan mode is active, so ${def.name} is not allowed. Finish planning first, then call exit_plan_mode to present your plan for approval.`,
    }
  }

  if (def.permission === 'ask' && !opts.autoApprove && !opts.alwaysAllow.has(def.name)) {
    const summary = def.summary?.(args) ?? def.name
    const decision = await ctx.requestPermission(def.name, summary)
    if (decision === 'deny') {
      return { ok: false, denied: true, output: `The user denied permission for ${def.name}. Do not retry without asking.` }
    }
    if (decision === 'always') opts.alwaysAllow.add(def.name)
  }

  try {
    const output = await def.execute(args, ctx)
    return { ok: true, output: String(output) }
  } catch (e) {
    return { ok: false, output: `${def.name} failed: ${(e as Error).message}` }
  }
}
