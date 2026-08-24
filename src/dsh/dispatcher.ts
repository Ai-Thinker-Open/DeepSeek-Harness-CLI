/**
 * `dsh-cli` command dispatcher: reuse an already-running harness when one is
 * reachable, otherwise ensure the official `dsh` CLI and the `tui` profile
 * (this package as a bundle) exist, then boot `dsh --profile tui` which
 * starts the harness transport and the terminal client together.
 */

import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applyBundledOpentuiAssets } from "./native-assets"
export { bootstrapAll } from "./bootstrap"

export const DEFAULT_HARNESS_URL = "http://127.0.0.1:3080"
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

// The terminal client and the harness inherit this: bundled OpenTUI native
// libraries make the client run on any platform, independent of the install.
applyBundledOpentuiAssets()

function readManifest(): { name?: string } {
  return JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { name?: string }
}

const PKG_NAME = readManifest().name ?? "@ai-thinker/deepseek-harness-cli"

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
  const probeResult = internals.spawnSync("dsh", ["--help"], { stdio: "ignore" })
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
    const bin = join(npxRoot, entry, "node_modules", ".bin", "dsh")
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

/**
 * Spawn a CLI that may be a `.cmd` shim on Windows (npm/pnpm/dsh). Node can
 * only launch `.cmd` shims through the shell, so use `shell: true` there;
 * stderr is piped back so failures show the underlying error.
 */
function runPortable(command: string, args: string[]): ReturnType<typeof spawnSync> {
  const options: Parameters<typeof spawnSync>[2] = {
    stdio: ["ignore", "inherit", "pipe"],
    ...(process.platform === "win32" ? { shell: true } : {}),
  }
  return internals.spawnSync(command, args, options)
}

/** Test seam: probe, process spawn, and synchronous spawn. */
export const internals: {
  probe: typeof probe
  spawn: typeof spawn
  spawnSync: typeof spawnSync
} = { probe, spawn, spawnSync }

/**
 * Run the dispatcher and resolve with the process exit code.
 * @param args - arguments forwarded verbatim to `dsh --profile tui`.
 */
export async function run(args: readonly string[]): Promise<number> {
  const url = process.env.DSH_URL ?? DEFAULT_HARNESS_URL

  // The terminal client always runs under bun; fail loudly instead of exiting
  // silently when it is missing from PATH.
  const bunProbe = internals.spawnSync("bun", ["--version"], { stdio: "ignore" })
  if (bunProbe.status !== 0) {
    process.stderr.write(
      "[dsh-cli] bun is required to run the terminal client. Install it from https://bun.sh and make sure it is on PATH.\n",
    )
    return 1
  }

  if (await internals.probe(url)) {
    // An instance is already serving: run the terminal client directly.
    if (process.env.DSH_DEBUG === "1") process.stderr.write(`[dsh-cli] harness reachable at ${url}; launching terminal client\n`)
    const child = internals.spawn("bun", [TUI_CLI, ...args], {
      stdio: "inherit",
      env: { ...process.env, DSH_URL: url, DSH_CWD: process.cwd() },
    })
    return exitCodeOf(child)
  }

  const dsh = resolveDsh()
  if (!normalizeProfileBundles()) {
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
    const setup = internals.spawnSync(
      dsh.bin,
      [...dsh.prefix, "plugin", "--profile", PROFILE_NAME, "add", pathToFileURL(PKG_ROOT).href],
      { stdio: "inherit" },
    )
    if (setup.status !== 0) {
      process.stderr.write(
        `[dsh-cli] failed to register the tui profile (dsh plugin add exited with ${setup.status ?? "error"}). The profile setup uses pnpm — install it with "npm install -g pnpm" (or enable corepack) and retry.\n`,
      )
      return setup.status ?? 1
    }
  }

  if (process.env.DSH_DEBUG === "1") {
    process.stderr.write("[dsh-cli] starting harness (dsh --profile tui); the terminal client will take over this screen\n")
  }
  const child = internals.spawn(dsh.bin, [...dsh.prefix, "--profile", PROFILE_NAME, ...args], {
    stdio: "inherit",
    env: process.env,
  })
  return exitCodeOf(child)
}
