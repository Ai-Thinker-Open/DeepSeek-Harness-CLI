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

test("home screen version badge honors the DSH_CLI_VERSION override", async () => {
  // The badge reads the launcher-supplied DSH_CLI_VERSION first and falls back
  // to its own build-baked version, so an upgraded launcher can show the new
  // version even when the tui profile bundle's dist is still the old copy.
  // Keep the override value short: the footer right-aligns the next to cwd +
  // the MCP status, and a long value is clipped off the 80-col frame (it only
  // shows on short working dirs, e.g. a CI checkout).
  const saved = process.env.DSH_CLI_VERSION
  process.env.DSH_CLI_VERSION = "9.9.9"
  try {
    const app = await testRender(() => <Home motion={false} loading={false} />, { width: 80, height: 32 })
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("v9.9.9")
    expect(frame).not.toContain(`v${pkg.version}`)
  } finally {
    if (saved === undefined) delete process.env.DSH_CLI_VERSION
    else process.env.DSH_CLI_VERSION = saved
  }
})
