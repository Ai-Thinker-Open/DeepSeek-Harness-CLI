/**
 * `dsh --profile tui` terminal runner: reads the bound web server address,
 * spawns the OpenTUI client (`dist/cli.js`) against it via `DSH_URL` /
 * `DSH_CWD`, and requests a bounded dsh shutdown when the client exits.
 * Runs inside the official dsh process, so it imports no Bun APIs.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import Schema from "@deepseek-ai/schemastery"
import type { AppExitLike, DshContext } from "./types"
import type { TuiStartupValues } from "./startup"
import { bunVersionProblemFor } from "./node-version"
import { portableSpawnOptions, portableSpawnSyncOptions, resolveBun } from "./portable"

export const name = "tui-runner"

export const inject = ["tuiStartup", "webServer"]

/** Plugin config: the resolved values from the tuiStartup provider. */
export interface TuiRunnerConfig {
  startup?: TuiStartupValues
}

/**
 * Schemastery schema for {@link TuiRunnerConfig}, following the Cordis
 * convention of exporting a `Config` interface and same-named schema with
 * defaults written into the schema. The `tui-runner` patch row resolves its
 * `startup` from the `tuiStartup` service, so defaults here only matter when
 * the row omits a key.
 */
export const Config: Schema<TuiRunnerConfig> = Schema.object({
  startup: Schema.object({
    host: Schema.string().default("127.0.0.1"),
    port: Schema.number().default(3080),
    cwd: Schema.string(),
    continueLast: Schema.boolean().default(false),
  }),
})

/** The webServer service surface the runner reads for the bound address. */
export interface WebServerLike {
  host: string
  port: number
}

/** Process spawn seam; tests substitute a fake child process. */
export const internals: { spawn: typeof spawn; spawnSync: typeof spawnSync } = { spawn, spawnSync }

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

  // Forward the continue flag so the client attaches to the last session.
  const cliArgs = startup?.continueLast ? ["--continue"] : []
  const bunBin = resolveBun()
  // Refuse known-bad bun binaries up front instead of crashing the terminal
  // client mid-session (bun 1.4+ segfaults the OpenTUI renderer on Windows).
  const bunProbe = internals.spawnSync(bunBin, ["--version"], portableSpawnSyncOptions({ stdio: ["ignore", "pipe", "ignore"] }))
  if (bunProbe.status !== 0) {
    process.stderr.write("tui-runner: bun is required to run the terminal client (dist/cli.js). Install bun and re-run dsh --profile tui.\n")
    exit(1)
    return
  }
  const bunProblem = bunVersionProblemFor(String(bunProbe.stdout ?? "").trim(), process.platform === "win32")
  if (bunProblem) {
    process.stderr.write(`[dsh-cli] ${bunProblem}\n`)
    exit(1)
    return
  }
  const child = internals.spawn(bunBin, [cliPath, ...cliArgs], {
    stdio: "inherit",
    env: { ...process.env, DSH_URL: url, DSH_CWD: cwd },
    ...portableSpawnOptions({}),
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
