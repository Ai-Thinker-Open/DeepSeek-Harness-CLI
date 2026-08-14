import vm from 'node:vm'
import type { ToolDef } from './types.ts'

/**
 * The workflow tool: run a plain-JS orchestration script in a sandboxed vm.
 * Mirrors dsh-tool-workflow: the script gets `agent`, `pipeline`, `parallel`,
 * `phase`, `log`, `args` and ends with `return <json-value>`.
 */
export const workflowTool: ToolDef = {
  name: 'workflow',
  description:
    'Run a JavaScript workflow script that orchestrates subagents at scale. The script body runs with top-level await and ends with `return <value>` (JSON-serializable). Hooks available: agent(prompt, opts?) -> runs one subagent to completion (resolve to its text, or with opts.schema to a validated object; null on failure; other opts: label, phase); pipeline(items, ...stages) -> run each item through the stages independently with no barrier (a stage throw drops that item to null); parallel(thunks) -> run functions concurrently and await all (a throwing thunk resolves to null); phase(title); log(message); args — the tool-call args verbatim. The result is the script return value, JSON-serialized.',
  parameters: {
    type: 'object',
    properties: {
      script: { type: 'string', description: 'The plain JavaScript workflow script body.' },
      meta: {
        type: 'object',
        description: 'Identity block: { name, description } for the workflow.',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
      args: { type: 'object', description: 'Optional JSON input exposed to the script as `args`.' },
    },
    required: ['script'],
  },
  permission: 'ask',
  planSafe: false,
  summary: (a) => `workflow: ${(a.meta as { name?: string } | undefined)?.name ?? 'script'}`,
  async execute(args, ctx) {
    const script = String(args.script ?? '')
    const logs: string[] = []

    const agent = async (prompt: string, opts: { schema?: Record<string, unknown>; label?: string; phase?: string } = {}) => {
      if (ctx.abortController.signal.aborted) throw new Error('workflow aborted')
      const jobId = ctx.spawnJob(prompt, { cwd: ctx.cwd })
      const job = await ctx.waitJob(jobId)
      if (job.status !== 'done') return null
      const text = job.result ?? ''
      if (opts.schema) {
        try {
          return JSON.parse(text)
        } catch {
          return null
        }
      }
      return text
    }

    const pipeline = async (items: unknown[], ...stages: Array<(prev: unknown, item: unknown, index: number) => Promise<unknown> | unknown>): Promise<unknown[]> => {
      const out: unknown[] = []
      for (let i = 0; i < items.length; i++) {
        let value: unknown = undefined
        let failed = false
        for (const stage of stages) {
          try {
            value = await stage(value, items[i], i)
          } catch {
            failed = true
            break
          }
        }
        out.push(failed ? null : value)
      }
      return out
    }

    const parallel = async (thunks: Array<() => Promise<unknown> | unknown>): Promise<unknown[]> => {
      return Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
    }

    const sandbox = {
      agent,
      pipeline,
      parallel,
      phase: (_t: string) => {},
      log: (m: string) => logs.push(String(m)),
      args: (args as { args?: unknown }).args ?? {},
      console: {
        log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
        error: (...a: unknown[]) => logs.push('error: ' + a.map(String).join(' ')),
        warn: (...a: unknown[]) => logs.push('warn: ' + a.map(String).join(' ')),
      },
      setTimeout,
      clearTimeout,
      Promise,
      JSON,
      Math,
      Date,
      RegExp,
      Error,
      Map,
      Set,
      Symbol,
      Object,
      Array,
      String,
      Number,
      Boolean,
      undefined,
    }

    const code = `(async () => {\n${script}\n})()`
    const context = vm.createContext(sandbox)
    try {
      const result = await vm.runInContext(code, context, { timeout: 600_000 })
      let serialized: string
      try {
        serialized = JSON.stringify(result, null, 2)
      } catch {
        throw new Error('workflow return value is not JSON-serializable')
      }
      const logBlock = logs.length ? `\n\n[workflow log]\n${logs.join('\n')}` : ''
      return `Workflow finished. Result:\n${serialized}${logBlock}`
    } catch (e) {
      const logBlock = logs.length ? `\n[workflow log]\n${logs.join('\n')}` : ''
      return `Workflow failed: ${(e as Error).message}${logBlock}`
    }
  },
}
