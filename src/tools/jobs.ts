import type { JobState } from '../types.ts'
import type { ToolDef } from './types.ts'

export const subagentTool: ToolDef = {
  name: 'subagent',
  description:
    'Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work. Give it a complete, standalone prompt. Foreground mode returns the subagent result; background mode returns a job id to collect with job_output. Subagents may use tools but not spawn further subagents.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The complete, self-contained task for the subagent.' },
      background: { type: 'boolean', description: 'Run in the background and return a job id immediately. Defaults to false.' },
      model: { type: 'string', description: 'Optional model override.' },
      label: { type: 'string', description: 'Short display label.' },
    },
    required: ['prompt'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `subagent: ${(a.label as string) || (a.prompt as string).slice(0, 50)}`,
  async execute(args, ctx) {
    const prompt = String(args.prompt ?? '')
    const jobId = ctx.spawnJob(prompt, { model: args.model as string | undefined, cwd: ctx.cwd })
    if (args.background) {
      return `Subagent started in background as job ${jobId}. Collect the result with job_output {job_id: "${jobId}"}.`
    }
    const job = await ctx.waitJob(jobId)
    if (job.status === 'done') return job.result ?? '(subagent returned nothing)'
    if (job.status === 'error') return `Subagent failed: ${job.error ?? 'unknown error'}`
    return `Subagent job ${jobId} ended with status ${job.status}`
  },
}

export const jobsListTool: ToolDef = {
  name: 'jobs_list',
  description: 'List background jobs (subagents, workflows) with their statuses.',
  parameters: { type: 'object', properties: {} },
  permission: 'auto',
  planSafe: true,
  summary: () => 'jobs_list',
  async execute(_args, ctx) {
    const jobs = ctx.listJobs()
    if (!jobs.length) return 'No background jobs.'
    return jobs
      .map((j) => {
        const t = j.finishedAt ? ` (${((j.finishedAt - j.startedAt) / 1000).toFixed(1)}s)` : ''
        return `${j.id}  [${j.status}]${t}  ${j.prompt.slice(0, 80)}`
      })
      .join('\n')
  },
}

export const jobOutputTool: ToolDef = {
  name: 'job_output',
  description: 'Read the output of a background job by id. Returns its final result once finished.',
  parameters: {
    type: 'object',
    properties: { job_id: { type: 'string' } },
    required: ['job_id'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `job_output ${a.job_id}`,
  async execute(args, ctx) {
    const job = ctx.getJobOutput(String(args.job_id ?? ''))
    if (!job) return `No job with id ${args.job_id}. Use jobs_list to see current jobs.`
    if (job.status === 'running') return `Job ${job.id} is still running. Check back with job_output.`
    if (job.status === 'error') return `Job ${job.id} failed: ${job.error ?? 'unknown error'}`
    return job.result ?? '(no output)'
  },
}

export const jobKillTool: ToolDef = {
  name: 'job_kill',
  description: 'Request cancellation of a background job by id.',
  parameters: {
    type: 'object',
    properties: { job_id: { type: 'string' } },
    required: ['job_id'],
  },
  permission: 'auto',
  planSafe: true,
  summary: (a) => `job_kill ${a.job_id}`,
  async execute(args, ctx) {
    const job = ctx.getJobOutput(String(args.job_id ?? ''))
    if (!job) return `No job with id ${args.job_id}.`
    ctx.killJob(job.id)
    return `Killed job ${job.id}.`
  },
}

export const jobTools: ToolDef[] = [subagentTool, jobsListTool, jobOutputTool, jobKillTool]

export function formatJob(job: JobState): string {
  return `${job.id} [${job.status}] ${job.prompt}`
}
