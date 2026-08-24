import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"
import { internals as dispatcherInternals, PROFILE_NAME, run } from "../src/dsh/dispatcher"
import { resolveBun } from "../src/dsh/portable"

type SpawnCall = { command: string; args: string[]; options: { env?: Record<string, string | undefined> } }
type SyncCall = { command: string; args: string[] }

const savedEnv = { ...process.env }
const savedProbe = dispatcherInternals.probe
const savedSpawn = dispatcherInternals.spawn
const savedSpawnSync = dispatcherInternals.spawnSync
let profileHome: string | undefined

afterEach(() => {
  process.env = { ...savedEnv }
  dispatcherInternals.probe = savedProbe
  dispatcherInternals.spawn = savedSpawn
  dispatcherInternals.spawnSync = savedSpawnSync
  if (profileHome) rmSync(profileHome, { recursive: true, force: true })
  profileHome = undefined
})

function installSpawn() {
  const calls: SpawnCall[] = []
  const children: EventEmitter[] = []
  dispatcherInternals.spawn = ((command: string, args: string[], options?: unknown) => {
    calls.push({ command, args, options: (options ?? {}) as SpawnCall["options"] })
    const child = new EventEmitter()
    children.push(child)
    return child
  }) as typeof dispatcherInternals.spawn
  return { calls, children }
}

function installSpawnSync(responses: Record<string, { status: number | null }>) {
  const calls: SyncCall[] = []
  dispatcherInternals.spawnSync = ((command: string, args: string[], _options?: unknown) => {
    calls.push({ command, args })
    const key = args[0] ?? ""
    return responses[key] ?? { status: 0 }
  }) as typeof dispatcherInternals.spawnSync
  return { calls }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

function writeProfile(bundles: string[]) {
  profileHome = mkdtempSync(join(tmpdir(), "dsh-cli-test-"))
  process.env.DSH_HOME = profileHome
  const dir = join(profileHome, "profiles", PROFILE_NAME)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dsh: { profile: { bundles } } }))
}

test("dispatcher reuses a reachable harness and runs the client directly", async () => {
  const { calls, children } = installSpawn()
  dispatcherInternals.probe = async () => true
  process.env.DSH_URL = "http://127.0.0.1:3999"

  const pending = run([])
  await settle()
  children[0]?.emit("exit", 0)
  await expect(pending).resolves.toBe(0)

  expect(calls).toHaveLength(1)
  expect(calls[0]?.command).toBe(resolveBun())
  expect(calls[0]?.options.env?.DSH_URL).toBe("http://127.0.0.1:3999")
  expect(calls[0]?.options.env?.DSH_CWD).toBe(process.cwd())
})

test("dispatcher forwards -c to the client when the harness is reachable", async () => {
  const { calls, children } = installSpawn()
  dispatcherInternals.probe = async () => true

  const pending = run(["-c"])
  await settle()
  children[0]?.emit("exit", 0)
  await expect(pending).resolves.toBe(0)

  expect(calls).toHaveLength(1)
  expect(calls[0]?.args).toContain("-c")
})

test("dispatcher boots dsh --profile tui when the profile already has the bundle", async () => {
  const { calls, children } = installSpawn()
  const { calls: syncCalls } = installSpawnSync({ "--help": { status: 0 }, plugin: { status: 0 } })
  dispatcherInternals.probe = async () => false
  writeProfile(["@ai-thinker/deepseek-harness-cli"])

  const pending = run(["--port", "3199"])
  await settle()
  children[0]?.emit("exit", 2)
  await expect(pending).resolves.toBe(2)

  expect(calls).toHaveLength(1)
  expect(calls[0]?.command).toBe("dsh")
  expect(calls[0]?.args).toEqual(["--profile", "tui", "--port", "3199"])
  expect(calls[0]?.options.env).toBe(process.env)
  expect(syncCalls.map((c) => c.args[0])).not.toContain("plugin")
})

test("dispatcher initializes the tui profile before booting it", async () => {
  const { calls, children } = installSpawn()
  const { calls: syncCalls } = installSpawnSync({ "--help": { status: 0 }, plugin: { status: 0 } })
  dispatcherInternals.probe = async () => false
  profileHome = mkdtempSync(join(tmpdir(), "dsh-cli-test-"))
  process.env.DSH_HOME = profileHome

  const pending = run([])
  await settle()
  children[0]?.emit("exit", 0)
  await expect(pending).resolves.toBe(0)

  const pluginCall = syncCalls.find((c) => c.args.includes("plugin"))
  expect(pluginCall).toBeDefined()
  expect(pluginCall?.args[0]).toBe("plugin")
  expect(pluginCall?.args.slice(0, 3)).toEqual(["plugin", "--profile", "tui", "add"].slice(0, 3))
  expect(pluginCall?.args[3]).toBe("add")
  expect(pluginCall?.args[4]?.startsWith("file:")).toBe(true)
  expect(calls[0]?.command).toBe("dsh")
  expect(calls[0]?.args).toEqual(["--profile", "tui"])
})

