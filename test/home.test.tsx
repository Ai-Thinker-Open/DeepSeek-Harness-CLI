/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { Home } from "../src/screens/home"

test("home screen renders brand and version", async () => {
  const app = await testRender(() => <Home motion={false} loading={false} />, { width: 80, height: 32 })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("DeepSeek Harness")
  expect(frame).toContain("v0.1.0")
  expect(frame).toContain("Tab 切换模式")
})
