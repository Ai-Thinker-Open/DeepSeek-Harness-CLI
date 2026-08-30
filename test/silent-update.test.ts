import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"
import { applyPendingUpdates, internals, stagePendingUpdates, updateMarkerPath } from "../src/dsh/silent-update"
import { internals as harnessInternals } from "../src/dsh/harness-update"

const savedFetch = internals.fetch
const savedSpawnSync = internals.spawnSync
const savedHarnessSpawnSync = harnessInternals.spawnSync
let tempRoot: string | undefined

afterEach(() => {
  internals.fetch = savedFetch
  internals.spawnSync = savedSpawnSync
  harnessInternals.spawnSync = savedHarnessSpawnSync
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
  delete process.env.DSH_HOME
  delete process.env.DSH_NO_UPDATE_CHECK
  delete process.env.DSH_DEBUG
})

/** Point DSH_HOME at a fresh temp dir and return the marker path. */
function markerPath(): string {
  tempRoot = mkdtempSync(join(tmpdir(), "dsh-cli-silent-"))
  process.env.DSH_HOME = tempRoot
  return updateMarkerPath()
}

/** Stub `npm install -g --prefix` to succeed and materialize the staged manifest. */
function installStub() {
  const calls: Array<{ command: string; args: string[] }> = []
  internals.spawnSync = ((_command: string, args: string[]) => {
    calls.push({ command: _command, args })
    const prefixIdx = args.indexOf("--prefix")
    if (prefixIdx >= 0 && args[0] === "install") {
      const staging = args[prefixIdx + 1] ?? ""
      const spec = args[args.length - 1] ?? ""
      const at = spec.lastIndexOf("@")
      const name = spec.slice(0, at)
      const version = spec.slice(at + 1)
      const pkgDir = join(staging, "node_modules", ...name.split("/"))
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name, version }))
    }
    return { status: 0 }
  }) as unknown as typeof internals.spawnSync
  return calls
}

/** Make the harness appear absent from the global npm prefix. */
function harnessNotInstalled() {
  harnessInternals.spawnSync = ((_command: string, args: string[]) => {
    if (args[0] === "root") return { status: 0, stdout: Buffer.from("/nonexistent-root") }
    return { status: 0 }
  }) as unknown as typeof harnessInternals.spawnSync
}

function registryVersion(version: string): typeof fetch {
  return (async () => {
    return new Response(JSON.stringify({ version }), { status: 200 })
  }) as unknown as typeof fetch
}

test("updateMarkerPath honors DSH_HOME", () => {
  process.env.DSH_HOME = "/tmp/custom-home"
  expect(updateMarkerPath()).toBe(join("/tmp/custom-home", ".updates-pending.json"))
})

test("applyPendingUpdates installs each pending update and clears the marker", async () => {
  const marker = markerPath()
  writeFileSync(
    marker,
    JSON.stringify({
      pending: [
        { pkg: "@deepseek-ai/dsh", version: "1.2.3" },
        { pkg: "@ai-thinker/deepseek-harness-cli", version: "0.4.0" },
      ],
    }),
  )
  const calls = installStub()
  calls.length = 0 // installStub also records; reset to only the apply calls.

  await applyPendingUpdates()

  const installs = calls.filter((c) => c.args[0] === "install").map((c) => c.args)
  expect(installs).toContainEqual(["install", "-g", "@deepseek-ai/dsh@1.2.3"])
  expect(installs).toContainEqual(["install", "-g", "@ai-thinker/deepseek-harness-cli@0.4.0"])
  expect(JSON.parse(readFileSync(marker, "utf8")).pending).toEqual([])
})

test("applyPendingUpdates keeps failed entries and writes a stderr line", async () => {
  const marker = markerPath()
  writeFileSync(marker, JSON.stringify({ pending: [{ pkg: "@deepseek-ai/dsh", version: "1.2.3" }] }))
  internals.spawnSync = (() => ({ status: 1, stderr: Buffer.from("boom") })) as unknown as typeof internals.spawnSync

  let stderr = ""
  const originalWrite = process.stderr.write
  process.stderr.write = ((chunk: string) => {
    stderr += chunk
    return true
  }) as typeof process.stderr.write
  try {
    await applyPendingUpdates()
  } finally {
    process.stderr.write = originalWrite
  }

  expect(JSON.parse(readFileSync(marker, "utf8")).pending).toEqual([{ pkg: "@deepseek-ai/dsh", version: "1.2.3" }])
  expect(stderr).toContain("@deepseek-ai/dsh@1.2.3")
  expect(stderr).toContain("boom")
})

