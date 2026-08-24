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
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

if (process.env.npm_config_global !== "true") process.exit(0)

const IS_WIN32 = process.platform === "win32"

const PKG_ROOT = process.cwd()
const PKG_NAME = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).name

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

/**
 * Create the tui profile at install time so the first `dsh-cli` run boots
 * straight away. Idempotent: skips when the bundle is already registered.
 * Best-effort: a failure only prints a hint (the runtime fallback retries).
 */
function ensureTuiProfile() {
  if (!hasCommand("dsh")) return
  const home = process.env.DSH_HOME || join(homedir(), ".dsh")
  const manifestPath = join(home, "profiles", "tui", "package.json")
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    if ((manifest.dsh?.profile?.bundles ?? []).includes(PKG_NAME)) return
  } catch {
    // Profile not created yet — set it up below.
  }
  console.log("[dsh-cli] configuring the tui profile (first run will be fast)…")
  const spec = pathToFileURL(PKG_ROOT).href
  const result = spawnSync("dsh", ["plugin", "--profile", "tui", "add", spec], {
    stdio: ["ignore", "inherit", "pipe"],
    ...(IS_WIN32 ? { shell: true } : {}),
  })
  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : ""
    console.error(`[dsh-cli] could not configure the tui profile during install${detail}.`)
    if (result.stderr && typeof result.stderr === "string" && result.stderr.trim()) {
      console.error(result.stderr.trim())
    }
    console.error("[dsh-cli] dsh-cli will retry this automatically on first run.")
  } else {
    console.log("[dsh-cli] tui profile ready.")
  }
}

if (!hasCommand("dsh")) {
  console.log("[dsh-cli] DeepSeek Harness not found; installing @deepseek-ai/dsh…")
  installGlobal("@deepseek-ai/dsh")
}

if (!hasCommand("pnpm")) {
  console.log("[dsh-cli] pnpm not found; the harness needs it to build profiles; installing pnpm…")
  installGlobal("pnpm")
}

if (!hasCommand("bun")) {
  console.log("[dsh-cli] bun not found; installing bun (terminal client runtime)…")
  installGlobal("bun")
}

ensureTuiProfile()
