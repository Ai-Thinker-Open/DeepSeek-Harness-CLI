#!/usr/bin/env node
/**
 * Global-install postinstall: make `dsh-cli` usable out of the box by
 * ensuring the DeepSeek Harness (`dsh`) and `pnpm` (which the harness uses to
 * build profiles) are available, installing them globally when missing.
 *
 * Only runs for global installs (`npm_config_global=true`), so dependency /
 * workspace / CI installs are untouched. Both checks are best-effort:
 * failures print a hint and never fail the install.
 */
import { spawnSync } from "node:child_process"

if (process.env.npm_config_global !== "true") process.exit(0)

const IS_WIN32 = process.platform === "win32"

function hasCommand(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    ...(IS_WIN32 ? { shell: true } : {}),
  })
  return result.status === 0
}

function installGlobal(pkg) {
  const result = spawnSync("npm", ["install", "-g", pkg], {
    stdio: ["ignore", "inherit", "pipe"],
    ...(IS_WIN32 ? { shell: true } : {}),
  })
  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : ""
    console.error(`[dsh-cli] could not auto-install ${pkg}${detail}.`)
    if (result.stderr && typeof result.stderr === "string" && result.stderr.trim()) {
      console.error(result.stderr.trim())
    }
    console.error(`[dsh-cli] run "npm install -g ${pkg}" manually to see the full error.`)
    return false
  }
  return true
}

if (!hasCommand("dsh")) {
  console.log("[dsh-cli] DeepSeek Harness not found; installing @deepseek-ai/dsh…")
  installGlobal("@deepseek-ai/dsh")
}

if (!hasCommand("pnpm")) {
  console.log("[dsh-cli] pnpm not found; the harness needs it to build profiles; installing pnpm…")
  installGlobal("pnpm")
}
