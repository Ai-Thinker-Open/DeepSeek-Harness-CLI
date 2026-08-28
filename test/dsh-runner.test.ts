import { EventEmitter } from "node:events"
import { expect, test } from "bun:test"
import { apply, Config, internals as runnerInternals } from "../src/dsh/runner"
import { resolveBun } from "../src/dsh/portable"

type SpawnCall = { command: string; args: string[]; options: { env?: Record<string, string | undefined> } }

function fakeCtx(services: Record<string, unknown>) {
  const exitCalls: number[] = []
  const all = { ...services }
  if (!("appExit" in all)) {
    all.appExit = (code: number) => {
      exitCalls.push(code)
    }
  }
  const ctx = {
    get: <T>(key: string): T | undefined => all[key] as T | undefined,
    provide: () => {},
  }
  return { ctx, exitCalls }
}

function installSpawn() {
  const calls: SpawnCall[] = []
  let child: EventEmitter | undefined
  runnerInternals.spawn = ((command: string, args: string[], options?: unknown) => {
    calls.push({ command, args, options: (options ?? {}) as SpawnCall["options"] })
    child = new EventEmitter()
    return child
  }) as typeof runnerInternals.spawn
  return { calls, child: () => child }
}

test("tui-runner spawns the client with the bound URL and workspace", () => {
  const { calls, child } = installSpawn()
  const { ctx, exitCalls } = fakeCtx({ webServer: { host: "127.0.0.1", port: 4123 } })
  apply(ctx, { startup: { host: "127.0.0.1", port: 4123, cwd: "/ws", continueLast: false } })

  expect(calls).toHaveLength(1)
  expect(calls[0]?.command).toBe(resolveBun())
  expect(calls[0]?.args[0]?.endsWith("cli.js")).toBe(true)
  expect(calls[0]?.options.env?.DSH_URL).toBe("http://127.0.0.1:4123")
  expect(calls[0]?.options.env?.DSH_CWD).toBe("/ws")

  child()?.emit("exit", 3)
  expect(exitCalls).toEqual([3])
})

test("tui-runner forwards --continue to the client", () => {
  const { calls, child } = installSpawn()
  const { ctx } = fakeCtx({ webServer: { host: "127.0.0.1", port: 4123 } })
  apply(ctx, { startup: { host: "127.0.0.1", port: 4123, cwd: "/ws", continueLast: true } })

  expect(calls[0]?.args).toContain("--continue")
  expect(calls[0]?.args[calls[0]!.args.length - 1]).toBe("--continue")
  child()?.emit("exit", 0)
})

test("tui-runner defaults the workspace to the process cwd", () => {
  const { calls } = installSpawn()
  const { ctx } = fakeCtx({ webServer: { host: "127.0.0.1", port: 3080 } })
  apply(ctx)
  expect(calls[0]?.options.env?.DSH_CWD).toBe(process.cwd())
  expect(calls[0]?.options.env?.DSH_URL).toBe("http://127.0.0.1:3080")
})

test("tui-runner exits 1 when bun cannot be spawned", () => {
  const { child } = installSpawn()
  const { ctx, exitCalls } = fakeCtx({ webServer: { host: "127.0.0.1", port: 3080 } })
  apply(ctx)
  child()?.emit("error", Object.assign(new Error("spawn bun ENOENT"), { code: "ENOENT" }))
  expect(exitCalls).toEqual([1])
})

test("tui-runner fails loud without webServer or appExit", () => {
  expect(() => apply(fakeCtx({}).ctx)).toThrow("webServer")
  expect(() => apply(fakeCtx({ webServer: { host: "127.0.0.1", port: 3080 }, appExit: undefined }).ctx)).toThrow("appExit")
})

test("tui-runner Config schema accepts defaults and the tuiStartup shape", () => {
  const empty = Config({})
  expect(empty.startup?.host).toBe("127.0.0.1")
  expect(empty.startup?.port).toBe(3080)
  expect(empty.startup?.continueLast).toBe(false)
  expect(empty.startup?.cwd).toBeUndefined()
  expect(Config({ startup: { host: "127.0.0.1", port: 3080, cwd: undefined, continueLast: false } })).toEqual(empty)
  const full = Config({
    startup: { host: "127.0.0.1", port: 0, cwd: "/ws", continueLast: true },
  })
  expect(full.startup).toEqual({ host: "127.0.0.1", port: 0, cwd: "/ws", continueLast: true })
})

test("tui-runner Config schema rejects invalid types", () => {
  const invalid = (value: unknown) => () => Config(value as Parameters<typeof Config>[0])
  expect(invalid({ startup: { port: "not-a-number" } })).toThrow()
  expect(invalid({ startup: { host: 7 } })).toThrow()
})
