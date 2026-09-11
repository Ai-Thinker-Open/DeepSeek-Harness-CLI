/**
 * The OpenTUI renderer is a per-platform native addon: `@opentui/core` loads
 * one of `@opentui/core-<platform>-<arch>[-musl]` as an *optional* dependency,
 * resolved by the package manager when the tree is **installed**.
 *
 * That makes the install a snapshot of one OS. A `node_modules` tree installed
 * on Windows and later executed by Linux (WSL sharing the Windows global
 * prefix, a copied prefix, a mounted volume) simply has no copy for the running
 * platform, and the terminal client dies deep inside the renderer with a raw
 * `Cannot find module '@opentui/core-linux-x64'` stack — after the harness has
 * already booted and taken over the screen. The same class of mismatch breaks
 * `koffi`/`@oven/bun-*`, which is checked separately (see `portable.ts`).
 */

/** Platform/arch pairs `@opentui/core` ships a native package for. */
const SUPPORTED_TARGETS = new Set([
  "darwin-x64",
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
  "win32-arm64",
])

/**
 * Candidate package names that satisfy the render library on a target, most
 * preferred first. Mirrors OpenTUI's own selection:
 * `@opentui/core-${platform}-${arch}${libcSuffix}`.
 *
 * Linux gets both the glibc and the musl build listed: npm/pnpm install
 * optional dependencies regardless of libc, so a healthy Linux tree carries
 * both, and requiring *either* avoids guessing the libc here (a wrong guess
 * must never produce a false alarm). An unknown target yields an empty list,
 * and the caller then skips the check rather than blocking a platform this
 * package knows nothing about.
 */
export function renderLibPackageCandidates(platform: string, arch: string): string[] {
  const target = `${platform}-${arch}`
  if (!SUPPORTED_TARGETS.has(target)) return []
  if (platform === "linux") {
    return [`@opentui/core-${target}`, `@opentui/core-${target}-musl`]
  }
  return [`@opentui/core-${target}`]
}

/**
 * Pure check used by the launcher/runner and by tests.
 * @param resolves - probes whether a specifier resolves from the terminal
 * client's own module scope; `undefined` means the resolution API is
 * unavailable, which is treated as "cannot tell" and never blocks.
 * @returns a user-facing problem when no candidate resolves, else `null`.
 */
export function renderLibProblemFor(
  platform: string,
  arch: string,
  resolves: (specifier: string) => boolean | undefined,
): string | null {
  const candidates = renderLibPackageCandidates(platform, arch)
  if (candidates.length === 0) return null
  const results = candidates.map((candidate) => resolves(candidate))
  if (results.some((result) => result === true)) return null
  // No verdict available: an older runtime without `import.meta.resolve`, or a
  // probe that could not answer. Degrade to a normal boot and let the renderer
  // report the real failure.
  if (results.every((result) => result === undefined)) return null
  return (
    `the terminal client has no OpenTUI render library for ${platform}-${arch} ` +
    `(expected ${candidates.join(" or ")}). ` +
    "This normally means node_modules was installed for a different OS and is now being run on this one " +
    "(for example a Windows install executed from WSL): OpenTUI's native package is an optional dependency " +
    "chosen at install time, so the current platform's copy is absent. " +
    "Reinstall on this platform and retry — e.g. `npm i -g @ai-thinker/deepseek-harness-cli`, " +
    "or remove node_modules and reinstall."
  )
}

/**
 * Resolve a specifier with ESM semantics from this module — the same
 * conditions Bun/the client uses, and the same package scope as the client
 * (`dist/runner.js`, `dist/dispatcher.js` and `dist/cli.js` all live in one
 * package copy). `require.resolve` is deliberately not used: OpenTUI's native
 * packages export only `bun`/`import` conditions, so CommonJS resolution
 * reports `ERR_PACKAGE_PATH_NOT_EXPORTED` even when the package is present.
 */
function resolvesFromHere(specifier: string): boolean | undefined {
  const resolve = (import.meta as { resolve?: (specifier: string) => string }).resolve
  if (typeof resolve !== "function") return undefined
  try {
    resolve.call(import.meta, specifier)
    return true
  } catch {
    return false
  }
}

/** Runtime check for the current platform/arch (see {@link renderLibProblemFor}). */
export function renderLibProblem(): string | null {
  return renderLibProblemFor(process.platform, process.arch, resolvesFromHere)
}
