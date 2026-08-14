import os from 'node:os'
import type { WireMessage } from './types.ts'
import type { ToolDef } from './tools/types.ts'

export interface PromptOptions {
  cwd: string
  tools: ToolDef[]
  planMode: boolean
  model: string
  instructions?: string
  sessionId?: string
}

/** Build the system prompt, mirroring DSH's system-prompt role + guidance sections. */
export function buildSystemPrompt(opts: PromptOptions): string {
  const now = new Date()
  const toolList = opts.tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n')

  const planSection = opts.planMode
    ? `
## Plan mode (ACTIVE)

You are in PLAN MODE. Do not modify the workspace: no file writes, no bash commands with side effects.
Use read-only tools (fs_read, fs_ls, fs_glob, fs_grep, web_search, web_fetch, todo_write, skill_list) to research.
When you have a complete plan, call exit_plan_mode with the plan as markdown and await approval.
`
    : `
## Plan mode

Plan mode is OFF. You may act freely, subject to tool permission prompts.
Toggle it with Ctrl+E in the TUI; while active you must only plan.
`

  return `You are dskharness, a terminal agent for DeepSeek Harness (DSH). You help the user work in their workspace.

# Environment

- Workspace root: ${opts.cwd}
- Platform: ${os.platform()} (${os.arch()})
- Date/time: ${now.toISOString()}
- Model: ${opts.model}
- Session: ${opts.sessionId ?? 'new'}

# Working style

- Be concise and direct. Use markdown for structure: headings, lists, code blocks.
- Work in the workspace root unless told otherwise.
- Read files before editing them. Prefer fs_edit (string replace) for targeted changes; fs_write to create or fully replace.
- For multi-step work, maintain a todo list with todo_write so the user can follow progress.
- Run commands with bash; check the exit code in the result and the output.
- Use web_search / web_fetch for current information and cite URLs as markdown links.
- Delegation: use subagent for self-contained independent tasks; use workflow for fan-out over many independent pieces; background jobs are collected with job_output.
- For a long-running objective spanning many rounds, create a goal with the goal tool and update it as you make progress.
- Ask the user (ask_user) only when you genuinely cannot proceed without a decision.
- When a tool result says a permission was denied or plan mode blocked it, do not retry the same call; adapt.
- Never fabricate tool results. If a tool fails, report the error and adapt.

# Tools

You have access to these tools:

${toolList}

# Plan mode

${planSection}
${opts.instructions ? `# Additional instructions\n\n${opts.instructions}\n` : ''}
Remember: the whale is watching — be excellent.`
}

/** Convert chat messages to the OpenAI wire format. */
export function toWireMessages(messages: Array<{
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  tool_call_id?: string
  toolCalls?: Array<{ id: string; name: string; args: unknown }>
  toolResults?: Array<{ toolCallId: string; ok: boolean; output: string }>
}>): WireMessage[] {
  const out: WireMessage[] = []
  for (const m of messages) {
    if (m.role === 'assistant') {
      const wire: WireMessage = { role: 'assistant', content: m.content || null }
      if (m.toolCalls?.length) {
        wire.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        }))
      }
      out.push(wire)
      // tool results immediately after their assistant message
      for (const r of m.toolResults ?? []) {
        out.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.output })
      }
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}
