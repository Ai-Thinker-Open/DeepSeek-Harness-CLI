/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import { Prompt } from "../src/components/prompt"
import type { CommandResultView } from "../src/commands"

type SpanLine = { spans: Array<{ text: string; bg: { buffer: Float32Array } }> }
type FrameLike = { captureSpans: () => { lines: SpanLine[] } }

const PRIMARY = { buffer: { "0": 0.3019607961177826, "1": 0.41960784792900085, "2": 0.9960784316062927, "3": 1 } }

function rowBg(app: FrameLike, label: string): string {
  for (const line of app.captureSpans().lines) {
    for (const span of line.spans) {
      if (span.text.includes(label)) {
        const b = span.bg.buffer
        return `${Math.round((b[0] ?? 0) * 255)},${Math.round((b[1] ?? 0) * 255)},${Math.round((b[2] ?? 0) * 255)}`
      }
    }
  }
  return "missing"
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

  expect(rowBg(app, "DeepSeek-V4")).toBe("77,107,254")
  expect(rowBg(app, "DeepSeek-V4-Flash")).toBe("30,30,30")

  app.mockInput.pressArrow("down")
  await app.renderOnce()
  expect(rowBg(app, "DeepSeek-V4")).toBe("30,30,30")
  expect(rowBg(app, "DeepSeek-V4-Flash")).toBe("77,107,254")

  app.mockInput.pressArrow("down")
  await app.renderOnce()
  expect(rowBg(app, "DeepSeek-V4")).toBe("77,107,254")
  expect(rowBg(app, "DeepSeek-V4-Flash")).toBe("30,30,30")
})
