/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/app"

type SpanLike = { text: string; fg: { r: number; g: number; b: number } }
type FrameLike = { captureSpans: () => { lines: Array<{ spans: SpanLike[] }> } }

function highlightedMode(app: FrameLike): string | null {
  const labels = ["Read only", "Workspace write", "Full access"]
  for (const line of app.captureSpans().lines) {
    for (const span of line.spans) {
      const label = labels.find((item) => span.text.includes(item))
      // The prompt footer renders the current mode label in primary blue (#4D6BFE)
      if (label && span.fg.b > 0.8 && span.fg.g < 0.6) return label
    }
  }
  return null
}

test("tab cycles permission mode and highlights the current one", async () => {
  const app = await testRender(() => <App />, { width: 80, height: 32 })
  await app.renderOnce()

  expect(highlightedMode(app)).toBe("Workspace write")

  app.mockInput.pressTab()
  await app.renderOnce()
  expect(highlightedMode(app)).toBe("Full access")

  app.mockInput.pressTab()
  await app.renderOnce()
  expect(highlightedMode(app)).toBe("Read only")

  app.mockInput.pressTab()
  await app.renderOnce()
  expect(highlightedMode(app)).toBe("Workspace write")

  app.mockInput.pressTab({ shift: true })
  await app.renderOnce()
  expect(highlightedMode(app)).toBe("Read only")
})

test("selecting text copies it and shows a toast", async () => {
  const app = await testRender(() => <App />, { width: 80, height: 32 })
  await app.renderOnce()

  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("tab 切换权限"))
  const x = lines[y]?.indexOf("tab 切换权限") ?? 0

  await app.mockMouse.drag(x, y, x + 12, y)
  await app.renderOnce()

  expect(app.captureCharFrame()).toContain("复制")
})

test("submitting on the home prompt opens the session", async () => {
  const app = await testRender(() => <App />, { width: 80, height: 32 })
  await app.renderOnce()

  app.mockInput.typeText("hello")
  await app.renderOnce()
  app.mockInput.pressEnter()
  await app.renderOnce()

  const frame = app.captureCharFrame()
  expect(frame).toContain("esc 返回")
  expect(frame).toContain("hello")
  expect(frame).toContain("发送消息开始对话")
  expect(frame).toContain("30 轮")

  app.mockInput.typeText("world")
  await app.renderOnce()
  app.mockInput.pressEnter()
  await app.renderOnce()

  const sessionFrame = app.captureCharFrame()
  expect(sessionFrame).toContain("world")
})
