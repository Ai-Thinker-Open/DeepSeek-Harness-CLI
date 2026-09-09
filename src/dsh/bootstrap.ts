/**
 * First-run bootstrap for @ai-thinker/deepseek-harness-cli: installs the
 * Ai-Thinker skills collection into the harness skill roots.
 *
 * The published npm package carries the skills repo in `vendor/ai-thinker-src`;
 * startup links those bundles so first run works without cloning GitHub. The
 * bundled FlashKey MCP server was removed from the package and is never
 * installed/started on any later version.
 *
 * Every step is best-effort and never blocks startup:
 * - `DSH_SKIP_BOOTSTRAP=1` disables everything,
 * - `DSH_NO_SKILLS=1` disables skills,
 * - `AT_SKILLS_URL` overrides the fallback skills source.
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { portableSpawnSyncOptions } from "./portable"
import { debug, isDebugEnabled } from "../debug"

const DEFAULT_SKILLS_URL = "https://github.com/Ai-Thinker-Open/skills.git"

/** Locate the package root from a source or built module location. */
function findRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("dsh-cli: unable to locate package root")
    dir = parent
  }
}

const PKG_ROOT = findRoot(dirname(fileURLToPath(import.meta.url)))

/** Spawn seams and bundled resource roots; tests substitute these. */
export const internals: {
  spawnSync: typeof spawnSync
  bundledSkillsRepo: string
} = {
  spawnSync,
  bundledSkillsRepo: join(PKG_ROOT, "vendor", "ai-thinker-src"),
}

function info(message: string): void {
  // Normal startup progress is invisible by default; `DSH_DEBUG=1` shows it.
  if (isDebugEnabled()) debug(`[dsh-cli] bootstrap: ${message}`)
}

function warn(message: string): void {
  process.stderr.write(`[dsh-cli] bootstrap: ⚠ ${message}\n`)
}

/** Startup-progress line, always visible (no DSH_DEBUG needed). */
function notice(message: string): void {
  process.stderr.write(`[dsh-cli] ${message}\n`)
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh")
}

const SKILLS_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000 // default: refresh at most once/day

function skillsLastUpdateAt(repoRoot: string): number {
  try {
    return Number.parseInt(readFileSync(join(repoRoot, ".dsh-last-update"), "utf8"), 10) || 0
  } catch {
    return 0
  }
}

function markSkillsUpdated(repoRoot: string): void {
  try {
    writeFileSync(join(repoRoot, ".dsh-last-update"), String(Date.now()))
  } catch {
    // Best-effort marker; a failed write only means the next launch retries.
  }
}

/**
 * Pull the latest skills for an already-cloned repo, throttled so we don't hit
 * the network on every launch. Best-effort and never throws: on any git/network
 * failure we keep the existing checkout and link that instead.
 *
 * `git clone --depth 1` pins `origin/HEAD`, so a shallow `fetch --depth 1 origin`
 * plus a `reset --hard origin/HEAD` keeps the checkout shallow and fast-forwards
 * it to the newest commit. Disable with `DSH_NO_SKILLS_UPDATE=1`; override the
 * cadence with `DSH_SKILLS_UPDATE_INTERVAL_MS`.
 */
function updateSkillsIfStale(repoRoot: string): void {
  if (process.env.DSH_NO_SKILLS_UPDATE === "1") return
  const intervalMs = Number.parseInt(String(process.env.DSH_SKILLS_UPDATE_INTERVAL_MS ?? ""), 10) || SKILLS_UPDATE_INTERVAL_MS
  if (Date.now() - skillsLastUpdateAt(repoRoot) < intervalMs) return

  const fetch = internals.spawnSync("git", ["-C", repoRoot, "fetch", "--depth", "1", "origin"], portableSpawnSyncOptions({ stdio: "ignore" }))
  if (fetch.status !== 0) {
    info("skills update fetch failed; keeping the existing checkout")
    return
  }
  const reset = internals.spawnSync("git", ["-C", repoRoot, "reset", "--hard", "origin/HEAD"], portableSpawnSyncOptions({ stdio: "ignore" }))
  if (reset.status !== 0) {
    warn("skills update reset failed; keeping the existing checkout")
    return
  }
  markSkillsUpdated(repoRoot)
  info("skills refreshed from origin")
}