test("applyPendingUpdates is a no-op without a marker or when disabled", async () => {
  markerPath()
  let calls = 0
  internals.spawnSync = ((..._args: unknown[]) => {
    calls++
    return { status: 0 }
  }) as unknown as typeof internals.spawnSync
  await applyPendingUpdates()
  expect(calls).toBe(0)

  const marker = markerPath()
  writeFileSync(marker, JSON.stringify({ pending: [{ pkg: "@deepseek-ai/dsh", version: "1.2.3" }] }))
  process.env.DSH_NO_UPDATE_CHECK = "1"
  await applyPendingUpdates()
  expect(calls).toBe(0)
})

test("stagePendingUpdates stages and records a newer dsh-cli", async () => {
  markerPath()
  harnessNotInstalled()
  internals.fetch = registryVersion("99.0.0")
  const calls = installStub()
  calls.length = 0

  await stagePendingUpdates()

  expect(calls.some((c) => c.args.includes("--prefix"))).toBe(true)
  const pending = JSON.parse(readFileSync(updateMarkerPath(), "utf8")).pending
  expect(pending).toContainEqual({ pkg: "@ai-thinker/deepseek-harness-cli", version: "99.0.0" })
})

test("stagePendingUpdates records nothing when already current", async () => {
  markerPath()
  harnessNotInstalled()
  internals.fetch = registryVersion("0.0.1")
  const calls = installStub()
  calls.length = 0

  await stagePendingUpdates()

  expect(calls.some((c) => c.args.includes("--prefix"))).toBe(false)
  expect(existsSync(updateMarkerPath())).toBe(false)
})

test("stagePendingUpdates keeps existing entries when the registry is unreachable", async () => {
  const marker = markerPath()
  writeFileSync(marker, JSON.stringify({ pending: [{ pkg: "@deepseek-ai/dsh", version: "1.2.3" }] }))
  // The harness is globally installed, so a pending harness entry is meaningful.
  const globalRoot = join(tempRoot!, "global-root")
  const harnessDir = join(globalRoot, "@deepseek-ai", "dsh")
  mkdirSync(harnessDir, { recursive: true })
  writeFileSync(join(harnessDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "1.0.0" }))
  harnessInternals.spawnSync = ((_command: string, args: string[]) => {
    if (args[0] === "root") return { status: 0, stdout: Buffer.from(globalRoot) }
    return { status: 0 }
  }) as unknown as typeof harnessInternals.spawnSync
  internals.fetch = (async () => {
    throw new Error("offline")
  }) as unknown as typeof fetch
  const calls = installStub()
  calls.length = 0

  await stagePendingUpdates()

  expect(calls.some((c) => c.args.includes("--prefix"))).toBe(false)
  expect(JSON.parse(readFileSync(marker, "utf8")).pending).toEqual([{ pkg: "@deepseek-ai/dsh", version: "1.2.3" }])
})

test("stagePendingUpdates stages a newer harness when installed globally", async () => {
  markerPath()
  const globalRoot = join(tempRoot!, "global-root")
  const harnessDir = join(globalRoot, "@deepseek-ai", "dsh")
  mkdirSync(harnessDir, { recursive: true })
  writeFileSync(join(harnessDir, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "1.0.0" }))
  harnessInternals.spawnSync = ((_command: string, args: string[]) => {
    if (args[0] === "root") return { status: 0, stdout: Buffer.from(globalRoot) }
    return { status: 0 }
  }) as unknown as typeof harnessInternals.spawnSync

  internals.fetch = (async (url: string) => {
    const text = String(url)
    const version = text.includes("@ai-thinker%2Fdeepseek-harness-cli") ? "0.0.1" : "99.0.0"
    return new Response(JSON.stringify({ version }), { status: 200 })
  }) as unknown as typeof fetch
  const calls = installStub()
  calls.length = 0

  await stagePendingUpdates()

  const pending = JSON.parse(readFileSync(updateMarkerPath(), "utf8")).pending
  expect(pending).toContainEqual({ pkg: "@deepseek-ai/dsh", version: "99.0.0" })
  expect(pending).not.toContainEqual({ pkg: "@ai-thinker/deepseek-harness-cli", version: "0.0.1" })
})
