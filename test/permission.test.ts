import { expect, test } from "bun:test"
import { nextMode } from "../src/permission"

test("permission mode cycles forward", () => {
  expect(nextMode("read-only")).toBe("workspace-write")
  expect(nextMode("workspace-write")).toBe("full-access")
  expect(nextMode("full-access")).toBe("read-only")
})

test("permission mode cycles backward with shift", () => {
  expect(nextMode("read-only", true)).toBe("full-access")
  expect(nextMode("full-access", true)).toBe("workspace-write")
  expect(nextMode("workspace-write", true)).toBe("read-only")
})
