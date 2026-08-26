import pkg from "../package.json"

export const UPDATE_PKG = "@ai-thinker/deepseek-harness-cli"
const REGISTRY_LATEST = `https://registry.npmjs.org/${UPDATE_PKG.replace("/", "%2F")}/latest`
const CHECK_TIMEOUT_MS = 3000

/** Simple major.minor.patch comparison; pre-release tags compare lower. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, "")
      .split(/[-+]/)[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0)
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/**
 * Latest published version of this package, or `null` when the registry is
 * unreachable, the request fails, or the installed version is already current.
 */
export async function checkForUpdate(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_LATEST, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    const latest = data.version
    return latest && isNewerVersion(latest, pkg.version) ? latest : null
  } catch {
    return null
  }
}
