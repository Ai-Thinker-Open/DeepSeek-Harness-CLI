import { render } from '@opentui/solid'
import { createCliRenderer } from '@opentui/core'
import { App } from './App.tsx'
import { DshTui } from './dsh.ts'

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] as string
  return fallback
}

const dsh = new DshTui({
  harnessUrl: arg('--dsh-url', process.env.DSH_CLI_HARNESS_URL ?? 'http://127.0.0.1:3080'),
  directory: arg('--directory', process.cwd()),
})
await dsh.start()

const sessionArg = arg('--session', '')
const continueLatest = process.argv.includes('--continue')

const renderer = await createCliRenderer({
  externalOutputMode: 'passthrough',
  targetFps: 30,
    exitOnCtrlC: false,
  autoFocus: true,
  useMouse: false,
})

await render(
  () => <App dsh={dsh} initialSessionId={sessionArg || undefined} continueLatest={continueLatest} />,
  renderer,
)
process.on('SIGINT', () => dsh.stop())
