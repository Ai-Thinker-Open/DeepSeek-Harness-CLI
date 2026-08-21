/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import { Prompt } from "../src/components/prompt"
import type { CommandResultView } from "../src/commands"

type SpanLine = { spans: Array<{ text: string; bg: { r: number; g: number; b: number } }> }
type FrameLike = { captureSpans: () => { lines: SpanLine[] } }

const PRIMARY = { buffer: { "0": 0.3019607961177826, "1": 0.41960784792900085, "2": 0.9960784316062927, "3": 1 } }

function rowBg(app: FrameLike, label: string): { r: number; g: number; b: number } {
  for (const line of app.captureSpans().lines) {
    for (const span of line.spans) {
      if (span.text.includes(label)) {
        return {
          r: Math.round(span.bg.r * 255),
          g: Math.round(span.bg.g * 255),
          b: Math.round(span.bg.b * 255),
        }
      }
    }
  }
  return { r: -1, g: -1, b: -1 }
}

function nearBg(color: { r: number; g: number; b: number }, r: number, g: number, b: number): boolean {
  return Math.abs(color.r - r) <= 3 && Math.abs(color.g - g) <= 3 && Math.abs(color.b - b) <= 3
}

test("model panel highlight follows arrow keys (Solid For untrack regression)", async () => {
  const [override, setOverride] = createSignal<CommandResultView | null>(null)
  const app = await testRender(
    () => (
      <Prompt
        resultOverride={override}
        commandItems={() => []}
        active={() => true}
      />
    ),
    { width: 80, height: 24 },
  )

  setOverride({
    title: "模型（点击行切换）",
    rows: [
      "当前模型：deepseek/deepseek-v4",
      "",
      "── DeepSeek ──",
      { text: "● DeepSeek-V4", onClick: () => {} },
      { text: "○ DeepSeek-V4-Flash", onClick: () => {} },
    ],
  })
  await app.renderOnce()

  expect(nearBg(rowBg(app, "DeepSeek-V4"), 77, 107, 254)).toBe(true)
  expect(nearBg(rowBg(app, "DeepSeek-V4-Flash"), 30, 30, 30)).toBe(true)

  app.mockInput.pressArrow("down")
  await app.renderOnce()
  expect(nearBg(rowBg(app, "DeepSeek-V4"), 30, 30, 30)).toBe(true)
  expect(nearBg(rowBg(app, "DeepSeek-V4-Flash"), 77, 107, 254)).toBe(true)

  app.mockInput.pressArrow("down")
  await app.renderOnce()
  expect(nearBg(rowBg(app, "DeepSeek-V4"), 77, 107, 254)).toBe(true)
  expect(nearBg(rowBg(app, "DeepSeek-V4-Flash"), 30, 30, 30)).toBe(true)
})
