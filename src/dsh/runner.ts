/**
 * `dsh --profile tui` terminal runner: reads the bound web server address,
 * spawns the OpenTUI client (`dist/cli.js`) against it via `DSH_URL` /
 * `DSH_CWD`, and requests a bounded dsh shutdown when the client exits.
 * Runs inside the official dsh process, so it imports no Bun APIs.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import Schema from "@deepseek-ai/schemastery"
import type { AppExitLike, DshContext } from "./types"
import type { TuiStartupValues } from "./startup"
import { bunVersionProblemFor } from "./node-version"
import { applyPendingUpdates } from "./silent-update"
import { portableSpawnOptions, portableSpawnSyncOptions, resolveBun } from "./portable"
import { debug, isDebugEnabled } from "../debug"

export const name = "tui-runner"

// `connection` (dsh-client-connection) is async to activate (it awaits the
// browser-auth secret), so declaring it here makes the Loader wait for it —
// otherwise tui-runner can prep the client URL before the launch-token service
// is published, leaving it unauthenticated. Older dsh still provides the
// service (just without `authenticatedUrl`), so injection stays safe.
export const inject = ["tuiStartup", "webServer", "connection"]

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
    port: Schema.number().default(3081),
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
  // dsh >= 0.1.2-rc.1 gates the /api surface behind browser launch-token auth.
  // The `connection` service (dsh-client-connection) can mint a one-time
  // launch-token URL for this process; pass it to the client so it can perform
  // the token -> signed-cookie exchange. Older dsh has no such service, so
  // authUrl stays undefined and the client connects unauthenticated as before.
  let authUrl: string | undefined
  try {
    const connection = ctx.get<{ authenticatedUrl?(baseUrl: string): string }>("connection")
    if (connection?.authenticatedUrl) {
      authUrl = connection.authenticatedUrl(url)
    } else if (connection === undefined) {
      if (isDebugEnabled()) debug("[dsh-cli] runner: connection service not found")
    }
  } catch (e) {
    if (isDebugEnabled()) debug(`[dsh-cli] runner: authenticatedUrl threw: ${(e as Error).message}`)
    authUrl = undefined
  }
  if (isDebugEnabled()) {
    debug(
      authUrl
        ? `[dsh-cli] runner minted launch-token URL (${url} -> ${authUrl})`
        : `[dsh-cli] runner has no connection.authenticatedUrl (${url}); client will connect unauthenticated`,
    )
  }
  // The terminal surface serves no static index, so claim the webserver `/`
  // seat and hand `GET /?token=...` (and the index) to connection.authorizeIndex.
  // That is what mints the signed `dsh-auth-*` cookie the client exchanges for
  // the launch token; without it the client's `/api/*` calls come back 401.
  try {
    const connection = ctx.get<{ authorizeIndex?(req: unknown, res: unknown): boolean }>("connection")
    const server = ctx.get<{
      register?(route: { kind: "exact"; path: string; handler: (req: unknown, res: unknown) => void }): void
    }>("webServer")
    if (connection?.authorizeIndex && server?.register) {
      server.register({
        kind: "exact",
        path: "/",
        handler: (req, res) => {
          const respond = (res as { writeHead(code: number, headers?: Record<string, string>): void; end(body?: string): void })
          // authorizeIndex writes the 303 + Set-Cookie for `/?token=` and the
          // 401 otherwise; when it returns true the caller may serve the index.
          if (!connection.authorizeIndex!(req, res)) return
          respond.writeHead(200, { "content-type": "text/html" })
          respond.end("<!doctype html><title>dsh-cli</title>")
        },
      })
      if (isDebugEnabled()) debug("[dsh-cli] runner registered / auth index route")
    }
  } catch (e) {
    if (isDebugEnabled()) debug(`[dsh-cli] runner could not register / auth index route: ${(e as Error).message}`)
  }
  const cwd = startup?.cwd ?? process.cwd()
  const cliPath = join(packageRoot(dirname(fileURLToPath(import.meta.url))), "dist", "cli.js")
  if (isDebugEnabled()) {
    debug(`[dsh-cli] runner loaded from ${import.meta.url}, client at ${cliPath}`)
  }

  // Forward the continue flag so the client attaches to the last session.
  const cliArgs = startup?.continueLast ? ["--continue"] : []
  // The terminal client bundle keeps `ws` external (scripts/build.ts), so it is
  // NOT self-contained: a missing `ws` fails at module load with a cryptic
  // "Cannot find package 'ws'". Check resolution from the client's directory
  // and fail fast with a friendly hint instead.
  try {
    createRequire(cliPath).resolve("ws")
  } catch {
    process.stderr.write(
      "tui-runner: the terminal client needs the `ws` package, but it is not installed in this profile.\nRun `pnpm install` (or `bun install`) here and then re-run `dsh --profile tui`.\n",
    )
    exit(1)
    return
  }
  const bunBin = resolveBun()
  // Refuse known-bad bun binaries up front instead of crashing the terminal
  // client mid-session (bun 1.4+ segfaults the OpenTUI renderer on Windows).
  const bunProbe = internals.spawnSync(bunBin, ["--version"], portableSpawnSyncOptions({ stdio: ["ignore", "pipe", "ignore"] }))
  if (bunProbe.status !== 0) {
    process.stderr.write(
      "tui-runner: bun is required to run the terminal client, but no bun binary was found.\n" +
        "This package normally ships bun as the `@oven/bun-*` optional dependency; a reinstall that " +
        "keeps optional deps (`npm i -g @ai-thinker/deepseek-harness-cli` without --no-optional, or " +
        "`pnpm install`) usually restores it. Otherwise install bun yourself and re-run `dsh --profile tui`:\n" +
        "  npm i -g bun        (or follow https://bun.sh/install)\n",
    )
    exit(1)
    return
  }
  const bunProblem = bunVersionProblemFor(String(bunProbe.stdout ?? "").trim(), process.platform === "win32")
  if (bunProblem) {
    process.stderr.write(`[dsh-cli] ${bunProblem}\n`)
    exit(1)
    return
  }
  // The tui profile runs inside a dsh process, so its launcher path never
  // reaches bin/dsh-cli; still apply any staged silent update (dsh-cli and the
  // harness) and surface a restart hint to the terminal client. Upgrading in
  // place is safe here: the running process keeps its loaded modules and picks
  // the new build on the next `dsh --profile tui`.
  const applied = applyPendingUpdates()
  if (applied.updated.length > 0) {
    process.env.DSH_RESTART_FOR_UPDATE = applied.updated.map((u) => `${u.pkg}@${u.version}`).join(" | ")
  }
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_URL: url, DSH_CWD: cwd }
  if (authUrl) env.DSH_AUTH_URL = authUrl
  const child = internals.spawn(bunBin, [cliPath, ...cliArgs], {
    stdio: "inherit",
    env,
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
