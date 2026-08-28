import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"
import { ensureHarnessUpToDate, installedHarnessVersion, internals, latestHarnessVersion } from "../src/dsh/harness-update"

const savedFetch = internals.fetch
const savedSpawnSync = internals.spawnSync
let tempRoot: string | undefined

afterEach(() => {
  internals.fetch = savedFetch
  internals.spawnSync = savedSpawnSync
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

function fakeSpawnSync(stdout: string, options?: { status?: number; installStatus?: number }) {
  const calls: Array<{ command: string; args: string[] }> = []
  internals.spawnSync = ((_command: string, args: string[]) => {
    calls.push({ command: _command, args })
    if (args[0] === "root") {
      return { status: options?.status ?? 0, stdout: Buffer.from(stdout) }
    }
    if (args[0] === "install") {
      return { status: options?.installStatus ?? 0, stderr: "stub error" }
    }
    return { status: 0 }
  }) as unknown as typeof internals.spawnSync
  return calls
}

function fakeFetch(version: string | null, ok = true) {
  internals.fetch = (async () => {
    if (version === null) throw new Error("offline")
    return new Response(JSON.stringify({ version }), { status: ok ? 200 : 500 })
  }) as unknown as typeof fetch
}

test("installedHarnessVersion reads the global dsh package.json", () => {
  tempRoot = mkdtempSync(join(tmpdir(), "dsh-cli-harness-version-"))
  const pkgDir = join(tempRoot, "@deepseek-ai", "dsh")
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "1.2.3" }))
  fakeSpawnSync(tempRoot)
  expect(installedHarnessVersion()).toBe("1.2.3")
})

test("installedHarnessVersion is undefined without a global install", () => {
  fakeSpawnSync("/nonexistent-root")
  expect(installedHarnessVersion()).toBeUndefined()
  fakeSpawnSync("", { status: 1 })
  expect(installedHarnessVersion()).toBeUndefined()
})

test("latestHarnessVersion returns the registry version or null", async () => {
  fakeFetch("9.9.9")
  expect(await latestHarnessVersion()).toBe("9.9.9")
  fakeFetch(null)
  expect(await latestHarnessVersion()).toBeNull()
  fakeFetch("9.9.9", false)
  expect(await latestHarnessVersion()).toBeNull()
})

test("ensureHarnessUpToDate installs the newer harness", async () => {
  tempRoot = mkdtempSync(join(tmpdir(), "dsh-cli-harness-update-"))
  const pkgDir = join(tempRoot, "@deepseek-ai", "dsh")
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "1.0.0" }))
  const calls = fakeSpawnSync(tempRoot)
  fakeFetch("2.0.0")

  const result = await ensureHarnessUpToDate()
  expect(result).toEqual({ before: "1.0.0", after: "2.0.0" })
  const install = calls.find((c) => c.args[0] === "install")
  expect(install?.args).toEqual(["install", "-g", "@deepseek-ai/dsh@2.0.0"])
})

test("ensureHarnessUpToDate does nothing when already current", async () => {
  tempRoot = mkdtempSync(join(tmpdir(), "dsh-cli-harness-current-"))
  const pkgDir = join(tempRoot, "@deepseek-ai", "dsh")
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "2.0.0" }))
  const calls = fakeSpawnSync(tempRoot)
  fakeFetch("2.0.0")

  const result = await ensureHarnessUpToDate()
  expect(result).toEqual({ before: "2.0.0", after: "2.0.0" })
  expect(calls.some((c) => c.args[0] === "install")).toBe(false)
})

test("ensureHarnessUpToDate keeps the current version when the install fails", async () => {
  tempRoot = mkdtempSync(join(tmpdir(), "dsh-cli-harness-fail-"))
  const pkgDir = join(tempRoot, "@deepseek-ai", "dsh")
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "1.0.0" }))
  fakeSpawnSync(tempRoot, { installStatus: 1 })
  fakeFetch("2.0.0")

  const result = await ensureHarnessUpToDate()
  expect(result).toEqual({ before: "1.0.0", after: "1.0.0" })
})

test("ensureHarnessUpToDate skips everything when the harness is not global", async () => {
  fakeSpawnSync("/nonexistent-root")
  let fetched = false
  internals.fetch = (async () => {
    fetched = true
    return new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 })
  }) as unknown as typeof fetch

  const result = await ensureHarnessUpToDate()
  expect(result).toEqual({ before: undefined, after: undefined })
  expect(fetched).toBe(false)
})
