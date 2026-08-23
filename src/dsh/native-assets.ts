/**
 * Cross-platform OpenTUI native library resolution.
 *
 * `@opentui/core` normally resolves its platform-specific native package
 * (`@opentui/core-<platform>-<arch>`) from node_modules — which depends on the
 * platform npm resolved at install time. A package installed on Windows then
 * run from WSL/Linux (or vice versa) is missing the other platform's library.
 *
 * The published dsh-cli ships the native libraries for every supported
 * platform under `vendor/opentui-native`, and points `@opentui/core` at them
 * via `OTUI_ASSET_ROOT`, so the terminal client runs on any platform
 * regardless of where the package was installed.
 */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const NATIVE_FILE_NAMES: Record<string, string> = {
  linux: "libopentui.so",
  darwin: "libopentui.dylib",
  win32: "opentui.dll",
}

function packageRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error("dsh-cli: unable to locate package root")
    dir = parent
  }
}

/**
 * Absolute `OTUI_ASSET_ROOT` for the current platform when the bundled native
 * library is shipped, otherwise `undefined` (fall back to the npm-installed
 * platform package).
 *
 * The asset key mirrors `@opentui/core`'s native descriptor:
 * `@opentui/core-<platform>-<arch>[-musl]/<library file>`.
 */
export function bundledOpentuiAssetRoot(): string | undefined {
  const file = NATIVE_FILE_NAMES[process.platform]
  if (!file) return undefined
  const libc = process.platform === "linux" && process.env.OPENTUI_LIBC === "musl" ? "-musl" : ""
  const key = `@opentui/core-${process.platform}-${process.arch}${libc}/${file}`
  const root = join(packageRoot(dirname(fileURLToPath(import.meta.url))), "vendor", "opentui-native")
  return existsSync(join(root, key)) ? root : undefined
}

/** Point `OTUI_ASSET_ROOT` at the bundled native library for the current platform, if shipped. */
export function applyBundledOpentuiAssets(): void {
  const root = bundledOpentuiAssetRoot()
  if (root) process.env.OTUI_ASSET_ROOT = root
}
