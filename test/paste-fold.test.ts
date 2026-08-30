import { expect, test } from "bun:test"
import { buildPasteFoldInfo, shouldCollapsePaste } from "../src/paste-fold"

test("short and empty pastes never collapse", () => {
  expect(shouldCollapsePaste("")).toBe(false)
  expect(shouldCollapsePaste("你好，看看这个")).toBe(false)
  expect(shouldCollapsePaste("a\nb\nc\nd")).toBe(false)
})

test("five or more lines collapse", () => {
  expect(shouldCollapsePaste("a\nb\nc\nd\ne")).toBe(true)
  // A trailing newline counts its empty last line and still collapses.
  expect(shouldCollapsePaste("a\nb\nc\nd\ne\n")).toBe(true)
})

test("one thousand or more characters collapse (Unicode code points)", () => {
  expect(shouldCollapsePaste("x".repeat(999))).toBe(false)
  expect(shouldCollapsePaste("x".repeat(1000))).toBe(true)
  // CJK counts by code point, not UTF-16 units, like Codex's chars().count().
  expect(shouldCollapsePaste("汉".repeat(999))).toBe(false)
  expect(shouldCollapsePaste("汉".repeat(1000))).toBe(true)
})

test("buildPasteFoldInfo reports line and character counts", () => {
  const info = buildPasteFoldInfo("第一行\n第二行\n第三行")
  expect(info.lineCount).toBe(3)
  expect(info.charCount).toBe(11)
  expect(info.fullText).toBe("第一行\n第二行\n第三行")
  expect(info.preview).toBe("第一行")
})

test("preview truncates an over-long first line with an ellipsis", () => {
  const info = buildPasteFoldInfo(`${"a".repeat(60)}\n第二行`)
  expect(info.preview.length).toBeLessThan(60)
  expect(info.preview.endsWith("…")).toBe(true)
  expect(info.preview).toBe(`${"a".repeat(24)}…`)
})

test("preview counts CJK as two display columns", () => {
  const info = buildPasteFoldInfo(`${"汉".repeat(30)}\n第二行`)
  expect(info.preview).toBe(`${"汉".repeat(12)}…`)
})

test("preview falls back to a placeholder for an empty first line", () => {
  expect(buildPasteFoldInfo("\n第二行").preview).toBe("（空行）")
})
