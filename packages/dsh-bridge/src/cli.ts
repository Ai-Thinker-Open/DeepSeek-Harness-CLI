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

if (Number.isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`invalid port: ${process.argv[process.argv.indexOf('--port') + 1] ?? ''}`)
}

const bridge = new DshOpenCodeBridge({ harnessUrl, directory })
await bridge.start()

const running = startBridgeServer(bridge, port)

const shutdown = () => {
  running.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
