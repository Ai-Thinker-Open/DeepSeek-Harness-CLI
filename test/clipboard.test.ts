import { expect, test } from "bun:test"
import { copySelection } from "../src/clipboard"

test("copySelection skips empty selections", () => {
  expect(copySelection({ copyToClipboardOSC52: () => true }, "   ")).toBe("empty")
})

test("copySelection reports success when the terminal accepts the write", () => {
  expect(copySelection({ copyToClipboardOSC52: () => true }, "hello")).toBe("ok")
})

test("copySelection reports unsupported when OSC52 is unavailable", () => {
  expect(copySelection({ copyToClipboardOSC52: () => false }, "hello")).toBe("unsupported")
})
