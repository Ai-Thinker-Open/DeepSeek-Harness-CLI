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

function hasCommand(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0
}

function installGlobal(pkg) {
  const result = spawnSync("npm", ["install", "-g", pkg], { stdio: "inherit" })
  if (result.status !== 0) {
    console.error(`[dsh-cli] could not auto-install ${pkg}; run "npm install -g ${pkg}" manually.`)
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
