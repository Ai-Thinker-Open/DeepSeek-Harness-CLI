import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyMcpPatch, bootstrapAll, internals, linkSkillBundles } from "../src/dsh/bootstrap"

let temp: string
const savedEnv: Record<string, string | undefined> = {}
const savedInternals = { ...internals }

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "dsh-bootstrap-"))
  for (const key of ["DSH_HOME", "DSH_SKIP_BOOTSTRAP", "DSH_NO_SKILLS", "DSH_NO_FLASHKEY"]) {
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
