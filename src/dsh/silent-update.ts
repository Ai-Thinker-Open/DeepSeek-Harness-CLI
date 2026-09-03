/**
 * Unified silent auto-updater for dsh-cli itself and the DeepSeek Harness.
 *
 * Two phases, driven by the `dsh-cli` launcher:
 *
 * - **Stage (background):** a detached `silent-update-agent` checks the npm
 *   registry for both packages and downloads any newer version into a temp
 *   prefix, then records a pending marker. The running session keeps its
 *   current version and is never interrupted.
 * - **Apply (next launch):** `bin/dsh-cli` runs this before booting the
 *   harness so the freshly-installed package is what this launch uses.
 *   Failures are non-blocking: the marker is kept and the current version
 *   remains usable.
 *
 * Disable everything with `DSH_NO_UPDATE_CHECK=1`.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import pkg from "../../package.json"
import { HARNESS_PKG, installedHarnessVersion } from "./harness-update"
import { isNewerVersion } from "../update"
import { portableSpawnSyncOptions } from "./portable"

export interface PendingUpdate {
  pkg: string
  version: string
}

const CHECK_TIMEOUT_MS = 3000

/** Registry endpoint that resolves the latest published version of `pkg`. */
function registryLatestUrl(pkgName: string): string {
  return `https://registry.npmjs.org/${pkgName.replace("/", "%2F")}/latest`
}

