import { expect, test } from "bun:test"
import { MIN_NODE_MAJOR, bunVersionProblemFor, nodeVersionProblemFor } from "../src/dsh/node-version"

test("accepts Node 22 and newer", () => {
  expect(nodeVersionProblemFor("22.0.0", false)).toBeNull()
  expect(nodeVersionProblemFor("24.14.0", false)).toBeNull()
})

test("rejects Node 20 with a clear message", () => {
  const problem = nodeVersionProblemFor("20.20.2", false)
  expect(problem).toContain("Node.js 20.20.2 is too old")
  expect(problem).toContain(`Node.js ${MIN_NODE_MAJOR}+`)
})

test("skips Bun regardless of the emulated Node version", () => {
  expect(nodeVersionProblemFor("20.19.0", true)).toBeNull()
})

test("tolerates unknown or missing versions", () => {
  expect(nodeVersionProblemFor(undefined, false)).toBeNull()
  expect(nodeVersionProblemFor("weird", false)).toBeNull()
})

test("bun 1.4+ is rejected on Windows with a clear fix hint", () => {
  const problem = bunVersionProblemFor("1.4.0", true)
  expect(problem).toContain("bun 1.4.0 is incompatible")
  expect(problem).toContain("1.3.14")
  expect(bunVersionProblemFor("1.3.14", true)).toBeNull()
  expect(bunVersionProblemFor("2.0.0", true)).toContain("bun 2.0.0 is incompatible")
})

test("bun version guard only applies to Windows", () => {
  expect(bunVersionProblemFor("1.4.0", false)).toBeNull()
  expect(bunVersionProblemFor(undefined, true)).toBeNull()
  expect(bunVersionProblemFor("weird", true)).toBeNull()
})
