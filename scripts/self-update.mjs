#!/usr/bin/env node
/**
 * In-place self-updater driven by the TUI. While the TUI stays alive it
 * stages the new package into a temporary prefix and reports progress through
 * the status file in `DSH_UPDATE_STATUS` (`{ stage, message }`). Once staged,
 * it writes `stage: done`, then waits for the TUI to release the renderer
 * (the TUI writes a `<status>.exit` marker right before exiting, because
 * Windows locks opentui.dll while the renderer is alive), performs the real
 * global install, and relaunches dsh-cli in the same terminal — no new
 * console window.
 *
 * Usage: node self-update.mjs <pkg@version> [bin]
 */
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const pkg = process.argv[2] ?? "@ai-thinker/deepseek-harness-cli@latest"
const bin = process.argv[3] ?? "dsh-cli"
const statusPath = process.env.DSH_UPDATE_STATUS
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const shell = process.platform === "win32"
const requestedVersion = pkg.includes("@") && !pkg.startsWith("@") ? pkg.split("@").pop() : pkg

function writeStatus(stage, message) {
  if (!statusPath) return
  try {
    writeFileSync(statusPath, JSON.stringify({ stage, message }))
  } catch {
    // Progress reporting is best-effort; the install continues regardless.
  }
}

function fail(message) {
  writeStatus("failed", message)
  process.exit(1)
}

const staging = mkdtempSync(join(tmpdir(), "dsh-cli-update-"))
try {
  writeStatus("installing", "正在下载并安装到临时目录…")
  const staged = spawnSync(npm, ["install", "-g", "--prefix", staging, pkg], {
    stdio: "ignore",
    shell,
  })
  if (staged.status !== 0) {
    fail(`下载/安装到临时目录失败（npm 退出码 ${staged.status ?? "?"}），已取消更新`)
  }

  writeStatus("verifying", "正在校验更新包…")
  const stagedManifest = join(staging, "node_modules", "@ai-thinker", "deepseek-harness-cli", "package.json")
  if (!existsSync(stagedManifest)) fail("临时目录中未找到更新包，已取消更新")
  if (requestedVersion && requestedVersion !== "latest") {
    const installed = JSON.parse(readFileSync(stagedManifest, "utf8")).version
    if (installed !== requestedVersion) fail(`临时目录中的版本是 ${installed}，期望 ${requestedVersion}`)
  }

  writeStatus("done", "更新完成，正在重启…")

  // The TUI writes `<status>.exit` just before tearing the renderer down, so
  // the native library is released before npm replaces files. Fall back to a
  // fixed wait when running without a TUI (no status file / marker).
  if (statusPath) {
    const marker = `${statusPath}.exit`
    const deadline = Date.now() + 30_000
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  } else {
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  execFileSync(npm, ["install", "-g", pkg], { stdio: "inherit", shell })
  const child = spawn(bin, [], { stdio: "inherit", shell })
  child.unref()
} catch (error) {
  fail(`更新失败：${error instanceof Error ? error.message : String(error)}`)
} finally {
  rmSync(staging, { recursive: true, force: true })
  if (statusPath) {
    try {
      rmSync(`${statusPath}.exit`, { force: true })
      rmSync(statusPath, { force: true })
    } catch {
      // Best-effort temp cleanup.
    }
  }
}
