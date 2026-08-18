/**
 * `dsh --profile tui` terminal runner: reads the bound web server address,
 * spawns the OpenTUI client (`dist/cli.js`) against it via `DSH_URL` /
 * `DSH_CWD`, and requests a bounded dsh shutdown when the client exits.
 * Runs inside the official dsh process, so it imports no Bun APIs.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { AppExitLike, DshContext } from "./types"
import type { TuiStartupValues } from "./startup"

export const name = "tui-runner"

export const inject = ["tuiStartup", "webServer"]

/** Plugin config: the resolved values from the tuiStartup provider. */
export interface TuiRunnerConfig {
  startup?: TuiStartupValues
}

/** The webServer service surface the runner reads for the bound address. */
export interface WebServerLike {
  host: string
  port: number
}

/** Process spawn seam; tests substitute a fake child process. */
export const internals: { spawn: typeof spawn } = { spawn }

/** Locate the package root regardless of which copy the loader imported. */
function packageRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("tui-runner: unable to locate package root")
    dir = parent
  }
}

/**
 * Mount the terminal runner once the server is bound.
 * @param ctx - plugin context carrying the web server and app exit request.
 * @param config - resolved tuiStartup values.
 */
export function apply(ctx: DshContext, config: TuiRunnerConfig = {}): void {
  const webServer = ctx.get<WebServerLike>("webServer")
  if (webServer === undefined) {
    throw new Error("tui-runner: webServer service is unavailable")
  }
  const exit = ctx.get<AppExitLike>("appExit")
  if (exit === undefined) {
    throw new Error("tui-runner: the launcher must provide ctx.appExit before the tree mounts")
  }

  const startup = config.startup
  const url = `http://${webServer.host}:${webServer.port}`
  const cwd = startup?.cwd ?? process.cwd()
  const cliPath = join(packageRoot(dirname(fileURLToPath(import.meta.url))), "dist", "cli.js")
  if (process.env.DSH_DEBUG) {
    process.stderr.write(`[dsh-cli] runner loaded from ${import.meta.url}, client at ${cliPath}\n`)
  }

  const child = internals.spawn("bun", [cliPath], {
    stdio: "inherit",
    env: { ...process.env, DSH_URL: url, DSH_CWD: cwd },
  })

  child.on("error", (error) => {
    const message =
      error && (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "tui-runner: bun is required to run the terminal client (dist/cli.js). Install bun and re-run dsh --profile tui."
        : `tui-runner: failed to start terminal client: ${error.message}`
    process.stderr.write(`${message}\n`)
    exit(1)
  })

  child.on("exit", (code) => {
    exit(code ?? 0)
  })
}

/** Re-exported for tests that need a typed child handle. */
export type { ChildProcess }
