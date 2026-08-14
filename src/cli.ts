#!/usr/bin/env node
import { render } from 'ink'
import type { AgentEvent, ChatMessage } from './types.ts'
import { ensureDirs, loadConfig, type CliConfig } from './config.ts'
import { Agent, QuestionCenter } from './agent.ts'
import { HarnessClient } from './harness/client.ts'
import { HarnessDriver } from './harness/driver.ts'
import { Store } from './store.ts'
import { appendEvent, createSession, listSessions, replaySession } from './sessions.ts'
import { buildApp } from './tui/App.tsx'
import { setupMcp } from './mcpSetup.ts'
import { defaultTools } from './tools/index.ts'
import type { ToolDef } from './tools/types.ts'
import { whaleBanner } from './whale.ts'
import pkg from '../package.json' with { type: 'json' }

interface CliArgs {
  prompt?: string
  model?: string
  yes: boolean
  resume?: string
  cont: boolean
  listSessions: boolean
  plan: boolean
  new: boolean
  cwd?: string
  apiKey?: string
  baseUrl?: string
  maxTurns?: number
  connect?: string
  standalone: boolean
  help: boolean
  version: boolean
}

const DEFAULT_HARNESS_URL = 'http://127.0.0.1:3080'

/** Probe a harness web instance; returns a client when reachable, else null. */
async function probeHarness(url: string): Promise<HarnessClient | null> {
  const client = new HarnessClient(url, 2000)
  try {
    await client.describe()
    client.timeoutMs = 60_000 // restore the normal timeout for the returned client
    return client
  } catch {
    return null
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { yes: false, cont: false, listSessions: false, plan: false, new: false, standalone: false, help: false, version: false }
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    const take = (name: string): string => {
      const v = argv[i + 1]
      if (v === undefined) throw new Error(`missing value for ${name}`)
      i++
      return v
    }
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--version' || a === '-v') args.version = true
    else if (a === '--yes' || a === '-y') args.yes = true
    else if (a === '--continue') args.cont = true
    else if (a === '--list-sessions') args.listSessions = true
    else if (a === '--plan') args.plan = true
    else if (a === '--new') args.new = true
    else if (a === '--standalone') args.standalone = true
    else if (a === '--connect') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) args.connect = take(a)
      else args.connect = DEFAULT_HARNESS_URL
    } else if (a.startsWith('--connect=')) args.connect = a.slice('--connect='.length)
    else if (a === '--prompt' || a === '-p') args.prompt = take(a)
    else if (a.startsWith('--prompt=')) args.prompt = a.slice('--prompt='.length)
    else if (a === '--model' || a === '-m') args.model = take(a)
    else if (a.startsWith('--model=')) args.model = a.slice('--model='.length)
    else if (a === '--reasoner') args.model = 'deepseek-reasoner'
    else if (a === '--resume') args.resume = take(a)
    else if (a.startsWith('--resume=')) args.resume = a.slice('--resume='.length)
    else if (a === '--cwd' || a === '-c') args.cwd = take(a)
    else if (a.startsWith('--cwd=')) args.cwd = a.slice('--cwd='.length)
    else if (a === '--api-key') args.apiKey = take(a)
    else if (a.startsWith('--api-key=')) args.apiKey = a.slice('--api-key='.length)
    else if (a === '--base-url') args.baseUrl = take(a)
    else if (a.startsWith('--base-url=')) args.baseUrl = a.slice('--base-url='.length)
    else if (a === '--max-turns' || a === '-t') args.maxTurns = Number(take(a))
    else if (a.startsWith('--max-turns=')) args.maxTurns = Number(a.slice('--max-turns='.length))
    else if (a.startsWith('-') && a !== '-') throw new Error(`unknown option ${a}`)
    else positional.push(a)
  }
  if (positional.length > 1) throw new Error(`unexpected extra arguments: ${positional.slice(1).join(' ')}`)
  if (positional.length === 1 && args.prompt === undefined) args.prompt = positional[0]
  return args
}

function applyArgs(config: CliConfig, args: CliArgs): CliConfig {
  const next = { ...config }
  if (args.model) next.model = args.model
  if (args.cwd) next.cwd = args.cwd
  if (args.apiKey) next.apiKey = args.apiKey
  if (args.baseUrl) next.baseUrl = args.baseUrl
  if (args.yes) next.autoApprove = true
  return next
}

