import { exec } from 'node:child_process'
import type { ToolDef } from './types.ts'

const MAX_OUTPUT = 30_000
const DEFAULT_TIMEOUT_MS = 300_000

export const bash: ToolDef = {
  name: 'bash',
  description:
    'Execute a bash command in the workspace. Captures stdout and stderr; the result includes the exit code. Use for building, running tests, git, and any shell work. Long-running commands time out at 5 minutes.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute.' },
      timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds (default 300000).' },
    },
    required: ['command'],
  },
  permission: 'ask',
  planSafe: false,
  summary: (a) => `$ ${(a.command as string).split('\n')[0]}`,
  execute(args, ctx) {
    return new Promise<string>((resolve, reject) => {
      const command = String(args.command ?? '')
      const timeoutMs = Math.min((args.timeoutMs as number) ?? DEFAULT_TIMEOUT_MS, 600_000)
      const child = exec(
        command,
        {
          cwd: ctx.cwd,
          timeout: timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        },
        (error, stdout, stderr) => {
          if (error && !(error as NodeJS.ErrnoException & { killed?: boolean }).killed && !error.message.includes('timeout')) {
            // non-zero exit is a normal tool result in DSH — report, don't throw
          }
          const code = typeof (error as { code?: number | string } | null)?.code === 'number' ? (error as { code: number }).code : 0
          const parts: string[] = []
          if (stdout.trim()) parts.push(stdout.trimEnd())
          if (stderr.trim()) parts.push(`[stderr]\n${stderr.trimEnd()}`)
          if (code !== 0) parts.push(`[exit code: ${code}]`)
          if (error?.message.includes('timeout')) parts.push(`[timed out after ${timeoutMs}ms]`)
          let out = parts.join('\n')
          if (!out) out = `[exit code: ${code}]`
          if (out.length > MAX_OUTPUT) out = out.slice(0, MAX_OUTPUT) + `\n… [output truncated]`
          resolve(out)
        },
      )
      // Abort the child when the whole generation is cancelled.
      const onAbort = () => {
        child.kill('SIGKILL')
      }
      ctx.abortController.signal.addEventListener('abort', onAbort, { once: true })
      child.on('close', () => ctx.abortController.signal.removeEventListener('abort', onAbort))
    })
  },
}
