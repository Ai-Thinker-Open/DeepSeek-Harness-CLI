/**
 * First-run bootstrap for @ai-thinker/deepseek-harness-cli: installs the
 * Ai-Thinker skills collection into the harness skill roots and installs +
 * registers the FlashKey MCP server (SSE) with the tui profile.
 *
 * The published npm package carries both resources inside `vendor/`
 * (`ai-thinker-src` = the skills repo, `flashkey-mcp` = the MCP server Python
 * source). Startup prefers those bundled copies, so first run works without
 * cloning GitHub repositories. The git/pip URL paths remain as fallbacks for
 * source checkouts that have not been vendored.
 *
 * Every step is best-effort and never blocks startup:
 * - `DSH_SKIP_BOOTSTRAP=1` disables everything,
 * - `DSH_NO_SKILLS=1` / `DSH_NO_FLASHKEY=1` disable one resource,
 * - `AT_SKILLS_URL` / `FLASHKEY_INSTALL_URL` override the fallback sources,
 * - `FLASHKEY_SSE_PORT` overrides the SSE port (default 8100).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const MCP_ROW_ID = "mcp-flashkey"
const DEFAULT_SKILLS_URL = "https://github.com/Ai-Thinker-Open/skills.git"
const DEFAULT_FLASHKEY_URL = "flashkey-mcp[sse] @ git+https://github.com/Ai-Thinker-Open/FlashKey_MCP-Server.git"

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
  spawn: typeof spawn
  bundledSkillsRepo: string
  bundledFlashkey: string
} = {
  spawnSync,
  spawn,
  bundledSkillsRepo: join(PKG_ROOT, "vendor", "ai-thinker-src"),
  bundledFlashkey: join(PKG_ROOT, "vendor", "flashkey-mcp"),
}

function info(message: string): void {
  process.stderr.write(`[dsh-cli] bootstrap: ${message}\n`)
}

function warn(message: string): void {
  process.stderr.write(`[dsh-cli] bootstrap: ⚠ ${message}\n`)
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh")
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
    if (existsSync(target)) continue
    try {
      symlinkSync(source, target, "dir")
      linked += 1
    } catch (error) {
      warn(`skill link failed for ${name}: ${(error as Error).message}`)
    }
  }
  return linked
}

/** Register the FlashKey MCP row in the tui profile's cordis.patch.yml (idempotent). */
export function applyMcpPatch(profileDir: string, port: number): boolean {
  const patchFile = join(profileDir, "cordis.patch.yml")
  const entry = `- insert:\n    - id: ${MCP_ROW_ID}\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: flashkey\n        url: http://127.0.0.1:${port}/sse\n`
  try {
    if (!existsSync(patchFile)) {
      writeFileSync(patchFile, `# Auto-added by dsh-cli bootstrap: FlashKey MCP (SSE).\n${entry}`)
      return true
    }
    const text = readFileSync(patchFile, "utf8")
    if (text.includes(`id: ${MCP_ROW_ID}`)) return false
    if (/\[\s*\]\s*$/.test(text)) {
      // The profile's empty `[]` array: replace it with the entry, keeping any
      // header comments above.
      const bracket = text.lastIndexOf("[")
      writeFileSync(patchFile, `${text.slice(0, bracket)}${entry}`)
      return true
    }
    const bracket = text.lastIndexOf("]")
    if (bracket === -1) {
      writeFileSync(patchFile, `${text.trimEnd()}\n${entry}`)
    } else {
      writeFileSync(patchFile, `${text.slice(0, bracket)}\n${entry}${text.slice(bracket)}`)
    }
    return true
  } catch (error) {
    warn(`could not register FlashKey MCP row: ${(error as Error).message}`)
    return false
  }
}

function hasCommand(command: string): boolean {
  return internals.spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0
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
    info(`cloning Ai-Thinker skills -> ${repoRoot}`)
    const result = internals.spawnSync("git", ["clone", "--depth", "1", url, repoRoot], { stdio: "ignore" })
    if (result.status !== 0) {
      warn("skills clone failed; run it manually or retry next launch")
      return
    }
  }
  const linked = linkSkillBundles(skillsRoot, repoRoot)
  info(`skills ready (${linked} bundles linked into ${skillsRoot})`)
}