const HELP = `dskharness — a terminal agent for DeepSeek Harness (DSH)

${whaleBanner()}

USAGE
  dskharness [options] [prompt]

Modes
  Interactive TUI        dskharness                     opencode-style terminal UI
  Headless               dskharness "write the tests"   run one prompt, print the answer
                         echo "hi" | dskharness         read the prompt from stdin
  Resume                 dskharness --resume <id>       open a session in the TUI
                         dskharness --continue          resume the most recent session

OPTIONS
  -p, --prompt <text>    Run headless with this prompt
  -m, --model <name>     Model (deepseek-chat | deepseek-reasoner) [env: DSH_CLI_MODEL]
      --reasoner         Shorthand for -m deepseek-reasoner
  -y, --yes              Auto-approve dangerous tools (no permission prompts)
      --plan             Start in plan mode (research only until plan approval)
      --connect [url]    Connect to a running DeepSeek Harness web instance
                         (default: auto-detect http://127.0.0.1:8080)
      --standalone       Force standalone mode (local agent, direct API) even
                         when a harness is reachable
      --resume <id>      Resume session <id> in the TUI
      --continue         Resume the most recent session
      --new              Start a fresh session
      --list-sessions    List saved sessions and exit
  -c, --cwd <dir>        Workspace root (default: current directory)
  -t, --max-turns <n>    Cap tool rounds in headless mode (default 50)
      --api-key <key>    DeepSeek API key [env: DEEPSEEK_API_KEY]
      --base-url <url>   OpenAI-compatible endpoint (default https://api.deepseek.com)
  -h, --help             Show this help
  -v, --version          Show version

MODES
  Connected (default when a harness is reachable): the CLI drives a real
  DeepSeek Harness session through its /api — sessions, tools, permissions,
  plan mode and history all live in the harness. No API key needed locally.
  Standalone: the CLI runs its own agent loop and talks to the DeepSeek API
  directly (needs DEEPSEEK_API_KEY).

TUI KEYS
  Enter          send            Ctrl+C    stop the agent / quit when idle
  Ctrl+N         new session     Ctrl+R    focus the sessions list
  Ctrl+E         plan mode       Ctrl+M    switch model (chat ⇄ reasoner)
  Tab            chat ⇄ sidebar  ↑↓       input history / list navigation
  PageUp/Down    scroll chat     Esc       clear input

CONFIG
  ~/.dskharness/config.json   { "apiKey", "model", "baseUrl", "autoApprove", "instructions", "mcpServers" }
  Sessions: ~/.dskharness/sessions/   Skills: ~/.dskharness/skills/<name>/SKILL.md

FEATURES (DSH surface)
  bash · fs_read/write/edit/ls/glob/grep/delete · web_search/web_fetch ·
  ask_user · todo_write/list · goal · subagent/jobs · workflow · skill ·
  plan mode (exit_plan_mode) · MCP stdio servers · session history/resume ·
  deepseek-reasoner thinking with the little-whale animation
`

function printSessions(): void {
  const sessions = listSessions()
  if (!sessions.length) {
    console.log('No sessions yet.')
    return
  }
  console.log('ID'.padEnd(16) + 'TITLE'.padEnd(40) + 'MODEL'.padEnd(20) + 'UPDATED')
  for (const s of sessions) {
    const t = new Date(s.updatedAt).toISOString().replace('T', ' ').slice(0, 19)
    console.log(s.id.padEnd(16) + (s.title || 'untitled').slice(0, 38).padEnd(40) + (s.model || '').padEnd(20) + t)
  }
}

async function runHeadless(config: CliConfig, prompt: string, args: CliArgs): Promise<number> {
  const mcp = await setupMcp(config)
  const tools: ToolDef[] = [...defaultTools(), ...mcp.defs]
  const { id } = createSession(config.model, config.cwd)
  const store = new Store()
  const questionCenter = new QuestionCenter(store, true)
  const printedCalls = new Map<string, string>() // toolCallId -> name

  const emit = (ev: AgentEvent) => {
    store.handleEvent(ev)
    if (ev.type === 'tool-call' && ev.call.status === 'running') {
      printedCalls.set(ev.call.id, ev.call.name)
      process.stderr.write(`  ● ${ev.call.name}  ${ev.call.summary ?? ''}\n`)
    } else if (ev.type === 'tool-result') {
      const name = printedCalls.get(ev.result.toolCallId) ?? 'tool'
      process.stderr.write(`  ${ev.result.ok ? '✓' : '✗'} ${name}\n`)
    } else if (ev.type === 'error') {
      process.stderr.write(`  ✗ ${ev.message}\n`)
    } else if (ev.type === 'status' && ev.status === 'thinking') {
      process.stderr.write('  🐳 thinking…\n')
    }
  }

  const agent = new Agent({
    config,
    store,
    sink: { emit, persist: (e) => appendEvent(id, e as never), questionCenter },
    tools,
    sessionId: id,
    cwd: config.cwd,
    model: config.model,
    planMode: args.plan,
    autoApprove: args.yes,
    maxTurns: args.maxTurns ?? 50,
  })

  const onSigint = () => {
    process.stderr.write('\n  ⏹ interrupted\n')
    agent.abort('SIGINT')
  }
  process.on('SIGINT', onSigint)

  try {
    await agent.sendUser(prompt)
  } finally {
    process.removeListener('SIGINT', onSigint)
    mcp.close()
  }

  const messages = store.getState().messages
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim()) as
    | ChatMessage
    | undefined
  if (last) {
    process.stdout.write(last.content + '\n')
  } else {
    const err = messages.find((m) => m.error)?.error ?? 'The agent produced no answer.'
    process.stderr.write(`✗ ${err}\n`)
    return 1
  }
  process.stderr.write(`\n[session ${id} saved]\n`)
  return 0
}

