import { expect, test } from "bun:test"
import { SUBPROCESS_NOISE_RE, isUsableDraft } from "../src/components/prompt"

test("Git Bash subprocess errors are rejected as drafts", () => {
  expect(
    isUsableDraft(
      `ssh (37792) C:\\Program Files\\Git\\usr\\bin\\ssh.exe: *** fatal error - couldn't create signal pipe, Win...`,
    ),
  ).toBe(false)
  expect(SUBPROCESS_NOISE_RE.test(`ssh (22972) C:\\Program Files\\Git\\usr\\bin`)).toBe(true)
  expect(SUBPROCESS_NOISE_RE.test("*** fatal error - couldn't create signal pipe")).toBe(true)
})

test("ordinary drafts and control-sequence fragments behave as before", () => {
  expect(isUsableDraft("你好，帮我看看这个项目")).toBe(true)
  expect(isUsableDraft("")).toBe(true)
  expect(isUsableDraft("a\nb\tc")).toBe(true)
  expect(isUsableDraft("\u001b[200~garbage")).toBe(false)
  // A plain mention of "fatal error" is still a valid user draft.
  expect(isUsableDraft("请解释这个 fatal error")).toBe(true)
})
