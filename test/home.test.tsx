/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { Home } from "../src/screens/home"
import pkg from "../package.json"

test("home screen renders brand and version", async () => {
  const app = await testRender(() => <Home motion={false} loading={false} />, { width: 80, height: 32 })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("DeepSeek Harness")
  expect(frame).toContain(`v${pkg.version}`)
  expect(frame).toContain("tab 切换权限")
  expect(frame).toContain("/mcp")
  expect(frame).toContain("MCP")
  expect(frame).toContain("● 提示")
  expect(frame).toContain("DeepSeek-V4-Flash")
})
