/** @jsxImportSource @opentui/solid */
import { afterAll, beforeAll, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtempSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { App } from "../src/app"
import { markWorkspaceConfirmed } from "../src/directory-risk"
import type { HarnessClientLike } from "../src/harness/client"

const previousCwd = process.env.DSH_CWD
const previousSkip = process.env.DSH_SKIP_RISK_CONFIRM
const previousHome = process.env.DSH_HOME
let riskHome: string | undefined

/** Ensure a sibling test file's `DSH_SKIP_RISK_CONFIRM=1` cannot leak in. */
const gateActive = () => {
  delete process.env.DSH_SKIP_RISK_CONFIRM
  process.env.DSH_NO_UPDATE_CHECK = "1"
}

beforeAll(() => {
  riskHome = mkdtempSync(join(tmpdir(), "dsh-risk-app-"))
  process.env.DSH_HOME = riskHome
})

afterAll(() => {
  if (riskHome) rmSync(riskHome, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (previousCwd === undefined) delete process.env.DSH_CWD
  else process.env.DSH_CWD = previousCwd
  if (previousSkip === undefined) delete process.env.DSH_SKIP_RISK_CONFIRM
  else process.env.DSH_SKIP_RISK_CONFIRM = previousSkip
})

/** Minimal stub: the API-key gate reports "unsupported" and startup proceeds. */
const stubClient = {
  credentialsDescribe: async () => ({}),
} as unknown as HarnessClientLike

test("startup shows the directory confirmation before the home screen", async () => {
  gateActive()
  process.env.DSH_CWD = "/tmp/risk-ws-start"
  const app = await testRender(() => <App client={stubClient} />, { width: 90, height: 34 })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("目录确认")
  expect(frame).toContain("/tmp/risk-ws-start")
  expect(frame).toContain("退出（推荐）")
  expect(frame).toContain("我了解风险，仅本次信任")

  // Select "我了解风险，仅本次信任" and confirm: the gate closes and the
  // normal startup (home screen) takes over.
  app.mockInput.pressArrow("down")
  await new Promise((resolve) => setTimeout(resolve, 30))
  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 120))
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("DeepSeek Harness CLI")
})

test("home directory shows the red high-risk warning", async () => {
  gateActive()
  process.env.DSH_CWD = homedir()
  const app = await testRender(() => <App client={stubClient} />, { width: 90, height: 34 })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("目录风险警告")
  expect(frame).toContain("SSH 密钥")
  expect(frame).toContain("恶意插件")
})

test("escape exits instead of proceeding", async () => {
  gateActive()
  process.env.DSH_CWD = "/tmp/risk-ws-escape"
  let exited = 0
  const app = await testRender(() => <App client={stubClient} onExit={() => exited++} />, { width: 90, height: 34 })
  await app.renderOnce()

  app.mockInput.pressEscape()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()
  expect(exited).toBe(1)
})

test("enter on the recommended exit option exits", async () => {
  gateActive()
  process.env.DSH_CWD = "/tmp/risk-ws-enter"
  let exited = 0
  const app = await testRender(() => <App client={stubClient} onExit={() => exited++} />, { width: 90, height: 34 })
  await app.renderOnce()

  app.mockInput.pressEnter()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await app.renderOnce()
  expect(exited).toBe(1)
})

test("DSH_SKIP_RISK_CONFIRM=1 bypasses the gate", async () => {
  process.env.DSH_CWD = "/tmp/risk-ws-bypass"
  process.env.DSH_SKIP_RISK_CONFIRM = "1"
  const app = await testRender(() => <App client={stubClient} />, { width: 90, height: 34 })
  await new Promise((resolve) => setTimeout(resolve, 120))
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).not.toContain("目录确认")
  expect(frame).toContain("DeepSeek Harness CLI")
})

test("continue mode is gated too", async () => {
  gateActive()
  process.env.DSH_CWD = "/tmp/risk-ws-continue"
  let exited = 0
  const app = await testRender(
    () => <App client={stubClient} continueLast onExit={() => exited++} />,
    { width: 90, height: 34 },
  )
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("目录确认")
})

test("a confirmed normal directory skips the gate on later launches", async () => {
  gateActive()
  process.env.DSH_CWD = "/tmp/risk-ws-confirmed"
  markWorkspaceConfirmed("/tmp/risk-ws-confirmed")
  const app = await testRender(() => <App client={stubClient} />, { width: 90, height: 34 })
  await new Promise((resolve) => setTimeout(resolve, 120))
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).not.toContain("目录确认")
  expect(frame).toContain("DeepSeek Harness CLI")
})

test("home directory warns on every launch even after confirmation", async () => {
  gateActive()
  process.env.DSH_CWD = homedir()
  markWorkspaceConfirmed(homedir())
  const app = await testRender(() => <App client={stubClient} />, { width: 90, height: 34 })
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("目录风险警告")
  expect(frame).toContain("SSH 密钥")
})
