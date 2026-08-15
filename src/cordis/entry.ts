/**
 * Cordis plugin entry for DeepSeek Harness CLI (dsh-cli).
 *
 * Lets `dsh --profile cli` boot the dsh-cli terminal client inside the harness
 * process: the launcher hands the inner arguments through `ctx.cmdlineArgs`
 * (`dsh --profile cli "task"` → `['task']`), the plugin creates a host agent
 * in-process, bridges permission/ask questions to the TUI modal, and drives
 * either headless (print the answer, exit) or the interactive TUI.
 */
import { render } from 'ink'
import { randomUUID } from 'node:crypto'
import { Store } from '../store.ts'
import { QuestionCenter } from '../agent.ts'
import { CordisDriver } from './driver.ts'
import { buildApp } from '../tui/App.tsx'
import { loadConfig } from '../config.ts'

export const name = 'cli'
export const inject = ['cmdlineArgs', 'appExit', 'agents', 'sessions', 'agentDefaultModel', 'userQuestions', 'loader']

export function apply(ctx: any): void {
  const exit = ctx.get('appExit')
  const args = (ctx.get('cmdlineArgs')?.get?.() ?? []) as string[]
  void run(ctx, args).catch((e) => {
    console.error(`dsh-cli: ${(e as Error).message}`)
    exit?.(1)
  })
}

async function run(ctx: any, args: string[]): Promise<void> {
  const exit = ctx.get('appExit')
  await ctx.get('loader')?.await()

  // ── create the in-process host agent ──
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (!agents || !defaultModel) throw new Error('dsh-cli plugin requires agents + agentDefaultModel services')
  const selection = defaultModel.currentSelection()
  const sessionId = `session-${randomUUID()}`
  const { agent } = await agents.create({
    sessionId,
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
  })
  await agent.whenIdle()

  const store = new Store()
  const config = loadConfig()
  config.cwd = process.cwd()
  config.model = selection.model
  const autoApprove = process.env.DSH_CLI_AUTO_APPROVE === '1'
  const questionCenter = new QuestionCenter(store, false, autoApprove)

  const driver = new CordisDriver({
    ctx,
    agent,
    store,
    questionCenter,
    sessionId: agent.session.id,
    model: selection.model,
    cwd: process.cwd(),
  })
  driver.subscribe()

  // bridge host questions (ask_user / permissions / plan review) to the TUI modal
  ctx.get('userQuestions')?.registerProvider?.({
    ask: (request: { questions: unknown[] }) => driver.questionFor(request as never),
  })

  const positional = args.filter((a) => !a.startsWith('-'))
  const prompt = positional[0]

  if (prompt) {
    // ── headless: run one turn, print the answer, exit ──
    process.stderr.write(`  🐳 DeepSeek Harness CLI (in-process harness agent) · ${selection.model}\n`)
    await driver.sendUser(prompt)
    await sessions?.flush?.(agent.session).catch(() => {})
    const answer = driver.getLastAnswer()
    if (answer) process.stdout.write(answer + '\n')
    else process.stderr.write('✗ the agent produced no answer\n')
    exit?.(answer ? 0 : 1)
    return
  }

  // ── interactive TUI ──
  const instance = render(
    buildApp(store, config, undefined, undefined, undefined, {
      ctx,
      agent,
      model: selection.model,
      questionCenter,
      sessionId: agent.session.id,
    }),
  )
  void instance.waitUntilExit().then(() => {
    void sessions?.flush?.(agent.session).catch(() => {})
    exit?.(0)
  })
}
