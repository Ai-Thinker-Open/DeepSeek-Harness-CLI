/**
 * Windows compatibility for spawning CLIs.
 *
 * On Windows, npm/pnpm/dsh/npx/git are `.cmd`/`.bat` shims. Node can only
 * launch those through a shell, so every subprocess spawn goes through this
 * helper: it adds `shell: true` on win32 and leaves other platforms untouched
 * (plain argv spawning, no shell quoting).
 */
import type { SpawnOptions, SpawnSyncOptions } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export function portableSpawnSyncOptions(options: SpawnSyncOptions): SpawnSyncOptions {
  return process.platform === "win32" ? { ...options, shell: true } : options
}

export function portableSpawnOptions(options: SpawnOptions): SpawnOptions {
  return process.platform === "win32" ? { ...options, shell: true } : options
}

/** Locate the package root from a source or built module location. */
function packageRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("dsh-cli: unable to locate package root")
    dir = parent
  }
}

/**
 * Locate the bun executable: prefer the pinned copy shipped with this
 * package's installation, then the standard `~/.bun/bin` install, then PATH.
 * (bun's Windows installer adds `~/.bun/bin` only to new shells, so the
 * fallback matters.)
 */
export function resolveBun(): string {
  const shim = process.platform === "win32" ? "bun.cmd" : "bun"
  const binary = process.platform === "win32" ? "bun.exe" : "bun"
  const candidates = [
    join(packageRoot(dirname(fileURLToPath(import.meta.url))), "node_modules", ".bin", shim),
    join(homedir(), ".bun", "bin", binary),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return "bun"
}
