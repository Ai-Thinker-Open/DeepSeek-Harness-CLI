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
