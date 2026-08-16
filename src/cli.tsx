import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "./app"

const renderer = await createCliRenderer({
  externalOutputMode: "passthrough",
  targetFps: 30,
  exitOnCtrlC: true,
  openConsoleOnError: false,
  autoFocus: true,
  useMouse: true,
  useKittyKeyboard: null,
  useThread: false,
})

await render(() => <App />, renderer)

const shutdown = () => {
  try {
    renderer.destroy()
  } catch {
    // ignore teardown errors
  }
  setTimeout(() => process.exit(0), 20)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
process.on("SIGHUP", shutdown)
