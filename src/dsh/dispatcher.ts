/**
 * `dsh-cli` command dispatcher: reuse an already-running harness when one is
 * reachable, otherwise ensure the official `dsh` CLI and the `tui` profile
 * (this package as a bundle) exist, then boot `dsh --profile tui` which
 * starts the harness transport and the terminal client together.
 */

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { Socket } from "node:net"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { bunVersionProblemFor, nodeVersionProblem } from "./node-version"
import { portableSpawnOptions, portableSpawnSyncOptions, resolveBun } from "./portable"
export { applyPendingUpdates } from "./silent-update"
export { bootstrapAll } from "./bootstrap"

export const DEFAULT_HARNESS_URL = "http://127.0.0.1:3081"
export const PROFILE_NAME = "tui"

/** Locate the package root from a source or built module location. */
function findRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("dsh-cli: unable to locate package root")
    dir = parent
  }
}

const PKG_ROOT = findRoot(dirname(fileURLToPath(import.meta.url)))
const TUI_CLI = join(PKG_ROOT, "dist", "cli.js")
const SILENT_UPDATE_AGENT = join(PKG_ROOT, "dist", "silent-update-agent.js")

function readManifest(): { name?: string; version?: string } {
  return JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { name?: string; version?: string }
}

const PKG_NAME = readManifest().name ?? "@ai-thinker/deepseek-harness-cli"
const PKG_VERSION = readManifest().version ?? "0.0.0"

/**
 * Bundle names that pointed at this package before renames. Profiles created
 * under the old name keep both entries after `dsh plugin add` runs with the
 * new name; applying this package's cordis patch twice then fails the loader
 * with `duplicate loader entry id`. Startup migrates those entries to the
 * current name.
 */
const LEGACY_BUNDLE_NAMES = new Set(["deepseek-harness-cli"])

function profileDir(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh")
  return join(home, "profiles", PROFILE_NAME)
}

/** Version of the dsh-cli bundle installed inside the tui profile, or null. */
function installedProfileBundleVersion(dir: string): string | null {
  try {
    const manifest = join(dir, "node_modules", PKG_NAME, "package.json")
    if (!existsSync(manifest)) return null
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }
    return typeof parsed.version === "string" ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * pnpm blocks dependency build scripts unless they are allowlisted.
 * pnpm 10 uses `onlyBuiltDependencies`; pnpm 11 replaces that with the
 * `allowBuilds` map (and auto-fills unapproved packages with a placeholder,
 * which also fails the install). Write both into the profile's
 * pnpm-workspace.yaml before the harness installs the bundle, and flip any
 * existing placeholder for this package to `true`.
 */
function allowProfileBuilds(): void {
  const dir = profileDir()
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, "pnpm-workspace.yaml")
    const marker = `  - ${JSON.stringify(PKG_NAME)}`
    let text = existsSync(file) ? readFileSync(file, "utf8") : ""
    const lines = text.split(/\r?\n/)
    let allowBuildsHeader = -1
    let hasAllowEntry = false
    let changed = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ""
      if (/^allowBuilds:\s*(?:#.*)?$/.test(line)) {
        allowBuildsHeader = i
        continue
      }
      if (allowBuildsHeader >= 0 && i > allowBuildsHeader && /^\s+\S/.test(line) && line.includes(PKG_NAME)) {
        hasAllowEntry = true
        const colon = line.lastIndexOf(":")
        if (colon >= 0 && line.slice(colon + 1).trim() !== "true") {
          lines[i] = `${line.slice(0, colon + 1)} true`
          changed = true
        }
      }
    }
    if (allowBuildsHeader >= 0 && !hasAllowEntry) {
      lines.splice(allowBuildsHeader + 1, 0, `  ${JSON.stringify(PKG_NAME)}: true`)
      changed = true
    }
    if (changed) text = lines.join("\n")
    if (allowBuildsHeader < 0) {
      text = `${text.trimEnd()}\nallowBuilds:\n  ${JSON.stringify(PKG_NAME)}: true\n`
    }
    // pnpm 10 compatibility (pnpm 11 ignores this field, so it is harmless).
    if (!text.includes(marker)) {
      if (/^onlyBuiltDependencies:\s*$/m.test(text)) {
        text = text.replace(/^onlyBuiltDependencies:\s*$/m, `onlyBuiltDependencies:\n${marker}`)
      } else {
        text = `${text.trimEnd()}\nonlyBuiltDependencies:\n${marker}\n`
      }
    }
    writeFileSync(file, text)
  } catch {
    // Best-effort: pnpm may still succeed without the allowlist.
  }
}

