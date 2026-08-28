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
 * package's installation (`@oven/bun-<platform>-<arch>`, pinned to 1.3.14),
 * then the standard `~/.bun/bin` install, then PATH. (bun's Windows
 * installer adds `~/.bun/bin` only to new shells, so the fallback matters.)
 */
export function resolveBun(root = packageRoot(dirname(fileURLToPath(import.meta.url)))): string {
  const binary = process.platform === "win32" ? "bun.exe" : "bun"
  for (const candidate of bunCandidatePaths(root)) {
    if (existsSync(candidate)) return candidate
  }
  return "bun"
}

/**
 * Ordered bun lookup candidates for a package root: the pinned `@oven/bun-*`
 * platform package first, then a `.bin` shim, then `~/.bun/bin`, and finally
 * the bare PATH lookup (`"bun"`).
 */
export function bunCandidatePaths(root: string): string[] {
  const shim = process.platform === "win32" ? "bun.cmd" : "bun"
  const binary = process.platform === "win32" ? "bun.exe" : "bun"
  return [
    ...ovenBunCandidates(root, binary),
    join(root, "node_modules", ".bin", shim),
    join(homedir(), ".bun", "bin", binary),
    "bun",
  ]
}

/**
 * Candidate paths for the pinned `@oven/bun-*` binary inside this package's
 * node_modules. The npm package names use `aarch64` for arm64, and Linux x64
 * has a separate `-musl` package; on musl systems only the musl binary runs,
 * so it is preferred there (npm installs optional deps regardless of libc).
 */
function ovenBunCandidates(root: string, binary: string): string[] {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch
  const base = `@oven/bun-${process.platform}-${arch}`
  if (process.platform === "linux" && arch === "x64") {
    const plain = join(root, "node_modules", base, "bin", binary)
    const musl = join(root, "node_modules", `${base}-musl`, "bin", binary)
    return prefersMusl() ? [musl, plain] : [plain, musl]
  }
  return [join(root, "node_modules", base, "bin", binary)]
}

/** True when the current Linux is a musl distribution (Alpine etc.). */
function prefersMusl(): boolean {
  if (process.env.OPENTUI_LIBC === "musl") return true
  try {
    return existsSync("/etc/alpine-release")
  } catch {
    return false
  }
}
