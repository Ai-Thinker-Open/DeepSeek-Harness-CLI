import { afterEach, expect, test } from "bun:test"
import { checkForUpdate, isNewerVersion } from "../src/update"

test("isNewerVersion compares major/minor/patch", () => {
  expect(isNewerVersion("0.2.15", "0.2.14")).toBe(true)
  expect(isNewerVersion("0.3.0", "0.2.99")).toBe(true)
  expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true)
  expect(isNewerVersion("0.2.14", "0.2.14")).toBe(false)
  expect(isNewerVersion("0.2.13", "0.2.14")).toBe(false)
  expect(isNewerVersion("0.2.14-rc.1", "0.2.14")).toBe(false)
})

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("checkForUpdate returns a newer registry version", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ version: "99.0.0" }), { status: 200 })) as unknown as typeof fetch
  expect(await checkForUpdate()).toBe("99.0.0")
})

test("checkForUpdate returns null when already current or unreachable", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ version: "0.2.14" }), { status: 200 })) as unknown as typeof fetch
  expect(await checkForUpdate()).toBeNull()

  globalThis.fetch = (async () => {
    throw new Error("offline")
  }) as unknown as typeof fetch
  expect(await checkForUpdate()).toBeNull()
})
