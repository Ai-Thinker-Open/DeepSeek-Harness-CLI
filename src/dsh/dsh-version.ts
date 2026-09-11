/**
 * Minimum official `dsh` version this bundle can boot against.
 *
 * A bundle's `cordis.patch.yml` rows name plugin packages that the Cordis
 * loader imports as **bare specifiers from inside the running dsh's own
 * `node_modules`**. Every row this bundle inserts therefore has to exist in the
 * *resolved dsh's* dependency closure — not merely in this package's own
 * `dependencies`. That is only true from 0.1.5 on: for example
 * `@deepseek-ai/dsh-client-file-upload` reaches dsh's closure transitively via
 * `dsh -> @deepseek-ai/dsh-web-app -> @deepseek-ai/dsh-client-file-upload`,
 * whereas a 0.1.2 dsh pulls in neither.
 *
 * The bundle's own `@deepseek-ai/dsh-*` dependencies are declared as
 * `^0.1.5-rc.1`, so an older global dsh is unsupported on both counts. Left
 * unchecked it fails deep inside the loader with a raw
 * `Cannot find package '@deepseek-ai/dsh-client-file-upload'` (or a
 * `duplicate loader entry id`) stack that hides the real cause.
 */
export const MIN_DSH_VERSION = "0.1.5-rc.1"

/** A parsed `major.minor.patch[-prerelease]` version. */
interface ParsedVersion {
  numbers: [number, number, number]
  prerelease: string[]
}

/**
 * Parse a version string, ignoring build metadata and any trailing text. The
 * version is matched anywhere in the input so `dsh --version` output that
 * carries a prefix or a trailing newline still parses.
 */
function parseVersion(value: string): ParsedVersion | null {
  const match = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value)
  if (match === null) return null
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  }
}

/**
 * Compare two versions by SemVer precedence (build metadata ignored).
 * @returns `-1`, `0` or `1`; unparseable inputs compare equal so a check built
 * on this never blocks startup on a version string it cannot understand.
 */
export function compareDshVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return 0
  for (let i = 0; i < 3; i++) {
    const l = left.numbers[i] ?? 0
    const r = right.numbers[i] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }
  // A release outranks any of its prereleases (1.0.0 > 1.0.0-rc.1).
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let i = 0; i < length; i++) {
    const l = left.prerelease[i]
    const r = right.prerelease[i]
    // A shorter prerelease set has lower precedence when all shared
    // identifiers match (1.0.0-alpha < 1.0.0-alpha.1).
    if (l === undefined) return -1
    if (r === undefined) return 1
    const lNumeric = /^\d+$/.test(l)
    const rNumeric = /^\d+$/.test(r)
    // Numeric identifiers always rank below alphanumeric ones.
    if (lNumeric && rNumeric) {
      const lValue = Number(l)
      const rValue = Number(r)
      if (lValue !== rValue) return lValue < rValue ? -1 : 1
      continue
    }
    if (lNumeric) return -1
    if (rNumeric) return 1
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

/**
 * Extract the version from `dsh --version` output. The CLI currently prints a
 * bare version, but the matcher tolerates a `dsh 0.1.5-rc.1`-shaped prefix and
 * surrounding whitespace.
 */
export function parseDshVersion(stdout: string | undefined): string | undefined {
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(stdout ?? "")
  return match?.[1]
}

/**
 * Pure check used by the dispatcher and by tests.
 * @param installed - version reported by the resolved `dsh`, if known.
 * @returns a user-facing problem when the version is too old, else `null`. An
 * absent or unparseable version is treated as "unknown" and never blocks: the
 * launcher must not refuse to start because a version probe failed.
 */
export function dshVersionProblemFor(installed: string | undefined): string | null {
  if (installed === undefined || installed.trim() === "") return null
  if (parseVersion(installed) === null) return null
  if (compareDshVersions(installed, MIN_DSH_VERSION) >= 0) return null
  return (
    `the resolved dsh is ${installed}, but this bundle requires >= ${MIN_DSH_VERSION}. ` +
    "Its patch rows name plugin packages that only exist in the newer dsh's dependency closure, " +
    "so the loader aborts with `Cannot find package` (or a duplicate loader-entry id) instead of booting. " +
    `Upgrade the global harness and retry:\n  npm i -g @deepseek-ai/dsh@${MIN_DSH_VERSION}`
  )
}
