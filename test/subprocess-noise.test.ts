import { expect, test } from "bun:test"
import { SUBPROCESS_NOISE_RE, stripSubprocessNoise } from "../src/subprocess-noise"

test("stripSubprocessNoise removes Git Bash ssh noise lines", () => {
  const text = [
    "clone 到本地…",
    "0 [main] ssh (44408) C:\\Program Files\\Git\\usr\\bin\\ssh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5",
    "已连接",
  ].join("\n")

  expect(
    stripSubprocessNoise(text),
  ).toBe(
    ["clone 到本地…", "已连接"].join("\n"),
  )
})

test("stripSubprocessNoise keeps ordinary multi-line text intact", () => {
  const text = "第一行\n第二行（fatal error 用词不影响）\n第三行"
  expect(stripSubprocessNoise(text)).toBe(text)
})

test("SUBPROCESS_NOISE_RE matches the Windows Git Bash banner", () => {
  expect(
    SUBPROCESS_NOISE_RE.test(
      `0 [main] ssh (37792) C:\\Program Files\\Git\\usr\\bin\\ssh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5`,
    ),
  ).toBe(true)
})
