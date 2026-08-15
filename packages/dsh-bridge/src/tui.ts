import { DshOpenCodeBridge } from './bridge.ts'
import { startBridgeServer } from './server.ts'
import { existsSync } from 'node:fs'
import path from 'node:path'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] as string
  return fallback
}

const harnessUrl = arg('--dsh-url', process.env.DSH_CLI_HARNESS_URL ?? 'http://127.0.0.1:3080')
const port = Number(arg('--port', '4096'))
const positional = process.argv.find((item, index) => index >= 2 && !item.startsWith('-'))
const directory = arg('--directory', positional ?? process.cwd())
const vendorRoot = path.resolve(process.cwd(), 'vendor/mimo-code')
const vendorEntry = path.join(vendorRoot, 'packages/opencode/src/index.ts')
const attachCommand =
  process.env.DSH_TUI_ATTACH_COMMAND ??
  (existsSync(vendorEntry)
    ? `bun run --cwd ${vendorRoot} ${vendorEntry} attach`
    : 'dsh --profile dsh-tui')

const bridge = new DshOpenCodeBridge({ harnessUrl, directory })
await bridge.start()

const running = startBridgeServer(bridge, port)
const url = `http://127.0.0.1:${port}`

const args = [...attachCommand.split(' '), url]
if (directory !== process.cwd()) args.push('--dir', directory)

const child = Bun.spawn(args, {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
})

const exitCode = await child.exited
running.close()
process.exit(exitCode ?? 0)
