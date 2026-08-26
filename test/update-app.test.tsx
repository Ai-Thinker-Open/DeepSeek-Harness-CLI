/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/app"
import type { HarnessClientLike } from "../src/harness/client"

const previousSkip = process.env.DSH_SKIP_RISK_CONFIRM
const previousNoUpdate = process.env.DSH_NO_UPDATE_CHECK
const originalFetch = globalThis.fetch

afterAll(() => {
  if (previousSkip === undefined) delete process.env.DSH_SKIP_RISK_CONFIRM
  else process.env.DSH_SKIP_RISK_CONFIRM = previousSkip
  if (previousNoUpdate === undefined) delete process.env.DSH_NO_UPDATE_CHECK
  else process.env.DSH_NO_UPDATE_CHECK = previousNoUpdate
  globalThis.fetch = originalFetch
})

const stubClient = {
  credentialsDescribe: async () => ({}),
} as unknown as HarnessClientLike

test("startup offers to update when a newer version exists", async () => {
  process.env.DSH_SKIP_RISK_CONFIRM = "1"
  delete process.env.DSH_NO_UPDATE_CHECK
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ version: "99.0.0" }), { status: 200 })) as unknown as typeof fetch

  const app = await testRender(() => <App client={stubClient} />, { width: 90, height: 34 })
  await new Promise((resolve) => setTimeout(resolve, 120))
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("发现新版本")
  expect(frame).toContain("99.0.0")
  expect(frame).toContain("立即更新（推荐）")
  expect(frame).toContain("暂不更新")

  // Decline: continue with the current version into the normal startup.
  app.mockInput.pressArrow("down")
  await new Promise((resolve) => setTimeout(resolve, 30))
  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 120))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("DeepSeek Harness CLI")
})

test("approving the update runs the updater instead of starting", async () => {
  process.env.DSH_SKIP_RISK_CONFIRM = "1"
  delete process.env.DSH_NO_UPDATE_CHECK
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ version: "99.0.0" }), { status: 200 })) as unknown as typeof fetch
  let updated: string | undefined

  const app = await testRender(
    () => <App client={stubClient} onUpdate={(latest) => (updated = latest)} />,
    { width: 90, height: 34 },
  )
  await new Promise((resolve) => setTimeout(resolve, 120))
  await app.renderOnce()

  app.mockInput.pressEnter() // default selection: 立即更新
  await new Promise((resolve) => setTimeout(resolve, 120))
  await app.renderOnce()
  expect(updated).toBe("99.0.0")
})