test("dispatcher falls back to npx when dsh is not installed and no cache exists", async () => {
  const { calls, children } = installSpawn()
  installSpawnSync({ "--help": { status: null } })
  dispatcherInternals.probe = async () => false
  writeProfile(["@ai-thinker/deepseek-harness-cli"])
  process.env.DSH_NPX_CACHE = join(tmpdir(), "dsh-cli-empty-npx")

  const pending = run([])
  await settle()
  children[0]?.emit("exit", 0)
  await expect(pending).resolves.toBe(0)

  expect(calls[0]?.command).toBe("npx")
  expect(calls[0]?.args).toEqual(["--yes", "@deepseek-ai/dsh", "--profile", "tui"])
})

test("dispatcher reuses an installed npx cache entry instead of npx", async () => {
  const { calls, children } = installSpawn()
  installSpawnSync({ "--help": { status: null } })
  dispatcherInternals.probe = async () => false
  writeProfile(["@ai-thinker/deepseek-harness-cli"])
  const cache = join(tmpdir(), "dsh-cli-npx-cache")
  mkdirSync(join(cache, "1e7f6d9597241db0", "node_modules", ".bin"), { recursive: true })
  writeFileSync(join(cache, "1e7f6d9597241db0", "node_modules", ".bin", "dsh"), "#!/bin/sh\n")
  process.env.DSH_NPX_CACHE = cache

  const pending = run([])
  await settle()
  children[0]?.emit("exit", 0)
  await expect(pending).resolves.toBe(0)

  expect(calls[0]?.command).toBe(join(cache, "1e7f6d9597241db0", "node_modules", ".bin", "dsh"))
  expect(calls[0]?.args).toEqual(["--profile", "tui"])
})

test("dispatcher migrates a stale legacy bundle alias before booting", async () => {
  const { calls, children } = installSpawn()
  const { calls: syncCalls } = installSpawnSync({ "--help": { status: 0 }, plugin: { status: 0 } })
  dispatcherInternals.probe = async () => false
  writeProfile(["deepseek-harness-cli"])

  const pending = run([])
  await settle()
  children[0]?.emit("exit", 0)
  await expect(pending).resolves.toBe(0)

  const dir = join(profileHome!, "profiles", PROFILE_NAME)
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  expect(manifest.dsh.profile.bundles).toEqual(["@ai-thinker/deepseek-harness-cli"])
  expect(syncCalls.map((c) => c.args[0])).not.toContain("plugin")
  expect(calls[0]?.command).toBe("dsh")
})

test("dispatcher dedupes a legacy alias alongside the current name", async () => {
  const { children } = installSpawn()
  installSpawnSync({ "--help": { status: 0 }, plugin: { status: 0 } })
  dispatcherInternals.probe = async () => false
  writeProfile(["@ai-thinker/deepseek-harness-cli", "deepseek-harness-cli", "@deepseek-ai/dsh-base"])

  const pending = run([])
  await settle()
  children[0]?.emit("exit", 0)
  await expect(pending).resolves.toBe(0)

  const dir = join(profileHome!, "profiles", PROFILE_NAME)
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  expect(manifest.dsh.profile.bundles).toEqual(["@ai-thinker/deepseek-harness-cli", "@deepseek-ai/dsh-base"])
})

test("dispatcher prunes legacy dependency entries during migration", async () => {
  const { children } = installSpawn()
  installSpawnSync({ "--help": { status: 0 }, plugin: { status: 0 } })
  dispatcherInternals.probe = async () => false
  profileHome = mkdtempSync(join(tmpdir(), "dsh-cli-test-"))
  process.env.DSH_HOME = profileHome
  const dir = join(profileHome, "profiles", PROFILE_NAME)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      dependencies: {
        "deepseek-harness-cli": "link:/home/seahi/workspace/dsh-cli",
        other: "1.0.0",
      },
      dsh: { profile: { bundles: ["deepseek-harness-cli"] } },
    }),
  )

  const pending = run([])
  await settle()
  children[0]?.emit("exit", 0)
  await expect(pending).resolves.toBe(0)

  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  expect(manifest.dependencies).toEqual({ other: "1.0.0" })
  expect(manifest.dsh.profile.bundles).toEqual(["@ai-thinker/deepseek-harness-cli"])
})
