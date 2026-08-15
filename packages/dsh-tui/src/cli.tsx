import { render } from '@opentui/solid'
import { createCliRenderer } from '@opentui/core'
import { App } from './App.tsx'

const renderer = await createCliRenderer({
  externalOutputMode: 'passthrough',
  targetFps: 30,
  exitOnCtrlC: true,
  autoFocus: true,
  useMouse: false,
})

await render(() => <App />, renderer)
