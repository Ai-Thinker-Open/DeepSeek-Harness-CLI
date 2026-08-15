#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DshOpenCodeBridge } from '../packages/dsh-bridge/src/bridge.ts'
import { startBridgeServer } from '../packages/dsh-bridge/src/server.ts'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] as string
  return fallback
}

function has(name: string): boolean {
  return process.argv.includes(name)
}

const positional = process.argv.find((item, index) => index >= 2 && !item.startsWith('-'))
const directory = path.resolve(arg('--directory', positional ?? process.cwd()))
const harnessUrl = arg('--dsh-url', process.env.DSH_CLI_HARNESS_URL ?? 'http://127.0.0.1:3080')
const port = Number(arg('--port', '4096'))

if (Number.isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`invalid port: ${arg('--port', '')}`)
}

const bridge = new DshOpenCodeBridge({ harnessUrl, directory })
await bridge.start()
const running = startBridgeServer(bridge, port)
const attachUrl = `http://127.0.0.1:${port}`

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = path.join(repoRoot, 'vendor', 'mimo-code')
const vendorEntry = path.join(vendorRoot, 'packages', 'opencode', 'src', 'index.ts')
const command = process.env.DSH_TUI_ATTACH_COMMAND
  ? process.env.DSH_TUI_ATTACH_COMMAND.split(' ')
  : existsSync(vendorEntry)
    ? ['bun', 'run', '--cwd', vendorRoot, vendorEntry, 'attach']
    : ['dsh', '--profile', 'dsh-tui']

const args = [...command, attachUrl]

if (existsSync(directory) && directory !== process.cwd()) args.push('--dir', directory)
if (has('--continue')) args.push('--continue')
if (arg('--session', '')) args.push('--session', arg('--session', ''))
if (has('--fork')) args.push('--fork')

const child = spawn(args[0] as string, args.slice(1), {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    MIMOCODE_DISABLE_MOUSE: process.env.MIMOCODE_DISABLE_MOUSE ?? '1',
    MIMOCODE_DISABLE_TERMINAL_TITLE: process.env.MIMOCODE_DISABLE_TERMINAL_TITLE ?? '1',
  },
})

let closing = false
const shutdown = () => {
  if (closing) return
  closing = true
  try {
    child.kill('SIGTERM')
  } catch {
    // already exited
  }
  running.close()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const exitCode = await new Promise<number | null>((resolve) => {
  child.once('error', (error) => {
    console.error(`dsh-tui: ${error.message}`)
    running.close()
    resolve(1)
  })
  child.once('exit', (code, signal) => {
    running.close()
    resolve(code ?? (signal ? 130 : 0))
  })
})

process.exit(exitCode ?? 0)
