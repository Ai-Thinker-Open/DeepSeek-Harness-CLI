import { afterEach, expect, test } from "bun:test"
import { apply, internals as startupInternals, TUI_STARTUP_SERVICE, type TuiStartupValues } from "../src/dsh/startup"

function fakeCtx(args: string[]) {
  const services = new Map<string, unknown>()
  const exitCalls: number[] = []
  services.set("cmdlineArgs", { get: () => args })
  services.set("appExit", (code: number) => {
    exitCalls.push(code)
  })
  const ctx = {
    get: <T>(key: string): T | undefined => services.get(key) as T | undefined,
    provide: (key: string, value: unknown) => {
      services.set(key, value)
    },
  }
  return { ctx, exitCalls, services }
}

const originalStdout = startupInternals.stdout
const originalStderr = startupInternals.stderr
let capturedOut: string[]
let capturedErr: string[]

afterEach(() => {
  startupInternals.stdout = originalStdout
  startupInternals.stderr = originalStderr
})

function capture() {
  capturedOut = []
  capturedErr = []
  startupInternals.stdout = { write: (chunk) => { capturedOut.push(String(chunk)); return true } }
  startupInternals.stderr = { write: (chunk) => { capturedErr.push(String(chunk)); return true } }
}

function startupFor(args: string[]): TuiStartupValues | undefined {
  const { ctx } = fakeCtx(args)
  apply(ctx)
  return ctx.get<TuiStartupValues>(TUI_STARTUP_SERVICE)
}

test("tui-startup provides loopback defaults", () => {
  const { ctx, exitCalls } = fakeCtx([])
  apply(ctx)
  expect(ctx.get<TuiStartupValues>(TUI_STARTUP_SERVICE)).toEqual({ host: "127.0.0.1", port: 3080, cwd: undefined })
  expect(exitCalls).toEqual([])
})

test("tui-startup parses --port, --cwd and explicit --host", () => {
  const startup = startupFor(["--port", "3199", "--cwd", "/tmp/ws", "--host", "127.0.0.1"])
  expect(startup).toEqual({ host: "127.0.0.1", port: 3199, cwd: "/tmp/ws" })
})

test("tui-startup accepts --port=0 and equals syntax", () => {
  expect(startupFor(["--port=0"])?.port).toBe(0)
  expect(startupFor(["--cwd=/tmp/x"])?.cwd).toBe("/tmp/x")
})

test("tui-startup rejects non-numeric and out-of-range ports", () => {
  for (const bad of ["abc", "70000"]) {
    capture()
    const { ctx, exitCalls } = fakeCtx(["--port", bad])
    apply(ctx)
    expect(exitCalls).toEqual([1])
    expect(ctx.get(TUI_STARTUP_SERVICE)).toBeUndefined()
    expect(capturedErr.join("")).toContain("--port")
  }
})

test("tui-startup rejects non-loopback hosts", () => {
  capture()
  const { ctx, exitCalls } = fakeCtx(["--host", "0.0.0.0"])
  apply(ctx)
  expect(exitCalls).toEqual([1])
  expect(ctx.get(TUI_STARTUP_SERVICE)).toBeUndefined()
  expect(capturedErr.join("")).toContain("loopback")
})

test("tui-startup --help prints usage and exits 0", () => {
  capture()
  const { ctx, exitCalls } = fakeCtx(["--help"])
  apply(ctx)
  expect(exitCalls).toEqual([0])
  expect(capturedOut.join("")).toContain("--port")
  expect(ctx.get(TUI_STARTUP_SERVICE)).toBeUndefined()
})

test("tui-startup rejects unknown options and missing values", () => {
  capture()
  const unknown = fakeCtx(["--nope"])
  apply(unknown.ctx)
  expect(unknown.exitCalls).toEqual([1])
  expect(capturedErr.join("")).toContain("unknown option")

  capture()
  const missing = fakeCtx(["--port"])
  apply(missing.ctx)
  expect(missing.exitCalls).toEqual([1])
  expect(capturedErr.join("")).toContain("argument missing")
})
