import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { load as parseYaml } from "js-yaml"

const root = join(import.meta.dir, "..")

interface PatchEntry {
  id?: string
  name?: string
  disabled?: boolean
  inject?: string[]
  config?: Record<string, unknown>
  insert?: PatchEntry[]
}

// The loader's YAML schema evaluates `!!js` expressions itself; the test only
// inspects patch structure, so strip the custom tag before parsing.
const patch = parseYaml(
  readFileSync(join(root, "cordis.patch.yml"), "utf8").replace(/!!js\s+/g, ""),
) as unknown as PatchEntry[]

function rows(): PatchEntry[] {
  const out: PatchEntry[] = []
  for (const entry of patch) {
    if (entry.id) out.push(entry)
    if (Array.isArray(entry.insert)) out.push(...entry.insert)
  }
  return out
}

test("bundle patch declares the terminal surface over dsh-base", () => {
  const byId = new Map(rows().map((r) => [r.id, r]))
  for (const id of ["code-runtime", "tui-startup", "api-gateway", "webserver", "connection", "tui-runner"]) {
    expect(byId.get(id), `missing row ${id}`).toBeDefined()
  }
  expect(byId.get("tui-startup")?.name).toBe("@ai-thinker/deepseek-harness-cli/startup")
  expect(byId.get("tui-runner")?.name).toBe("@ai-thinker/deepseek-harness-cli")
  expect(byId.get("webserver")?.inject).toContain("tuiStartup")
  expect(byId.get("tui-runner")?.inject).toEqual(["tuiStartup", "webServer"])
  expect(byId.get("hmr")?.disabled).toBe(true)
  expect(String(byId.get("system-prompt")?.config?.persona)).toContain("{{model}}")
})

test("patch declares the standard host services a full surface composes", () => {
  const byId = new Map(rows().map((r) => [r.id, r]))
  const expected: Array<[string, string]> = [
    ["session-reference", "@deepseek-ai/dsh-session-reference"],
    ["file-reference-local", "@deepseek-ai/dsh-file-reference-local"],
    ["session-stats", "@deepseek-ai/dsh-session-stats"],
    ["message-feedback", "@deepseek-ai/dsh-message-feedback"],
    ["session-projection-cache", "@deepseek-ai/dsh-session-projection-cache"],
    ["plugin-inventory", "@deepseek-ai/dsh-host-plugin-inventory"],
    ["cordis-host-runner", "@deepseek-ai/dsh-cordis-host-runner"],
  ]
  for (const [id, pkg] of expected) {
    expect(byId.get(id)?.name, `missing host row ${id}`).toBe(pkg)
  }
})

test("bundle manifest resolves the patch and exports", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dsh?: { bundle?: { patch?: string } }
    exports?: Record<string, string>
    scripts?: Record<string, string>
    files?: string[]
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  expect(manifest.dsh?.bundle?.patch).toBe("./cordis.patch.yml")
  expect(manifest.exports?.["."]).toBe("./dist/runner.js")
  expect(manifest.exports?.["./startup"]).toBe("./dist/startup.js")
})

test("manifest declares standard npm dependencies and no install-time mutation", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version?: string
    scripts?: Record<string, string>
    files?: string[]
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  expect(manifest.version).toBe("0.3.7")
  expect(manifest.scripts?.postinstall).toBeUndefined()
  expect(manifest.files ?? []).not.toContain("scripts/ensure-runtime.mjs")
  expect(manifest.dependencies?.["@opentui/core"]).toBe("0.5.9")
  expect(manifest.dependencies?.["@opentui/solid"]).toBe("0.5.9")
  expect(manifest.dependencies?.["solid-js"]).toBe("1.9.12")
  expect(manifest.dependencies?.["@deepseek-ai/schemastery"]).toBe("3.18.1")
  expect(manifest.optionalDependencies?.["@oven/bun-windows-x64"]).toBe("1.3.14")
  expect(manifest.optionalDependencies?.["@oven/bun-linux-x64-musl"]).toBe("1.3.14")
})
