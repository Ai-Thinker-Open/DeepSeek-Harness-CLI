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
  // Keep kitty keyboard parsing enabled (the default): terminals such as
  // Windows Terminal emit CSI-u sequences (e.g. `ESC [ 57352u` for Up) once
  // the kitty protocol is active, and OpenTUI maps those back to the same
  // canonical names ("up"/"down"/"return") as legacy input. Legacy sequences
  // (`ESC [ A`, `ESC O A`) keep working unchanged. `events: true` also asks
  // for press/repeat/release reports — Windows Terminal 1.25+ with the kitty
  // protocol active signals an image-only paste with the Ctrl+V *release*
  // (`ESC [ 118;5:3u`), which the composer uses as a clipboard-read trigger.
  useKittyKeyboard: { events: true },
  useThread: false,
  onDestroy: () => {
    // OpenTUI restores the terminal (raw mode, cursor, alternate screen,
    // DECCKM, kitty protocol) before this callback runs. Give any trailing
    // ANSI output a moment to flush, then exit so the shell is left clean.
    setTimeout(() => process.exit(0), 30)
  },
})

// OpenTUI already restores the terminal on these signals (exitSignals) and on
// Ctrl+C (exitOnCtrlC). These handlers are a belt-and-braces fallback for
// environments where a signal arrives before the renderer's own listeners are
// installed; destroy() is idempotent and finalizes on the next frame.
const shutdown = () => {
  try {
    renderer.destroy()
  } catch {
    // ignore teardown errors
  }
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
process.on("SIGHUP", shutdown)

const fatal = (err: unknown) => {
  try {
    renderer.destroy()
  } catch {
    // ignore teardown errors
  }
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
}

process.on("uncaughtException", fatal)
process.on("unhandledRejection", fatal)

// `-c` / `--continue` resume the last session on startup; the flag reaches
// this client either directly (`dsh-cli -c`) or forwarded by the tui runner
// (`dsh --profile tui -c`), so scan the whole argv for it.
const continueLast = process.argv.includes("-c") || process.argv.includes("--continue")

await render(() => <App continueLast={continueLast} onExit={() => renderer.destroy()} />, renderer)
