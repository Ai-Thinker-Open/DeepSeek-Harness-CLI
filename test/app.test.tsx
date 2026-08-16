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
      // Primary blue (#4D6BFE) vs muted gray (#808080)
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