/** Latest published version of `pkg`, or `null` when the registry is unreachable. */
async function registryLatest(pkgName: string): Promise<string | null> {
  try {
    const res = await internals.fetch(registryLatestUrl(pkgName), {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

/** Location of the pending-update marker (under the dsh home dir). */
export function updateMarkerPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME ?? join(homedir(), ".dsh")
  return join(home, ".updates-pending.json")
}

function readMarker(env: NodeJS.ProcessEnv = process.env): PendingUpdate[] {
  try {
    const data = JSON.parse(readFileSync(updateMarkerPath(env), "utf8")) as { pending?: PendingUpdate[] }
    return Array.isArray(data.pending) ? data.pending.filter((e) => e && typeof e.pkg === "string" && typeof e.version === "string") : []
  } catch {
    return []
  }
}

/** Persist the marker atomically (write a sibling temp file, then rename). */
function writeMarker(pending: PendingUpdate[], env: NodeJS.ProcessEnv = process.env): void {
  const path = updateMarkerPath(env)
  try {
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify({ pending }, null, 2)}\n`)
    renameSync(temp, path)
  } catch {
    // Best-effort marker persistence; a failed write only means the update
    // is re-staged/retried on a later launch.
  }
}

/** Run `npm install -g <pkg>@<version>` and report success. */
function installGlobal(pkgName: string, version: string): { status: number; stderr: string } {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  try {
    const result = internals.spawnSync(npm, ["install", "-g", `${pkgName}@${version}`], {
      ...portableSpawnSyncOptions({ stdio: ["ignore", "ignore", "pipe"], windowsHide: true }),
    })
    return { status: result.status ?? 1, stderr: result.stderr == null ? "" : String(result.stderr) }
  } catch (error) {
    return { status: 1, stderr: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Apply every pending update recorded by a previous background stage.
 * Successful entries are removed; failures are kept (so the next launch
 * retries) with a single stderr line. Never throws and never blocks the
 * caller on a hard error.
 *
 * Returns the packages it actually upgraded, so the launcher can tell the
 * running session "restart to pick this up" — the freshly-installed version
 * only takes effect on the next launch, not this one.
 */
export function applyPendingUpdates(
  env: NodeJS.ProcessEnv = process.env,
): { updated: Array<{ pkg: string; version: string }> } {
  if (env.DSH_NO_UPDATE_CHECK === "1") return { updated: [] }
  const pending = readMarker(env)
  if (pending.length === 0) return { updated: [] }

  const remaining: PendingUpdate[] = []
  const updated: Array<{ pkg: string; version: string }> = []
  for (const entry of pending) {
    const { status, stderr } = installGlobal(entry.pkg, entry.version)
    if (status === 0) {
      updated.push({ pkg: entry.pkg, version: entry.version })
      if (env.DSH_DEBUG === "1") process.stderr.write(`[dsh-cli] updated ${entry.pkg} → ${entry.version}\n`)
      continue
    }
    const detail = stderr.trim().split("\n").slice(-1)[0]?.trim() ?? ""
    process.stderr.write(`[dsh-cli] update to ${entry.pkg}@${entry.version} failed${detail ? `: ${detail}` : ""}; keeping the current version\n`)
    remaining.push(entry)
  }

  if (remaining.length > 0) writeMarker(remaining, env)
  else writeMarker([], env)
  return { updated }
}

function npmBinary(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

/**
 * Stage a package into a throwaway prefix and verify the manifest version.
 * Returns `true` on success, `false` when the download/verify fails.
 */
function stageIntoPrefix(pkgName: string, version: string): boolean {
  const staging = mkdtempSync(join(tmpdir(), "dsh-cli-update-"))
  try {
    const installed = internals.spawnSync(
      npmBinary(),
      ["install", "-g", "--prefix", staging, `${pkgName}@${version}`],
      portableSpawnSyncOptions({ stdio: "ignore", windowsHide: true }),
    )
    if (installed.status !== 0) return false
    const manifest = join(staging, "node_modules", pkgName, "package.json")
    if (!existsSync(manifest)) return false
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }
    return parsed.version === version
  } catch {
    return false
  } finally {
    try {
      // Staging prefix is disposable; the real install happens at apply time.
      rmSync(staging, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup.
    }
  }
}

/**
 * Stage any newer package in the background (the agent entry point). For each
 * target, resolve the installed (current) and latest versions; download the
 * newer one into a temp prefix and record a pending marker. Unreachable
 * registries are ignored without touching existing markers.
 */
export async function stagePendingUpdates(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.DSH_NO_UPDATE_CHECK === "1") return

  // Merge with whatever was already staged so concurrent agents don't lose
  // an entry; entries that are now current are pruned below. `hadPending`
  // captures the pre-mutation state so an emptied marker is still persisted
  // (otherwise stale entries would survive in the file).
  const existing = readMarker(env)
  const pending = new Map(existing.map((e) => [e.pkg, e.version]))
  const hadPending = pending.size > 0

  // dsh-cli itself: the bundled package.json is the installed version.
  const cliLatest = await registryLatest(pkg.name)
  if (cliLatest === null) {
    // Registry unreachable: keep any existing entry untouched.
  } else if (isNewerVersion(cliLatest, pkg.version)) {
    if (stageIntoPrefix(pkg.name, cliLatest)) pending.set(pkg.name, cliLatest)
  } else {
    pending.delete(pkg.name)
  }

  // Harness: skipped entirely when it is not installed globally (npx handles it).
  const harnessCurrent = installedHarnessVersion()
  if (harnessCurrent === undefined) {
    // No global harness to update; any stale pending entry is obsolete.
    pending.delete(HARNESS_PKG)
  } else {
    const harnessLatest = await registryLatest(HARNESS_PKG)
    if (harnessLatest === null) {
      // Registry unreachable: keep any existing entry untouched.
    } else if (isNewerVersion(harnessLatest, harnessCurrent)) {
      if (stageIntoPrefix(HARNESS_PKG, harnessLatest)) pending.set(HARNESS_PKG, harnessLatest)
    } else {
      pending.delete(HARNESS_PKG)
    }
  }

  if (pending.size > 0 || hadPending) {
    writeMarker(
      [...pending.entries()].map(([pkgName, version]) => ({ pkg: pkgName, version })),
      env,
    )
  }
}

/** Test seam: registry fetch, npm subprocess spawning, and fs cleanup. */
export const internals: {
  fetch: typeof fetch
  spawnSync: typeof spawnSync
} = {
  fetch,
  spawnSync,
}
