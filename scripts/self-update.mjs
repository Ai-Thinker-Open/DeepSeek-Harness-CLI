#!/usr/bin/env node
/**
 * Detached self-updater: waits for the running TUI to exit, reinstalls the
 * package globally, then relaunches dsh-cli. Spawned by the update approval
 * flow so the new version takes effect without a manual install.
 *
 * Usage: node self-update.mjs <pkg@version> [bin]
 */
import { execFileSync, spawn } from "node:child_process"

const pkg = process.argv[2] ?? "@ai-thinker/deepseek-harness-cli@latest"
const bin = process.argv[3] ?? "dsh-cli"
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

// Let the TUI tear down and restore the terminal before touching files
// (Windows locks opentui.dll while the client is alive).
await new Promise((resolve) => setTimeout(resolve, 1200))

try {
  execFileSync(npm, ["install", "-g", pkg], { stdio: "inherit", shell: process.platform === "win32" })
} catch (error) {
  console.error(`[dsh-cli] update failed: ${error instanceof Error ? error.message : String(error)}`)
}

const child = spawn(bin, [], { stdio: "inherit", shell: process.platform === "win32", detached: true })
child.unref()