async function installFlashkey(): Promise<boolean> {
  const installUrl = process.env.FLASHKEY_INSTALL_URL ?? DEFAULT_FLASHKEY_URL
  const attempts: Array<Array<string>> = []
  // Prefer the bundled Python source over the git URL: no repository clone.
  if (existsSync(internals.bundledFlashkey)) {
    attempts.push(
      ["python3", "-m", "pip", "install", "--user", internals.bundledFlashkey],
      ["python3", "-m", "pip", "install", internals.bundledFlashkey],
      ["uv", "tool", "install", "--reinstall", internals.bundledFlashkey],
    )
  }
  attempts.push(
    ["python3", "-m", "pip", "install", "--user", installUrl],
    ["python3", "-m", "pip", "install", installUrl],
    ["uv", "tool", "install", "--reinstall", installUrl],
  )
  for (const args of attempts) {
    info(`installing flashkey-mcp: ${args[0]} ${args.slice(1).join(" ")}`)
    const result = internals.spawnSync(args[0]!, args.slice(1), { stdio: "ignore" })
    if (result.status === 0) return true
  }
  return false
}

/** Can the vendored MCP server run directly (deps already importable)? */
async function canRunVendoredFlashkey(): Promise<boolean> {
  if (!existsSync(join(internals.bundledFlashkey, "src", "flashkey_mcp"))) return false
  const probe = internals.spawnSync("python3", ["-c", "import mcp, starlette, uvicorn, serial"], { stdio: "ignore" })
  return probe.status === 0
}

async function ensureSseDaemon(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/sse`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1200)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (response.ok) {
      info("FlashKey SSE daemon already running")
      return
    }
  } catch {
    // Not running yet — start it below.
  }
  const installed = hasCommand("flashkey-mcp")
  const vendored = !installed && (await canRunVendoredFlashkey())
  if (!installed && !vendored) {
    warn("flashkey-mcp is not installed and the bundled copy cannot run (missing Python deps: mcp, starlette, uvicorn, pyserial); run pip/uv install or check the FlashKey_MCP-Server README")
    return
  }
  let command = "flashkey-mcp"
  let args = ["--sse", "--host", "127.0.0.1", "--port", String(port)]
  let env: NodeJS.ProcessEnv = process.env
  if (vendored) {
    // Run the bundled Python source in place: offline once its deps are present.
    command = "python3"
    args = ["-m", "flashkey_mcp.server", "--sse", "--host", "127.0.0.1", "--port", String(port)]
    env = { ...process.env, PYTHONPATH: join(internals.bundledFlashkey, "src") }
  }
  info(`starting FlashKey SSE daemon on :${port}`)
  try {
    const child: ChildProcess = internals.spawn(
      command,
      args,
      { stdio: "ignore", detached: true, env },
    )
    child.unref()
  } catch (error) {
    warn(`failed to start FlashKey SSE daemon: ${(error as Error).message}`)
  }
}

async function ensureFlashkey(): Promise<void> {
  const port = Number(process.env.FLASHKEY_SSE_PORT ?? 8100)
  if (!hasCommand("flashkey-mcp") && !(await canRunVendoredFlashkey())) {
    if (!(await installFlashkey())) {
      warn("flashkey-mcp install failed; install it manually (see FlashKey_MCP-Server README)")
      return
    }
  }
  await ensureSseDaemon(port)
  const profileDir = join(dshHome(), "profiles", "tui")
  if (applyMcpPatch(profileDir, port)) info("FlashKey MCP registered with the tui profile")
}

/** Run every enabled bootstrap resource; failures never throw out of here. */
export async function bootstrapAll(): Promise<void> {
  if (process.env.DSH_SKIP_BOOTSTRAP === "1") return
  const tasks: Array<[string, () => Promise<void>]> = []
  if (process.env.DSH_NO_SKILLS !== "1") tasks.push(["skills", ensureSkills])
  if (process.env.DSH_NO_FLASHKEY !== "1") tasks.push(["flashkey", ensureFlashkey])
  for (const [name, run] of tasks) {
    try {
      await run()
    } catch (error) {
      warn(`${name} bootstrap failed: ${(error as Error).message}`)
    }
  }
}
