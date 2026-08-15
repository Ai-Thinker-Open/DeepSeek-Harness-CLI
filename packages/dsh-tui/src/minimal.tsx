/** @jsxImportSource @opentui/solid */
import { render } from '@opentui/solid'
import { createCliRenderer } from '@opentui/core'

function App() {
  return (
    <box flexDirection="column" paddingLeft={1} paddingTop={1}>
      <text fg="#8B9EFF" bold>
        DeepSeek Harness CLI
      </text>
      <text fg="#A1A1AA">Minimal OpenTUI shell</text>
      <box border="round" borderColor="#8B9EFF" paddingLeft={1} paddingRight={1} marginTop={1}>
        <text>Ask anything…</text>
      </box>
    </box>
  )
}

const renderer = await createCliRenderer({
  externalOutputMode: 'passthrough',
  targetFps: 30,
  exitOnCtrlC: false,
  useMouse: false,
  autoFocus: true,
})

await render(() => <App />, renderer)
