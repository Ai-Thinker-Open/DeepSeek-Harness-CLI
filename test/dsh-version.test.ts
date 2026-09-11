import { expect, test } from "bun:test"
import {
  MIN_DSH_VERSION,
  compareDshVersions,
  dshVersionProblemFor,
  parseDshVersion,
} from "../src/dsh/dsh-version"

test("accepts the minimum supported dsh and newer", () => {
  expect(dshVersionProblemFor(MIN_DSH_VERSION)).toBeNull()
  expect(dshVersionProblemFor("0.1.5")).toBeNull()
  expect(dshVersionProblemFor("0.1.6-rc.1")).toBeNull()
  expect(dshVersionProblemFor("0.2.0")).toBeNull()
})

test("rejects the pre-0.1.5 dsh whose closure cannot resolve this bundle's rows", () => {
  const problem = dshVersionProblemFor("0.1.2-rc.1")
  expect(problem).toContain("0.1.2-rc.1")
  expect(problem).toContain(MIN_DSH_VERSION)
  expect(problem).toContain("npm i -g @deepseek-ai/dsh@")
})

test("tolerates unknown or unparseable versions instead of blocking boot", () => {
  expect(dshVersionProblemFor(undefined)).toBeNull()
  expect(dshVersionProblemFor("")).toBeNull()
  expect(dshVersionProblemFor("   ")).toBeNull()
  expect(dshVersionProblemFor("not-a-version")).toBeNull()
})

test("ranks a release above its prereleases", () => {
  expect(compareDshVersions("0.1.5", "0.1.5-rc.1")).toBe(1)
  expect(compareDshVersions("0.1.5-rc.1", "0.1.5")).toBe(-1)
})

test("orders prerelease identifiers by SemVer precedence", () => {
  expect(compareDshVersions("0.1.5-rc.2", "0.1.5-rc.1")).toBe(1)
  expect(compareDshVersions("0.1.5-rc.10", "0.1.5-rc.9")).toBe(1)
  // Numeric identifiers rank below alphanumeric ones.
  expect(compareDshVersions("0.1.5-rc.1", "0.1.5-rc.alpha")).toBe(-1)
  // A shorter set ranks lower when every shared identifier matches.
  expect(compareDshVersions("0.1.5-alpha", "0.1.5-alpha.1")).toBe(-1)
})

test("orders by major/minor/patch before prerelease", () => {
  expect(compareDshVersions("0.1.2-rc.1", "0.1.5-rc.1")).toBe(-1)
  expect(compareDshVersions("0.2.0", "0.1.9")).toBe(1)
  expect(compareDshVersions("1.0.0", "0.9.9")).toBe(1)
})

test("treats equal versions and unparseable input as equal", () => {
  expect(compareDshVersions("0.1.5-rc.1", "0.1.5-rc.1")).toBe(0)
  expect(compareDshVersions("0.1.5+build.7", "0.1.5")).toBe(0)
  expect(compareDshVersions("weird", "0.1.5-rc.1")).toBe(0)
})

test("extracts the version from dsh --version output", () => {
  expect(parseDshVersion("0.1.5-rc.1\n")).toBe("0.1.5-rc.1")
  expect(parseDshVersion("dsh 0.1.2-rc.1")).toBe("0.1.2-rc.1")
  expect(parseDshVersion("  0.1.5  ")).toBe("0.1.5")
  expect(parseDshVersion(undefined)).toBeUndefined()
  expect(parseDshVersion("no version here")).toBeUndefined()
})