/** True when a profile bundle refers to this package under any (old or new) name. */
function isThisPackage(bundle: string): boolean {
  return bundle === PKG_NAME || LEGACY_BUNDLE_NAMES.has(bundle)
}

/**
 * Read the tui profile manifest, migrate legacy bundle entries for this
 * package to the current name (deduplicating), and persist the result.
 * Returns whether the profile registers this package after migration.
 */
function normalizeProfileBundles(): boolean {
  const manifestPath = join(profileDir(), "package.json")
  let manifest: {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest
  } catch {
    return false
  }
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return false

  let changed = false
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const bundle of bundles) {
    const key = isThisPackage(bundle) ? PKG_NAME : bundle
    if (seen.has(key)) {
      if (key !== bundle) changed = true
      continue
    }
    seen.add(key)
    normalized.push(key)
    if (key !== bundle) changed = true
  }
  if (manifest.dependencies) {
    for (const dep of Object.keys(manifest.dependencies)) {
      if (dep !== PKG_NAME && LEGACY_BUNDLE_NAMES.has(dep)) {
        delete manifest.dependencies[dep]
        changed = true
      }
    }
  }
  if (changed && manifest.dsh?.profile) {
    manifest.dsh.profile.bundles = normalized
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return seen.has(PKG_NAME)
}

/** Probe a harness at `url` with a cheap `host.describe` RPC. */
async function probe(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/host.describe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: "dsh-cli-probe",
        method: "host.describe",
        payload: {},
      }),
      signal: controller.signal,
    })
    if (!res.ok) return false
    const body = (await res.json()) as { result?: { ok?: boolean } }
    return body.result?.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve how to invoke the official dsh CLI: global binary or npx. */
function resolveDsh(): { bin: string; prefix: string[] } {
  const probeResult = internals.spawnSync("dsh", ["--help"], portableSpawnSyncOptions({ stdio: "ignore" }))
  if (probeResult.status === 0) return { bin: "dsh", prefix: [] }
  // Reuse an already-installed npx cache entry instead of asking npx to
  // resolve the package every launch (the npm registry round-trip is what
  // makes startup slow when the harness is not already running).
  const cached = cachedNpxDsh()
  if (cached) return { bin: cached, prefix: [] }
  return { bin: "npx", prefix: ["--yes", "@deepseek-ai/dsh"] }
}

/** Locate `node_modules/.bin/dsh` inside an existing npx cache entry. */
function cachedNpxDsh(): string | undefined {
  const npxRoot = process.env.DSH_NPX_CACHE ?? join(homedir(), ".npm", "_npx")
  let entries: string[]
  try {
    entries = readdirSync(npxRoot)
  } catch {
    return undefined
  }
  for (const entry of entries) {
    const bin = join(npxRoot, entry, "node_modules", ".bin", process.platform === "win32" ? "dsh.cmd" : "dsh")
    if (existsSync(bin)) return bin
  }
  return undefined
}

function exitCodeOf(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolveExit) => {
    child.on("error", () => resolveExit(1))
    child.on("exit", (code) => resolveExit(code ?? 1))
  })
}

/** True when something is listening on 127.0.0.1:<port> (even a non-harness). */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = new Socket()
    socket.setTimeout(800)
    socket.once("connect", () => {
      socket.destroy()
      resolvePort(true)
    })
    socket.once("timeout", () => {
      socket.destroy()
      resolvePort(false)
    })
    socket.once("error", () => resolvePort(false))
    socket.connect(port, "127.0.0.1")
  })
}

/**
 * Spawn a CLI that may be a `.cmd` shim on Windows (npm/pnpm/dsh). Node can
 * only launch `.cmd` shims through the shell, so use `shell: true` there;
 * stderr is piped back so failures show the underlying error.
 */
function runPortable(command: string, args: string[]): ReturnType<typeof spawnSync> {
  return internals.spawnSync(command, args, portableSpawnSyncOptions({ stdio: ["ignore", "inherit", "pipe"] }))
}

/** Test seam: probe, process spawn, and synchronous spawn. */
export const internals: {
  probe: typeof probe
  spawn: typeof spawn
  spawnSync: typeof spawnSync
  stageUpdates: typeof stageUpdates
} = { probe, spawn, spawnSync, stageUpdates }

