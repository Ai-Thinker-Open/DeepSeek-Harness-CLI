import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { effectiveWorkspace, isHighRiskDirectory, markWorkspaceConfirmed, workspaceConfirmed } from "../src/directory-risk"

test("home directory is high risk", () => {
  expect(isHighRiskDirectory("/home/seahi", "/home/seahi")).toBe(true)
})

test("filesystem root is high risk", () => {
  expect(isHighRiskDirectory("/", "/home/seahi")).toBe(true)
})

test("windows drive root is high risk", () => {
  expect(isHighRiskDirectory("C:\\", "/home/seahi")).toBe(true)
  expect(isHighRiskDirectory("C:/", "/home/seahi")).toBe(true)
})

test("ordinary workspace directories are not high risk", () => {
  expect(isHighRiskDirectory("/home/seahi/proj", "/home/seahi")).toBe(false)
  expect(isHighRiskDirectory("/home/seahi/Desktop", "/home/seahi")).toBe(false)
  expect(isHighRiskDirectory("/tmp/ws", "/home/seahi")).toBe(false)
})

test("effectiveWorkspace prefers DSH_CWD over the process cwd", () => {
  const previous = process.env.DSH_CWD
  try {
    process.env.DSH_CWD = "/tmp/risk-ws"
    expect(effectiveWorkspace()).toBe("/tmp/risk-ws")
    delete process.env.DSH_CWD
    expect(effectiveWorkspace()).toBe(process.cwd())
  } finally {
    if (previous === undefined) delete process.env.DSH_CWD
    else process.env.DSH_CWD = previous
  }
})

let riskHome: string | undefined
const previousHome = process.env.DSH_HOME

beforeAll(() => {
  riskHome = mkdtempSync(join(tmpdir(), "dsh-risk-"))
  process.env.DSH_HOME = riskHome
})

afterAll(() => {
  if (riskHome) rmSync(riskHome, { recursive: true, force: true })
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

test("workspaceConfirmed starts false and markWorkspaceConfirmed records it", () => {
  expect(workspaceConfirmed("/tmp/proj-a")).toBe(false)
  markWorkspaceConfirmed("/tmp/proj-a")
  expect(workspaceConfirmed("/tmp/proj-a")).toBe(true)
  expect(workspaceConfirmed("/tmp/proj-b")).toBe(false)
  // Idempotent: marking twice keeps a single entry.
  markWorkspaceConfirmed("/tmp/proj-a")
  expect(workspaceConfirmed("/tmp/proj-a")).toBe(true)
})

test("high-risk directories are never persisted", () => {
  markWorkspaceConfirmed("/home/seahi")
  expect(workspaceConfirmed("/home/seahi")).toBe(false)
})