/** Headless run against a live harness instance. */
async function runHeadlessConnected(client: HarnessClient, config: CliConfig, prompt: string, args: CliArgs): Promise<number> {
  const describe = await client.describe()
  const model = describe.model ?? config.model
  const { sessionId } = await client.createSession(config.cwd)
  const store = new Store()
  const questionCenter = new QuestionCenter(store, true, args.yes)
  const driver = new HarnessDriver({
    client,
    store,
    questionCenter,
    sessionId,
    cwd: config.cwd,
    model,
  })
  driver.startListening()
  await driver.loadHistory()

  process.stderr.write(`  🔌 connected to harness ${describe.version} (model: ${model})\n`)
  process.stderr.write('  🐳 thinking…\n')
  const onSigint = () => {
    process.stderr.write('\n  ⏹ interrupted\n')
    driver.abort('SIGINT')
  }
  process.on('SIGINT', onSigint)
  try {
    await driver.sendUser(prompt)
  } finally {
    process.removeListener('SIGINT', onSigint)
    driver.close()
  }
  const answer = driver.getLastAnswer()
  if (answer) {
    process.stdout.write(answer + '\n')
  } else {
    process.stderr.write('✗ the harness produced no answer\n')
    return 1
  }
  process.stderr.write(`\n[harness session ${sessionId}]\n`)
  return 0
}

async function main(): Promise<void> {
  let args: CliArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`dskharness: ${(e as Error).message}\nTry --help`)
    process.exitCode = 1
    return
  }

  if (args.version) {
    console.log(`dskharness ${pkg.version}`)
    return
  }
  if (args.help) {
    console.log(HELP)
    return
  }
  if (args.listSessions) {
    printSessions()
    return
  }

  const config = applyArgs(loadConfig(), args)

  // Probe for a local DeepSeek Harness web instance (connected mode).
  let harness: HarnessClient | null = null
  if (!args.standalone) {
    const url = args.connect ?? process.env.DSH_CLI_HARNESS_URL ?? DEFAULT_HARNESS_URL
    harness = await probeHarness(url)
    if (harness) {
      process.stderr.write(`  🔌 connected to DeepSeek Harness at ${url}\n`)
    }
  }

  // Local session storage is only needed in standalone mode.
  if (!harness) ensureDirs()

  const headless = args.prompt !== undefined || !process.stdin.isTTY
  if (headless) {
    let prompt = args.prompt
    if (prompt === undefined) {
      // read piped stdin
      const chunks: Buffer[] = []
      for await (const c of process.stdin) chunks.push(c as Buffer)
      prompt = Buffer.concat(chunks).toString('utf8').trim()
    }
    if (!prompt) {
      console.error('dskharness: no prompt given (pass a prompt argument or pipe stdin)')
      process.exitCode = 1
      return
    }
    const code = harness
      ? await runHeadlessConnected(harness, config, prompt, args)
      : await runHeadless(config, prompt, args)
    process.exitCode = code
    return
  }

  // Interactive TUI
  if (harness) {
    const describe = await harness.describe()
    config.model = describe.model ?? config.model
    let initialId: string | undefined
    if (args.resume) initialId = args.resume
    else if (args.cont) initialId = (await harness.listSessions()).items[0]?.sessionId
    else if (args.new) initialId = undefined
    const store = new Store()
    const instance = render(buildApp(store, config, args.new ? undefined : initialId, undefined, harness))
    void instance.waitUntilExit().then(() => process.exit(0))
    return
  }

  const mcp = await setupMcp(config)
  const tools: ToolDef[] = [...defaultTools(), ...mcp.defs]
  let initialId: string | undefined
  if (args.resume) initialId = args.resume
  else if (args.cont) initialId = listSessions()[0]?.id
  else if (args.new) initialId = undefined

  const store = new Store()
  store.setSessionList(listSessions())
  if (initialId) {
    const data = replaySession(initialId)
    store.reset({
      messages: data.messages,
      todos: data.todos,
      planMode: data.planMode,
      sessionId: initialId,
      title: data.meta.title,
      model: data.meta.model || config.model,
    })
  }

  const instance = render(buildApp(store, config, args.new ? undefined : initialId, tools))
  void instance.waitUntilExit().then(() => {
    mcp.close()
    process.exit(0)
  })
}

main().catch((e) => {
  console.error(`dskharness: ${(e as Error).stack ?? e}`)
  process.exitCode = 1
})