/**
 * Spawn the background silent-update agent (fire-and-forget, never blocks
 * startup, reuses the running process's node so no PATH probe is needed).
 */
function stageUpdates(): void {
  if (!existsSync(SILENT_UPDATE_AGENT)) return
  if (process.env.DSH_DEBUG === "1") process.stderr.write("[dsh-cli] staging background updates (silent-update-agent)\n")
  const child = internals.spawn(process.execPath, [SILENT_UPDATE_AGENT], {
    stdio: "ignore",
    detached: true,
    windowsHide: true,
    ...portableSpawnOptions({}),
  })
  child.unref()
}

/**
 * Run the dispatcher and resolve with the process exit code.
 * @param args - arguments forwarded verbatim to `dsh --profile tui`.
 */
export async function run(args: readonly string[]): Promise<number> {
  const versionProblem = nodeVersionProblem()
  if (versionProblem) {
    process.stderr.write(`[dsh-cli] ${versionProblem}\n`)
    return 1
  }
  const url = process.env.DSH_URL ?? DEFAULT_HARNESS_URL

  // The terminal client always runs under bun; fail loudly instead of exiting
  // silently when it is missing from PATH.
  const bunBin = resolveBun()
  const bunProbe = internals.spawnSync(bunBin, ["--version"], portableSpawnSyncOptions({ stdio: ["ignore", "pipe", "ignore"] }))
  if (bunProbe.status !== 0) {
    process.stderr.write(
      '[dsh-cli] bun is required to run the terminal client. Install it with "npm install -g bun" (or from https://bun.sh).\n',
    )
    return 1
  }
  const bunProblem = bunVersionProblemFor(String(bunProbe.stdout ?? "").trim(), process.platform === "win32")
  if (bunProblem) {
    process.stderr.write(`[dsh-cli] ${bunProblem}\n`)
    return 1
  }

  // Stage any newer dsh-cli / harness version in the background before we
  // probe/launch; the next launch applies it. Skipped when disabled.
  if (process.env.DSH_NO_UPDATE_CHECK !== "1") {
    internals.stageUpdates()
  }

  if (await internals.probe(url)) {
    // An instance is already serving: run the terminal client directly.
    if (process.env.DSH_DEBUG === "1") process.stderr.write(`[dsh-cli] harness reachable at ${url}; launching terminal client\n`)
    const child = internals.spawn(bunBin, [TUI_CLI, ...args], {
      stdio: "inherit",
      env: { ...process.env, DSH_URL: url, DSH_CWD: process.cwd() },
      ...portableSpawnOptions({}),
    })
    return exitCodeOf(child)
  }

  const urlPort = Number(new URL(url).port) || 3081
  if (await isPortInUse(urlPort)) {
    process.stderr.write(
      `[dsh-cli] ${url} is already in use by another process, but it does not look like a reachable harness. Stop that process (e.g. fuser -k ${urlPort}/tcp) or run with --port 0 to pick a free port.\n`,
    )
  }

  const dsh = resolveDsh()
  if (dsh.bin === "npx") {
    // The npx fallback downloads @deepseek-ai/dsh on first use; make the
    // implicit network fetch visible so a fresh install doesn't look stuck.
    process.stderr.write(
      "[dsh-cli] 未检测到全局 dsh，将通过 npx 下载 @deepseek-ai/dsh（首次联网，可能需要几分钟）；或先执行 npm install -g @deepseek-ai/dsh 以加速启动\n",
    )
  }
  const profileRegistered = normalizeProfileBundles()
  // The running CLI comes from the tui profile bundle, a separate copy of this
  // package. A plain `npm install -g` (and the silent-updater) only update the
  // global package, leaving the profile copy on the old version — so the launcher
  // never shows the version it just installed. Detect a version mismatch and
  // re-register the bundle (rebuild from the current global package) so the
  // profile and the installed package stay in sync.
  const installedBundleVersion = installedProfileBundleVersion(profileDir())
  const profileStale = profileRegistered && installedBundleVersion !== null && installedBundleVersion !== PKG_VERSION
  if (profileStale) {
    process.stderr.write(
      `[dsh-cli] 检测到 dsh-cli 版本已更新（tui profile 内 ${installedBundleVersion} → ${PKG_VERSION}），正在刷新 profile…\n`,
    )
  }
  // Repair the pnpm build allowlist even when the profile is already
  // registered: an upgraded dsh-cli must flip placeholders left behind by
  // older versions (pnpm 11 fills unapproved packages with
  // "set this to true or false", which fails the install with
  // ERR_PNPM_IGNORED_BUILDS). Idempotent, so it is safe on every boot.
  allowProfileBuilds()
  if (!profileRegistered || profileStale) {
    if (process.env.DSH_DEBUG === "1") process.stderr.write(`[dsh-cli] registering the tui profile bundle (${PKG_NAME})\n`)
    // Profile setup is forwarded to pnpm by dsh; auto-install it when missing
    // so first run works even if the package postinstall was skipped.
    const pnpmProbe = runPortable("pnpm", ["--version"])
    if (pnpmProbe.status !== 0) {
      process.stderr.write("[dsh-cli] pnpm not found; the harness needs it to build the tui profile. Installing pnpm…\n")
      const pnpmInstall = runPortable("npm", ["install", "-g", "pnpm"])
      if (pnpmInstall.status !== 0) {
        const detail = pnpmInstall.error ? `: ${pnpmInstall.error.message}` : ""
        process.stderr.write(`[dsh-cli] could not auto-install pnpm${detail}.\n`)
        if (typeof pnpmInstall.stderr === "string" && pnpmInstall.stderr.trim()) {
          process.stderr.write(`${pnpmInstall.stderr.trim()}\n`)
        }
        process.stderr.write('[dsh-cli] run "npm install -g pnpm" in your terminal to see the full error, then retry.\n')
        return pnpmInstall.status ?? 1
      }
    }
    // First-time profile installs download @opentui/core platform packages;
    // on flaky networks those fetches drop (UND_ERR_DESTROYED). Harden pnpm's
    // fetch retries, lower download concurrency, and retry the whole setup.
    const setupEnv = {
      ...process.env,
      npm_config_fetch_retries: "5",
      npm_config_fetch_retry_mintimeout: "2000",
      npm_config_fetch_retry_maxtimeout: "60000",
      npm_config_network_concurrency: "4",
      // pnpm 11 reads pnpm_config_* (not npm_config_*) for install settings.
      pnpm_config_fetch_retries: "5",
      pnpm_config_fetch_retry_mintimeout: "2000",
      pnpm_config_fetch_retry_maxtimeout: "60000",
      pnpm_config_network_concurrency: "4",
    }
    let setup = internals.spawnSync(
      dsh.bin,
      [...dsh.prefix, "plugin", "--profile", PROFILE_NAME, "add", pathToFileURL(PKG_ROOT).href],
      portableSpawnSyncOptions({ stdio: ["ignore", "inherit", "pipe"], env: setupEnv }),
    )
    for (let attempt = 2; setup.status !== 0 && attempt <= 3; attempt++) {
      process.stderr.write(`[dsh-cli] profile setup attempt ${attempt - 1} failed; retrying…\n`)
      const retryDelay = Number(process.env.DSH_PROFILE_RETRY_DELAY_MS ?? 1500)
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryDelay) ? retryDelay : 1500))
      setup = internals.spawnSync(
        dsh.bin,
        [...dsh.prefix, "plugin", "--profile", PROFILE_NAME, "add", pathToFileURL(PKG_ROOT).href],
        portableSpawnSyncOptions({ stdio: ["ignore", "inherit", "pipe"], env: setupEnv }),
      )
    }
    if (setup.status !== 0) {
      const stderrText = setup.stderr == null ? "" : String(setup.stderr)
      if (stderrText.trim()) process.stderr.write(`${stderrText.trim()}\n`)
      const pnpmHint = pnpmProbe.status !== 0 ? ' The profile setup uses pnpm — install it with "npm install -g pnpm" and retry.' : ""
      process.stderr.write(`[dsh-cli] failed to register the tui profile (dsh plugin add exited with ${setup.status ?? "error"}).${pnpmHint}\n`)
      return setup.status ?? 1
    }
  }

  if (process.env.DSH_DEBUG === "1") {
    process.stderr.write("[dsh-cli] starting harness (dsh --profile tui); the terminal client will take over this screen\n")
  }
  const child = internals.spawn(dsh.bin, [...dsh.prefix, "--profile", PROFILE_NAME, ...args], {
    stdio: "inherit",
    env: process.env,
    ...portableSpawnOptions({}),
  })
  return exitCodeOf(child)
}