/** Link every SKILL.md bundle under `<repo>/skills` into a harness skill root. */
export function linkSkillBundles(skillsRoot: string, repoRoot: string): number {
  const bundlesDir = join(repoRoot, "skills")
  if (!existsSync(bundlesDir)) return 0
  mkdirSync(skillsRoot, { recursive: true })
  let linked = 0
  for (const name of readdirSync(bundlesDir)) {
    const source = join(bundlesDir, name)
    if (!statSync(source).isDirectory() || !existsSync(join(source, "SKILL.md"))) continue
    const target = join(skillsRoot, name)
    // The target may already exist as a symlink whose destination no longer
    // resolves (e.g. after the vendored skills repo moved). `existsSync`
    // follows links and reports false, but creating the link then fails with
    // EEXIST on every launch. Repair stale symlinks; leave real files or
    // directories at the target untouched.
    let existing: ReturnType<typeof lstatSync> | undefined
    try {
      existing = lstatSync(target)
    } catch {
      // absent — create below
    }
    if (existing) {
      if (!existing.isSymbolicLink()) continue
      // A symlink that still resolves to the current source is already right:
      // keep it (idempotent). Only repair links whose destination is gone or
      // stale.
      try {
        if (realpathSync(target) === realpathSync(source)) continue
      } catch {
        // broken link — fall through to repair
      }
      try {
        unlinkSync(target)
      } catch {
        continue
      }
    }
    try {
      symlinkSync(source, target, "dir")
      linked += 1
    } catch (error) {
      warn(`skill link failed for ${name}: ${(error as Error).message}`)
    }
  }
  return linked
}

async function ensureSkills(): Promise<void> {
  const skillsRoot = join(dshHome(), "skills")
  mkdirSync(skillsRoot, { recursive: true })
  // Bundled resources ship in the npm package (vendor/ai-thinker-src): link
  // straight from there, no network needed.
  if (existsSync(join(internals.bundledSkillsRepo, "skills"))) {
    const linked = linkSkillBundles(skillsRoot, internals.bundledSkillsRepo)
    info(`skills ready (${linked} new bundles linked from the bundled package resources)`)
    return
  }
  // Fallback for source checkouts that have not been vendored.
  const repoRoot = join(skillsRoot, "ai-thinker-src")
  const url = process.env.AT_SKILLS_URL ?? DEFAULT_SKILLS_URL
  if (!existsSync(join(repoRoot, ".git"))) {
    notice(`首次准备 Ai-Thinker 技能：git clone ${url}（DSH_NO_SKILLS=1 可跳过）`)
    const result = internals.spawnSync("git", ["clone", "--depth", "1", url, repoRoot], portableSpawnSyncOptions({ stdio: "ignore" }))
    if (result.status !== 0) {
      warn("skills clone failed; run it manually or retry next launch")
      return
    }
    // A fresh shallow clone is already at the newest commit, so no re-fetch yet.
    markSkillsUpdated(repoRoot)
  } else {
    // Keep an existing clone current (throttled, best-effort, never blocks).
    updateSkillsIfStale(repoRoot)
  }
  const linked = linkSkillBundles(skillsRoot, repoRoot)
  if (linked > 0) notice(`链接技能目录：${linked} 个新 skills → ${skillsRoot}`)
  info(`skills ready (${linked} bundles linked into ${skillsRoot})`)
}

/** Run every enabled bootstrap resource; failures never throw out of here. */
export async function bootstrapAll(): Promise<void> {
  if (process.env.DSH_SKIP_BOOTSTRAP === "1") return
  const tasks: Array<[string, () => Promise<void>]> = []
  if (process.env.DSH_NO_SKILLS !== "1") tasks.push(["skills", ensureSkills])
  for (const [name, run] of tasks) {
    try {
      await run()
    } catch (error) {
      warn(`${name} bootstrap failed: ${(error as Error).message}`)
    }
  }
}
