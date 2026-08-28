/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { UpdateModal } from "../src/components/update-modal"

async function renderPhase(phase: "ask" | "running" | "done" | "failed", status = "") {
  let updated = 0
  let skipped = 0
  const app = await testRender(
    () => (
      <UpdateModal
        open={() => true}
        current="0.3.1"
        latest="0.3.2"
        phase={() => phase}
        status={() => status}
        onUpdate={() => updated++}
        onSkip={() => skipped++}
      />
    ),
    { width: 90, height: 34 },
  )
  await app.renderOnce()
  return { app, updated: () => updated, skipped: () => skipped }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

test("ask phase offers update and skip", async () => {
  const { app, updated, skipped } = await renderPhase("ask")
  const frame = app.captureCharFrame()
  expect(frame).toContain("发现新版本")
  expect(frame).toContain("立即更新（推荐）")
  expect(frame).toContain("暂不更新")

  app.mockInput.pressEnter()
  await settle()
  expect(updated()).toBe(1)
  expect(skipped()).toBe(0)

  const { app: again, skipped: skippedAgain } = await renderPhase("ask")
  again.mockInput.pressArrow("down")
  await settle()
  again.mockInput.pressEnter()
  await settle()
  expect(skippedAgain()).toBe(1)
})

test("running phase shows progress and ignores input", async () => {
  const { app, updated, skipped } = await renderPhase("running", "正在下载并安装到临时目录…")
  const frame = app.captureCharFrame()
  expect(frame).toContain("正在更新")
  expect(frame).toContain("正在下载并安装到临时目录…")
  expect(frame).not.toContain("暂不更新")

  app.mockInput.pressEnter()
  app.mockInput.pressEscape()
  await settle()
  expect(updated()).toBe(0)
  expect(skipped()).toBe(0)
})

test("done phase announces the automatic restart", async () => {
  const { app } = await renderPhase("done", "更新完成，正在重启…")
  const frame = app.captureCharFrame()
  expect(frame).toContain("更新完成")
  expect(frame).toContain("正在重启")
})

test("failed phase keeps the current version usable", async () => {
  const { app, skipped } = await renderPhase("failed", "下载/安装到临时目录失败")
  const frame = app.captureCharFrame()
  expect(frame).toContain("更新失败")
  expect(frame).toContain("下载/安装到临时目录失败")
  expect(frame).toContain("当前版本 v0.3.1 仍可正常使用")

  app.mockInput.pressEnter()
  await settle()
  expect(skipped()).toBe(1)
})
