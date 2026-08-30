/**
 * DeepSeek Harness auto-update: keeps the global `@deepseek-ai/dsh` install
 * current. Version probing lives here; the actual stage/apply is handled by
 * the unified silent-updater (`src/dsh/silent-update.ts`), which runs the
 * harness update in the background and applies it on the next launch.
 *
 * The official harness npm package is `@deepseek-ai/dsh`. When it is not
 * installed globally, the launcher falls back to `npx`, which already
 * resolves the latest published version — there is nothing to update.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
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
