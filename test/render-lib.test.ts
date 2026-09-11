import { expect, test } from "bun:test"
import { renderLibPackageCandidates, renderLibProblemFor } from "../src/dsh/render-lib"

test("names the native package for the common targets", () => {
  expect(renderLibPackageCandidates("win32", "x64")).toEqual(["@opentui/core-win32-x64"])
  expect(renderLibPackageCandidates("darwin", "arm64")).toEqual(["@opentui/core-darwin-arm64"])
  expect(renderLibPackageCandidates("linux", "x64")).toEqual([
    "@opentui/core-linux-x64",
    "@opentui/core-linux-x64-musl",
  ])
})

test("skips platforms this package knows nothing about", () => {
  expect(renderLibPackageCandidates("freebsd", "x64")).toEqual([])
  expect(renderLibPackageCandidates("linux", "arm")).toEqual([])
  expect(renderLibProblemFor("freebsd", "x64", () => false)).toBeNull()
})

test("accepts either the glibc or the musl build on linux", () => {
  expect(renderLibProblemFor("linux", "x64", (s) => s === "@opentui/core-linux-x64")).toBeNull()
  expect(renderLibProblemFor("linux", "x64", (s) => s === "@opentui/core-linux-x64-musl")).toBeNull()
})

test("reports a missing native package, naming the target and expected specifiers", () => {
  const problem = renderLibProblemFor("linux", "x64", () => false)
  expect(problem).toContain("linux-x64")
  expect(problem).toContain("@opentui/core-linux-x64")
  expect(problem).toContain("installed for a different OS")
})

test("a foreign-platform package does not satisfy this platform", () => {
  // A Windows-installed tree carries core-win32-x64; linux-x64 still counts as missing.
  const problem = renderLibProblemFor("linux", "x64", (s) => s === "@opentui/core-win32-x64")
  expect(problem).not.toBeNull()
})

test("stays silent when the resolution API cannot answer", () => {
  expect(renderLibProblemFor("linux", "x64", () => undefined)).toBeNull()
})

test("reports when only an inconclusive probe remains", () => {
  expect(
    renderLibProblemFor("linux", "x64", (s) => (s.endsWith("-musl") ? undefined : false)),
  ).not.toBeNull()
})
