import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"
import { bunCandidatePaths, resolveBun } from "../src/dsh/portable"

const savedHome = process.env.HOME
let tempRoot: string | undefined

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  delete process.env.OPENTUI_LIBC
})

function ovenBinaryPath(root: string): string {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch
  const binary = process.platform === "win32" ? "bun.exe" : "bun"
  return join(root, "node_modules", `@oven/bun-${process.platform}-${arch}`, "bin", binary)
}

test("resolveBun prefers the pinned @oven/bun platform package", () => {
  tempRoot = mkdtempSync(join(tmpdir(), "dsh-cli-bun-oven-"))
  const binary = ovenBinaryPath(tempRoot)
  mkdirSync(join(binary, ".."), { recursive: true })
  writeFileSync(binary, "")
  expect(resolveBun(tempRoot)).toBe(binary)
})

test("bun lookup order prefers @oven, then .bin, ~/.bun, and PATH", () => {
  tempRoot = mkdtempSync(join(tmpdir(), "dsh-cli-bun-fallback-"))
  const binary = process.platform === "win32" ? "bun.exe" : "bun"
  const shim = process.platform === "win32" ? "bun.cmd" : "bun"
  const ovenCandidates = [ovenBinaryPath(tempRoot)]
  if (process.platform === "linux" && process.arch === "x64") {
    ovenCandidates.push(join(tempRoot, "node_modules", "@oven/bun-linux-x64-musl", "bin", binary))
  }
  expect(bunCandidatePaths(tempRoot)).toEqual([
    ...ovenCandidates,
    join(tempRoot, "node_modules", ".bin", shim),
    join(homedir(), ".bun", "bin", binary),
    "bun",
  ])

  // With nothing installed, resolveBun returns the bare PATH lookup. Skip the
  // assertion when a real ~/.bun install exists on this machine.
  const homeBun = join(homedir(), ".bun", "bin", binary)
  if (!existsSync(homeBun)) expect(resolveBun(tempRoot)).toBe("bun")
})

test.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "resolveBun prefers the musl binary on musl systems",
  () => {
    tempRoot = mkdtempSync(join(tmpdir(), "dsh-cli-bun-musl-"))
    const binary = process.platform === "win32" ? "bun.exe" : "bun"
    const plain = join(tempRoot, "node_modules", "@oven/bun-linux-x64", "bin", binary)
    const musl = join(tempRoot, "node_modules", "@oven/bun-linux-x64-musl", "bin", binary)
    for (const file of [plain, musl]) {
      mkdirSync(join(file, ".."), { recursive: true })
      writeFileSync(file, "")
    }
    process.env.OPENTUI_LIBC = "musl"
    expect(resolveBun(tempRoot)).toBe(musl)
    delete process.env.OPENTUI_LIBC
    expect(resolveBun(tempRoot)).toBe(plain)
  },
)
