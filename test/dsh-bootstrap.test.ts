import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyMcpPatch, bootstrapAll, internals, linkSkillBundles } from "../src/dsh/bootstrap"

let temp: string
const savedEnv: Record<string, string | undefined> = {}
const savedInternals = { ...internals }

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "dsh-bootstrap-"))
  for (const key of ["DSH_HOME", "DSH_SKIP_BOOTSTRAP", "DSH_NO_SKILLS", "DSH_NO_FLASHKEY", "FLASHKEY_SSE_PORT"]) {
    savedEnv[key] = process.env[key]
    process.env[key] = undefined
  }
  process.env.DSH_HOME = temp
  internals.spawnSync = (() => ({
    status: 1,
    stdout: "",
    stderr: "",
    pid: 0,
    output: [],
    signal: null,
  })) as unknown as typeof internals.spawnSync
  internals.spawn = (() => ({ unref() {} })) as unknown as typeof internals.spawn
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  Object.assign(internals, savedInternals)
  rmSync(temp, { recursive: true, force: true })
})

test("linkSkillBundles links SKILL.md bundles and is idempotent", () => {
  const repo = join(temp, "repo")
  const root = join(temp, "skills")
  for (const name of ["alpha", "beta"]) {
    mkdirSync(join(repo, "skills", name), { recursive: true })
    writeFileSync(join(repo, "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`)
  }
  mkdirSync(join(repo, "skills", "not-a-skill"), { recursive: true })

  expect(linkSkillBundles(root, repo)).toBe(2)
  expect(existsSync(join(root, "alpha", "SKILL.md"))).toBe(true)
  expect(existsSync(join(root, "beta", "SKILL.md"))).toBe(true)
  expect(existsSync(join(root, "not-a-skill"))).toBe(false)
  expect(linkSkillBundles(root, repo)).toBe(0)
})

test("linkSkillBundles repairs broken skill symlinks instead of failing", () => {
  const repo = join(temp, "repo2")
  const root = join(temp, "skills2")
  mkdirSync(join(repo, "skills", "gamma"), { recursive: true })
  writeFileSync(join(repo, "skills", "gamma", "SKILL.md"), "---\nname: gamma\n---\n")
  mkdirSync(root, { recursive: true })
  // A stale symlink whose destination no longer exists (the pre-vendoring
  // layout): `existsSync` reports false but creating the link throws EEXIST.
  symlinkSync(join(root, "gone", "skills", "gamma"), join(root, "gamma"), "dir")

  expect(linkSkillBundles(root, repo)).toBe(1)
  expect(realpathSync(join(root, "gamma"))).toBe(realpathSync(join(repo, "skills", "gamma")))
  expect(linkSkillBundles(root, repo)).toBe(0)
})

test("applyMcpPatch writes the FlashKey row once and survives re-runs", () => {
  const profile = join(temp, "profiles", "tui")
  mkdirSync(profile, { recursive: true })

  expect(applyMcpPatch(profile, 8100)).toBe(true)
  expect(applyMcpPatch(profile, 8100)).toBe(false)
  const text = readFileSync(join(profile, "cordis.patch.yml"), "utf8")
  expect(text).toContain("id: mcp-flashkey")
  expect(text).toContain("http://127.0.0.1:8100/sse")
  expect(text.split("id: mcp-flashkey").length - 1).toBe(1)
})

test("applyMcpPatch creates the profile directory when missing", () => {
  const profile = join(temp, "profiles", "tui")

  expect(applyMcpPatch(profile, 8100)).toBe(true)
  expect(existsSync(join(profile, "cordis.patch.yml"))).toBe(true)
})

test("applyMcpPatch replaces an empty [] array keeping header comments", () => {
  const profile = join(temp, "profiles", "tui")
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, "cordis.patch.yml"), "# profile patch layer\n[]\n")

  expect(applyMcpPatch(profile, 9000)).toBe(true)
  const text = readFileSync(join(profile, "cordis.patch.yml"), "utf8")
  expect(text).toContain("# profile patch layer")
  expect(text).toContain("http://127.0.0.1:9000/sse")
  expect(text).not.toContain("[]")
})

