/**
 * Minimum Node.js version required by the harness. `dsh`'s MCP client
 * (`@deepseek-ai/dsh-mcp-client`) calls `Promise.withResolvers()` when
 * connecting servers, and that ES2024 API only exists in Node.js 22+.
 * Bun (the terminal client runtime) implements it, so the check skips
 * Bun processes.
 */
export const MIN_NODE_MAJOR = 22

/** Pure check used by tests. */
export function nodeVersionProblemFor(
  version: string | undefined,
  isBun: boolean,
): string | null {
  if (isBun) return null
  if (!version) return null
  const major = Number.parseInt(version.split(".")[0] ?? "", 10)
  if (Number.isNaN(major) || major >= MIN_NODE_MAJOR) return null
  return (
    `Node.js ${version} is too old: the DeepSeek Harness requires Node.js ${MIN_NODE_MAJOR}+ ` +
    "(Promise.withResolvers is only available since Node 22). " +
    "Upgrade Node.js and reinstall the global @deepseek-ai/dsh, then retry."
  )
}

/** Runtime check: returns a user-facing problem when this Node is too old. */
export function nodeVersionProblem(): string | null {
  return nodeVersionProblemFor(process.versions?.node, process.isBun)
}

/**
 * Bun versions that segfault the OpenTUI client on Windows. The client is
 * pinned to 1.3.14 and shipped with the package via `@oven/bun-*` optional
 * dependencies; releases after 1.3.x crash with a main-thread segfault
 * (bun.report/1.4.0), so any 1.4+ binary found for the client runtime is
 * rejected up front instead of crashing mid-session.
 */
export function bunVersionProblemFor(version: string | undefined, isWin32: boolean): string | null {
  if (!isWin32) return null
  if (!version) return null
  const match = /^(\d+)\.(\d+)/.exec(version)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major < 1 || (major === 1 && minor < 4)) return null
  return (
    `bun ${version} is incompatible with the OpenTUI terminal client on Windows (bun 1.4+ ` +
    "segfaults the renderer; the client is pinned to 1.3.14). " +
    "Reinstall this package so the pinned @oven/bun-windows-x64@1.3.14 binary is used, " +
    "or install bun 1.3.14 from https://bun.sh, then retry."
  )
}
