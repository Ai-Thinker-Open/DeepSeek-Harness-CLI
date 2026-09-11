import { expect, test } from "bun:test"
import { modelSupportsImages } from "../src/harness/model"

test("recognizes the v4.1 flash model under every spelling dsh uses", () => {
  // dsh's catalog entry is id `deepseek-flash` / name `DeepSeek-V41-Flash` with
  // inputModalities ["text","image"] — the name carries no `vision` marker.
  expect(modelSupportsImages("deepseek-flash")).toBe(true)
  expect(modelSupportsImages("DeepSeek-V41-Flash")).toBe(true)
  expect(modelSupportsImages("deepseek-v4.1-flash")).toBe(true)
})

test("keeps the text-only DeepSeek models text-only", () => {
  expect(modelSupportsImages("deepseek-v4-flash")).toBe(false)
  expect(modelSupportsImages("DeepSeek-V4-Flash")).toBe(false)
  expect(modelSupportsImages("deepseek-v4-pro")).toBe(false)
  expect(modelSupportsImages("DeepSeek-V4-Pro")).toBe(false)
})

test("recognizes the vision-suffixed model", () => {
  expect(modelSupportsImages("deepseek-v4-flash-vision-exp")).toBe(true)
  expect(modelSupportsImages("DeepSeek-V4-Flash-Vision-Exp")).toBe(true)
})

test("falls back to the generic vision keywords", () => {
  expect(modelSupportsImages("qwen2.5-vl-7b")).toBe(true)
  expect(modelSupportsImages("llava-multimodal")).toBe(true)
  expect(modelSupportsImages("gemini-omni")).toBe(true)
  expect(modelSupportsImages("gpt-4o")).toBe(false)
})

test("tolerates a provider prefix", () => {
  expect(modelSupportsImages("deepseek-official/deepseek-flash")).toBe(true)
  expect(modelSupportsImages("deepseek/deepseek-v4-flash")).toBe(false)
})

test("treats unknown or absent models as text-only", () => {
  expect(modelSupportsImages(undefined)).toBe(false)
  expect(modelSupportsImages("")).toBe(false)
  expect(modelSupportsImages("   ")).toBe(false)
  expect(modelSupportsImages("some-new-model")).toBe(false)
})
