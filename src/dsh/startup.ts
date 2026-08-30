/**
 * `dsh --profile tui` command-line provider: parses the terminal app's flag
 * family (`--host`, `--port`, `--cwd`) and publishes the immutable values as
 * the `tuiStartup` service. Rows configured from flags inject that service,
 * so the Loader resolves their `!!js` expressions only after it exists.
 * Mirrors `@deepseek-ai/dsh-web-app/startup` without the commander
 * dependency.
 */

import type { AppExitLike, CmdlineArgsLike, DshContext } from "./types"
import { spawnSync } from "node:child_process"

export const name = "tui-startup"

export const inject = ["cmdlineArgs"]

/** Service provided by this ordinary plugin and injected by flag-configured rows. */
export const TUI_STARTUP_SERVICE = "tuiStartup"

/** What the tui rows read from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Loopback bind host (`127.0.0.1`). */
  host: string
  /** Listen port; `0` lets the OS pick a free one. */
  port: number
  /** Workspace directory for new sessions, absent when not named. */
  cwd: string | undefined
  /** Resume the most recently used session on startup (`-c`/`--continue`). */
  continueLast: boolean
}

/** Process streams the parser writes to; tests substitute captures. */
export const internals: {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Synchronous TCP occupancy probe (defaults to a tiny child process). */
  portProbe: (port: number) => boolean
} = {
  stdout: process.stdout,
  stderr: process.stderr,
  portProbe: defaultPortProbe,
}

/**
 * Synchronously probe whether 127.0.0.1:<port> accepts connections, via a
 * short-lived child process. A `connect` probe (not /proc/net/tcp) is
 * deliberate: under WSL2's localhost forwarding, a listener on the Windows
 * side shadows the same port inside WSL — the real multi-instance conflict —
 * and only an actual connect attempt sees it.
 */
function defaultPortProbe(port: number): boolean {
  const script =
    `require("net").connect(${port},"127.0.0.1")` +
    `.on("connect",()=>process.exit(0))` +
    `.on("error",()=>process.exit(1))` +
    `.setTimeout(700,function(){process.exit(1)})`
  try {
    const result = spawnSync(process.execPath, ["-e", script], { timeout: 1200, stdio: "ignore" })
    return result.status === 0
  } catch {
    return false
  }
}

/** First free port at or above `start` (a probe is ~1ms per miss). */
function nextFreePort(start: number, probe: (port: number) => boolean): number {
  for (let port = start; port <= 65535; port++) {
    if (!probe(port)) return port
  }
  return 0
}

const USAGE = `dsh --profile tui [options]

Run the DeepSeek Harness terminal client (dsh-cli) on top of the official dsh base.

Options:
  --host <host>   bind host (loopback only; default 127.0.0.1)
  --port <port>   listen port; pass 0 to let the OS pick a free one (default 3080)
  --cwd <dir>     workspace directory for new sessions (default: invoking directory)
  -c, --continue  resume the last session instead of starting a new one
  -h, --help      show this help
`

/** Report a usage error and request a failing exit. */
function fail(ctx: DshContext, message: string): void {
  internals.stderr.write(`${message}\n`)
  ctx.get<AppExitLike>("appExit")?.(1)
}

/**
 * Parse the launcher's inner arguments and publish the tui startup service.
 * @param ctx - plugin context carrying the command line and exit request.
 */
export function apply(ctx: DshContext): void {
  const cmdline = ctx.get<CmdlineArgsLike>("cmdlineArgs")
  if (cmdline === undefined) {
    throw new Error("tui-startup: the launcher must provide ctx.cmdlineArgs before the tree mounts")
  }
  const exit = ctx.get<AppExitLike>("appExit")
  const args = cmdline.get()

  let host: string | undefined
  let port: number | undefined
  let cwd: string | undefined
  let continueLast = false

  const valueOf = (
    argv: readonly string[],
    index: number,
    flag: string,
  ): { value: string; next: number } | undefined => {
    const eq = `${flag}=`
    const arg = argv[index] ?? ""
    if (arg.startsWith(eq)) return { value: arg.slice(eq.length), next: index }
    if (arg === flag) {
      const value = argv[index + 1]
      if (value === undefined) return undefined
      return { value, next: index + 1 }
    }
    return undefined
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ""
    if (arg === "-h" || arg === "--help") {
      internals.stdout.write(USAGE)
      exit?.(0)
      return
    }
    if (arg === "--host" || arg.startsWith("--host=")) {
      const value = valueOf(args, i, "--host")
      if (value === undefined) {
        fail(ctx, "error: option '--host' argument missing")
        return
      }
      host = value.value
      i = value.next
    } else if (arg === "--port" || arg.startsWith("--port=")) {
      const value = valueOf(args, i, "--port")
      if (value === undefined) {
        fail(ctx, "error: option '--port' argument missing")
        return
      }
      if (!/^\d+$/.test(value.value)) {
        fail(ctx, `error: --port must be a number, got ${JSON.stringify(value.value)}`)
        return
      }
      const parsed = Number(value.value)
      if (parsed > 65535) {
        fail(ctx, "error: --port must be between 0 and 65535")
        return
      }
      port = parsed
      i = value.next
    } else if (arg === "--cwd" || arg.startsWith("--cwd=")) {
      const value = valueOf(args, i, "--cwd")
      if (value === undefined) {
        fail(ctx, "error: option '--cwd' argument missing")
        return
      }
      cwd = value.value
      i = value.next
    } else if (arg === "-c" || arg === "--continue") {
      continueLast = true
    } else {
      fail(ctx, `error: unknown option '${arg}'`)
      return
    }
  }

  const resolvedHost = host ?? "127.0.0.1"
  if (resolvedHost !== "127.0.0.1") {
    fail(ctx, "error: only loopback --host 127.0.0.1 is supported (the terminal client would expose remote code execution otherwise)")
    return
  }

  // Multiple terminal instances are the normal case (one per terminal
  // window). When the user did not ask for a specific port and the default
  // 3080 is already taken — including by an instance on the Windows side
  // shadowed into WSL by localhost forwarding — fall back to a free port
  // instead of failing with EADDRINUSE. An explicit --port is always honored.
  let resolvedPort = port ?? 3080
  if (port === undefined && resolvedPort !== 0 && internals.portProbe(resolvedPort)) {
    resolvedPort = nextFreePort(resolvedPort + 1, internals.portProbe)
    internals.stderr.write(
      `[dsh-cli] 127.0.0.1:${port ?? 3080} 已被其他实例占用，自动改用端口 ${resolvedPort}（多实例并存时新实例自动避让；也可显式指定 --port <N>）\n`,
    )
  }

  ctx.provide(TUI_STARTUP_SERVICE, {
    host: resolvedHost,
    port: resolvedPort,
    cwd,
    continueLast,
  } satisfies TuiStartupValues)
}
