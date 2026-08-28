/**
 * DeepSeek Harness auto-update: keeps the global `@deepseek-ai/dsh` install
 * current. The dispatcher runs this right before booting `dsh --profile tui`
 * (only when this launcher is about to start the harness itself), so a newly
 * published harness is installed before use.
 *
 * The official harness npm package is `@deepseek-ai/dsh`. When it is not
 * installed globally, the launcher falls back to `npx`, which already
 * resolves the latest published version — there is nothing to update.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { isNewerVersion } from "../update"
import { portableSpawnSyncOptions } from "./portable"

export const HARNESS_PKG = "@deepseek-ai/dsh"
const REGISTRY_LATEST = `https://registry.npmjs.org/${HARNESS_PKG.replace("/", "%2F")}/latest`
const CHECK_TIMEOUT_MS = 3000

/** Test seam: registry fetch and npm subprocess spawning. */
export const internals: { fetch: typeof fetch; spawnSync: typeof spawnSync } = {
  fetch,
  spawnSync,
}

/** Latest published harness version, or `null` when the registry is unreachable. */
export async function latestHarnessVersion(): Promise<string | null> {
  try {
    const res = await internals.fetch(REGISTRY_LATEST, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

/** Version of the globally installed harness, or `undefined` when absent. */
export function installedHarnessVersion(): string | undefined {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const root = internals.spawnSync(npm, ["root", "-g"], portableSpawnSyncOptions({ stdio: ["ignore", "pipe", "ignore"] }))
  if (root.status !== 0) return undefined
  const globalRoot = String(root.stdout ?? "").trim()
  if (!globalRoot) return undefined
  const manifest = join(globalRoot, "@deepseek-ai", "dsh", "package.json")
  if (!existsSync(manifest)) return undefined
  try {
    return (JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }).version
  } catch {
    return undefined
  }
}

/** Outcome of an auto-update attempt. */
export interface HarnessUpdateResult {
  /** Version found before the check (undefined when not installed globally). */
  before: string | undefined
  /** Version in effect afterwards (unchanged when already current or update failed). */
  after: string | undefined
}

/**
 * Install the latest harness when a newer version is published. Returns the
 * before/after versions; a failed install warns on stderr and keeps the
 * current version so the launcher can still boot.
 */
export async function ensureHarnessUpToDate(): Promise<HarnessUpdateResult> {
  const before = installedHarnessVersion()
  if (before === undefined) return { before, after: undefined }
  const latest = await latestHarnessVersion()
  if (latest === null || !isNewerVersion(latest, before)) return { before, after: before }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const result = internals.spawnSync(npm, ["install", "-g", `${HARNESS_PKG}@${latest}`], {
    ...portableSpawnSyncOptions({ stdio: ["ignore", "inherit", "pipe"] }),
  })
  if (result.status !== 0) {
    const detail = result.stderr == null ? "" : String(result.stderr).trim()
    process.stderr.write(`[dsh-cli] harness update to ${HARNESS_PKG}@${latest} failed${detail ? `: ${detail}` : ""}\n`)
    process.stderr.write("[dsh-cli] continuing with the installed harness version; run \"npm install -g @deepseek-ai/dsh\" manually to retry.\n")
    return { before, after: before }
  }
  process.stderr.write(`[dsh-cli] DeepSeek Harness updated ${before} → ${latest}\n`)
  return { before, after: latest }
}
