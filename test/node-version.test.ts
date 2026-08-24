import { expect, test } from "bun:test"
import { MIN_NODE_MAJOR, nodeVersionProblemFor } from "../src/dsh/node-version"

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
