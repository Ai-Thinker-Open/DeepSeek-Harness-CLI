/**
 * Vendor Ai-Thinker runtime resources into `vendor/` so the published npm
 * package is self-contained:
 * - vendor/ai-thinker-src — the skills repo (its `skills/` dir holds the
 *   SKILL.md bundles the harness links into the skill root)
 * - vendor/flashkey-mcp   — the FlashKey MCP server Python source
 *
 * `prepack` runs this before `npm publish`/`npm pack`, and you can refresh the
 * copies manually with `bun run resources`. Requires network access to GitHub
 * at publish time only; the tarball (and therefore `npm install`) ships the
 * resources, so first launch works offline.
 */
import { $ } from "bun"
import { readdirSync } from "node:fs"
import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const vendor = join(root, "vendor")

const sources: Array<{ dir: string; url: string }> = [
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
  await $`git clone --depth 1 ${url} ${dir}`
  await rm(join(dir, ".git"), { recursive: true, force: true })
  const keepSet = new Set(keep)
  for (const entry of readdirSync(dir)) {
    if (!keepSet.has(entry)) {
      await rm(join(dir, entry), { recursive: true, force: true })
    }
  }
}

console.log(`vendored skills + flashkey-mcp into ${vendor}`)