test("bootstrapAll respects the skip flags without spawning", async () => {
  let calls = 0
  internals.spawnSync = (() => {
    calls += 1
    return { status: 1, stdout: "", stderr: "", pid: 0, output: [], signal: null }
  }) as unknown as typeof internals.spawnSync

  process.env.DSH_SKIP_BOOTSTRAP = "1"
  await bootstrapAll()
  expect(calls).toBe(0)

  delete process.env.DSH_SKIP_BOOTSTRAP
  process.env.DSH_NO_SKILLS = "1"
  process.env.DSH_NO_FLASHKEY = "1"
  await bootstrapAll()
  expect(calls).toBe(0)
})

test("bootstrapAll tolerates install failures without throwing", async () => {
  process.env.DSH_NO_SKILLS = "1"
  await expect(bootstrapAll()).resolves.toBeUndefined()
})

test("bootstrap links bundled skills without cloning when vendor/ is present", async () => {
  const bundled = join(temp, "vendor", "ai-thinker-src")
  internals.bundledSkillsRepo = bundled
  for (const name of ["alpha", "beta"]) {
    mkdirSync(join(bundled, "skills", name), { recursive: true })
    writeFileSync(join(bundled, "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`)
  }
  let gitCalls = 0
  internals.spawnSync = ((command: string) => {
    if (command === "git") gitCalls += 1
    return { status: 1, stdout: "", stderr: "", pid: 0, output: [], signal: null }
  }) as unknown as typeof internals.spawnSync

  process.env.DSH_NO_FLASHKEY = "1"
  await bootstrapAll()

  expect(gitCalls).toBe(0)
  expect(existsSync(join(temp, "skills", "alpha", "SKILL.md"))).toBe(true)
  expect(existsSync(join(temp, "skills", "beta", "SKILL.md"))).toBe(true)
})

test("bootstrap falls back to cloning skills when vendor/ is absent", async () => {
  internals.bundledSkillsRepo = join(temp, "vendor", "ai-thinker-src")
  let cloned = false
  internals.spawnSync = ((command: string, args: string[]) => {
    if (command === "git" && args[0] === "clone") cloned = true
    return { status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null }
  }) as unknown as typeof internals.spawnSync

  process.env.DSH_NO_FLASHKEY = "1"
  await bootstrapAll()

  expect(cloned).toBe(true)
})

test("bootstrap starts the vendored FlashKey server in place when Python deps exist", async () => {
  const bundled = join(temp, "vendor", "flashkey-mcp")
  internals.bundledFlashkey = bundled
  mkdirSync(join(bundled, "src", "flashkey_mcp"), { recursive: true })
  const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
  internals.spawnSync = ((command: string, args: string[]) => {
    if (command === "python3" && args[0] === "-c") {
      return { status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null }
    }
    return { status: 1, stdout: "", stderr: "", pid: 0, output: [], signal: null }
  }) as unknown as typeof internals.spawnSync
  internals.spawn = ((command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
    spawned.push({ command, args, env: options?.env ?? process.env })
    return { unref() {} }
  }) as unknown as typeof internals.spawn

  // ensureSseDaemon probes the configured SSE port first; pick a port that is
  // free so the probe fails and the server is actually spawned (the default
  // 8100 may be occupied by a real FlashKey daemon on the host).
  const probe = Bun.serve({ port: 0, fetch: () => new Response("x") })
  const flashkeyPort = probe.port
  probe.stop(true)
  process.env.FLASHKEY_SSE_PORT = String(flashkeyPort)

  process.env.DSH_NO_SKILLS = "1"
  await bootstrapAll()

  expect(spawned.length).toBe(1)
  expect(spawned[0]!.command).toBe("python3")
  expect(spawned[0]!.args).toEqual(["-m", "flashkey_mcp.server", "--sse", "--host", "127.0.0.1", "--port", String(flashkeyPort)])
  expect(spawned[0]!.env.PYTHONPATH).toBe(join(bundled, "src"))
})

test("flashkey install prefers the bundled source path over the git URL", async () => {
  const bundled = join(temp, "vendor", "flashkey-mcp")
  internals.bundledFlashkey = bundled
  mkdirSync(bundled, { recursive: true })
  const pipArgs: string[][] = []
  internals.spawnSync = ((command: string, args: string[]) => {
    if (command === "python3" && args[0] === "-m" && args[1] === "pip") {
      pipArgs.push(args)
      return { status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null }
    }
    return { status: 1, stdout: "", stderr: "", pid: 0, output: [], signal: null }
  }) as unknown as typeof internals.spawnSync

  process.env.DSH_NO_SKILLS = "1"
  await bootstrapAll()

  expect(pipArgs.length).toBeGreaterThan(0)
  expect(pipArgs[0]!.slice(2)).toContain(bundled)
})
