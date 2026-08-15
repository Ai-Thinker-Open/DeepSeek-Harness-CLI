import { DshOpenCodeBridge } from './bridge.ts'
import { startBridgeServer } from './server.ts'

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] as string
  return fallback
}

const harnessUrl = arg('--dsh-url', process.env.DSH_CLI_HARNESS_URL ?? 'http://127.0.0.1:3080')
const port = Number(arg('--port', '4096'))
const directory = arg('--directory', process.cwd())
const attachCommand = process.env.DSH_TUI_ATTACH_COMMAND ?? 'opencode attach'

const bridge = new DshOpenCodeBridge({ harnessUrl, directory })
await bridge.start()

const running = startBridgeServer(bridge, port)
const url = `http://127.0.0.1:${port}`

const child = Bun.spawn([...attachCommand.split(' '), url], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
})

const exitCode = await child.exited
running.close()
process.exit(exitCode ?? 0)
