import { render } from '@opentui/solid'
import { createCliRenderer } from '@opentui/core'
import path from 'node:path'
import { App } from './App.tsx'
import { DshTui } from './dsh.ts'

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] as string
  return fallback
}

const positional = process.argv.find((item, index) => index >= 2 && !item.startsWith('-'))

const dsh = new DshTui({
  harnessUrl: arg('--dsh-url', process.env.DSH_CLI_HARNESS_URL ?? 'http://127.0.0.1:3080'),
  directory: path.resolve(arg('--directory', positional ?? process.cwd())),
})
await dsh.start()

const sessionArg = arg('--session', '')
const continueLatest = process.argv.includes('--continue')

const renderer = await createCliRenderer({
  externalOutputMode: 'passthrough',
  targetFps: 30,
  exitOnCtrlC: false,
  openConsoleOnError: false,
  autoFocus: true,
  useMouse: false,
})

await render(
  () => <App dsh={dsh} initialSessionId={sessionArg || undefined} continueLatest={continueLatest} />,
  renderer,
)
process.on('SIGINT', () => dsh.stop())
