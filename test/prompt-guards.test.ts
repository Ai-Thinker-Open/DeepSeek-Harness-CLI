import { expect, test } from "bun:test"
import { SUBPROCESS_NOISE_RE, isUsableDraft, recallSourceNotice } from "../src/components/prompt"

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

test("recallSourceNotice warns only for cross-session recalls", () => {
  // Same session → no warning.
  expect(recallSourceNotice("s-abc123", "s-abc123")).toBeNull()
  // No session recorded (legacy / home-screen sends) → no warning.
  expect(recallSourceNotice(null, "s-abc123")).toBeNull()
  expect(recallSourceNotice("s-abc123", null)).toBeNull()
  // Cross-session → warns and shortens the origin id.
  const notice = recallSourceNotice("s-12345678-0000", "s-99999999-0000")
  expect(notice).toContain("召回")
  expect(notice).toContain("12345678")
  expect(notice).not.toContain("99999999")
})
