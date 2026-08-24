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
import { join } from "node:path"

export function portableSpawnSyncOptions(options: SpawnSyncOptions): SpawnSyncOptions {
  return process.platform === "win32" ? { ...options, shell: true } : options
}

export function portableSpawnOptions(options: SpawnOptions): SpawnOptions {
  return process.platform === "win32" ? { ...options, shell: true } : options
}

/**
 * Locate the bun executable. Returns the standard `~/.bun/bin` install when
 * `bun` is not on PATH (bun's Windows installer adds it only to new shells).
 */
export function resolveBun(): string {
  const bin = process.platform === "win32" ? "bun.exe" : "bun"
  const candidate = join(homedir(), ".bun", "bin", bin)
  return existsSync(candidate) ? candidate : "bun"
}
