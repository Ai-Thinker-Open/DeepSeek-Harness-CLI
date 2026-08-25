/**
 * Vendor Ai-Thinker runtime resources into `vendor/` so the published npm
 * package is self-contained:
 * - vendor/ai-thinker-src — the skills repo (its `skills/` dir holds the
 *   SKILL.md bundles the harness links into the skill root)
 * - vendor/flashkey-mcp   — the FlashKey MCP server Python source
 * - vendor/opentui-native — OpenTUI native libraries for every supported
 *   platform plus its runtime assets (parser worker, tree-sitter grammars and
 *   the web-tree-sitter wasm), so the terminal client runs anywhere regardless
 *   of the platform npm resolved at install time (see src/dsh/native-assets.ts)
 *
 * `prepack` runs this before `npm publish`/`npm pack`, and you can refresh the
 * copies manually with `bun run resources`. Requires network access to GitHub
 * at publish time only; the tarball (and therefore `npm install`) ships the
 * resources, so first launch works offline.
 */
import { $ } from "bun"
import { mkdirSync, readdirSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const vendor = join(root, "vendor")
const OPENTUI_VERSION = "0.5.6"

/** Retry flaky network steps (GitHub/npm are occasionally transient). */
async function runWithRetry(fn: () => Promise<unknown>, label: string, attempts = 3): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fn()
      return
    } catch (error) {
      if (attempt >= attempts) throw error
      console.warn(`retrying ${label} (attempt ${attempt}/${attempts}): ${error instanceof Error ? error.message : String(error)}`)
      await Bun.sleep(1500 * attempt)
    }
  }
}

/** Platform package -> native library file name, mirroring @opentui/core. */
const NATIVE_LIBS: Record<string, { file: string; packages: string[] }> = {
  linux: {
    file: "libopentui.so",
    packages: ["core-linux-x64", "core-linux-x64-musl", "core-linux-arm64", "core-linux-arm64-musl"],
  },
  win32: {
    file: "opentui.dll",
    packages: ["core-win32-x64", "core-win32-arm64"],
  },
  darwin: {
    file: "libopentui.dylib",
    packages: ["core-darwin-x64", "core-darwin-arm64"],
  },
}

const sources = [
  {
    dir: join(vendor, "ai-thinker-src"),
    url: process.env.AT_SKILLS_URL ?? "https://github.com/Ai-Thinker-Open/skills.git",
    keep: ["skills"],
  },
  {
    dir: join(vendor, "flashkey-mcp"),
    url: process.env.FLASHKEY_VENDOR_URL ?? "https://github.com/Ai-Thinker-Open/FlashKey_MCP-Server.git",
    keep: ["pyproject.toml", "src", "README.md", "README.zh.md", "LICENSE"],
  },
] satisfies Array<{ dir: string; url: string; keep: string[] }>

for (const { dir, url, keep } of sources) {
  await rm(dir, { recursive: true, force: true })
  await runWithRetry(() => $`git clone --depth 1 ${url} ${dir}`, `clone ${url}`)
  await rm(join(dir, ".git"), { recursive: true, force: true })
  const keepSet = new Set(keep)
  for (const entry of readdirSync(dir)) {
    if (!keepSet.has(entry)) {
      await rm(join(dir, entry), { recursive: true, force: true })
    }
  }
}

// OpenTUI native libraries, laid out as OTUI_ASSET_ROOT keys:
// @opentui/core-<platform>-<arch>[-musl]/<library file>.
const nativeRoot = join(vendor, "opentui-native")
const packTmp = join(root, ".vendor-tmp")
mkdirSync(packTmp, { recursive: true })
for (const [platform, { file, packages }] of Object.entries(NATIVE_LIBS)) {
  for (const pkg of packages) {
    const destDir = join(nativeRoot, "@opentui", pkg)
    await rm(destDir, { recursive: true, force: true })
    await mkdir(destDir, { recursive: true })
    const spec = `@opentui/${pkg}@${OPENTUI_VERSION}`
    await runWithRetry(() => $`npm pack ${spec} --pack-destination ${packTmp}`, `npm pack ${spec}`)
    const tgz = join(packTmp, `${pkg.replace("core-", "opentui-core-")}-${OPENTUI_VERSION}.tgz`)
    await $`tar -xzf ${tgz} -C ${packTmp} package/${file}`
    await $`mv ${join(packTmp, "package", file)} ${join(destDir, file)}`
    await rm(tgz, { force: true })
    await rm(join(packTmp, "package"), { recursive: true, force: true })
  }
}

// OpenTUI core runtime assets, laid out as OTUI_ASSET_ROOT keys so every
// asset the client resolves (`@opentui/core/parser.worker.js`,
// `@opentui/core/assets/...`, `web-tree-sitter/tree-sitter.wasm`) exists next
// to the native libraries. Without them the renderer fails with
// "Missing OpenTUI asset" as soon as a diff/code view spins up the parser.
const coreAssetDest = join(nativeRoot, "@opentui", "core")
await rm(coreAssetDest, { recursive: true, force: true })
await mkdir(coreAssetDest, { recursive: true })
const coreSpec = `@opentui/core@${OPENTUI_VERSION}`
await runWithRetry(() => $`npm pack ${coreSpec} --pack-destination ${packTmp}`, `npm pack ${coreSpec}`)
const coreTgz = join(packTmp, `opentui-core-${OPENTUI_VERSION}.tgz`)
await $`tar -xzf ${coreTgz} -C ${packTmp} package/parser.worker.js package/assets`
await $`mv ${join(packTmp, "package", "parser.worker.js")} ${join(coreAssetDest, "parser.worker.js")}`
await $`mv ${join(packTmp, "package", "assets")} ${join(coreAssetDest, "assets")}`
await rm(coreTgz, { force: true })
await rm(join(packTmp, "package"), { recursive: true, force: true })

const WEB_TREE_SITTER_VERSION = "0.25.10" // matches @opentui/core@0.5.6
const webTreeSitterDest = join(nativeRoot, "web-tree-sitter")
await mkdir(webTreeSitterDest, { recursive: true })
const webTsSpec = `web-tree-sitter@${WEB_TREE_SITTER_VERSION}`
await runWithRetry(() => $`npm pack ${webTsSpec} --pack-destination ${packTmp}`, `npm pack ${webTsSpec}`)
const webTsTgz = join(packTmp, `web-tree-sitter-${WEB_TREE_SITTER_VERSION}.tgz`)
await $`tar -xzf ${webTsTgz} -C ${packTmp} package/tree-sitter.wasm`
await $`mv ${join(packTmp, "package", "tree-sitter.wasm")} ${join(webTreeSitterDest, "tree-sitter.wasm")}`
await rm(webTsTgz, { force: true })
await rm(join(packTmp, "package"), { recursive: true, force: true })

await rm(packTmp, { recursive: true, force: true })

console.log(`vendored skills + flashkey-mcp + OpenTUI native libs & assets into ${vendor}`)
