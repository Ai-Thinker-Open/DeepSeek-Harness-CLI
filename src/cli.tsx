import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "./app"

const renderer = await createCliRenderer({
  externalOutputMode: "passthrough",
  targetFps: 60,
  exitOnCtrlC: true,
  openConsoleOnError: false,
  autoFocus: true,
  useMouse: true,
  useKittyKeyboard: null,
  useThread: false,
})

await render(() => <App />, renderer)
