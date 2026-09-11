import { readFileSync } from "node:fs"
import { join } from "node:path"
import { load as parseYaml } from "js-yaml"
import { expect, test } from "bun:test"
import { normalizeProfilePatch, parseComposedLayerIds, removeListItemById, stripFlashKeyMcp } from "../src/dsh/dispatcher"

test("parseComposedLayerIds reports a duplicate id across layers", () => {
  const dump = `# == @deepseek-ai/dsh-base
- id: storage
  name: '@deepseek-ai/dsh-storage'
  config:
    servers:
      - id: not-a-loader-entry
        url: http://x
# == @ai-thinker/deepseek-harness-cli
- id: storage
  name: '@deepseek-ai/dsh-storage'
- id: tui-runner
  name: '@ai-thinker/deepseek-harness-cli'
# == /tmp/x/profiles/tui/cordis.patch.yml
- id: storage
  name: '@deepseek-ai/dsh-storage'
`
  const rows = parseComposedLayerIds(dump)
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.id] = (counts[row.id] ?? 0) + 1
  expect(counts.storage).toBe(3)
  expect(counts["tui-runner"]).toBe(1)
  expect(counts["not-a-loader-entry"]).toBeUndefined()
  // First occurrence (the layer that wins) is the base.
  expect(rows[0]?.layer).toBe("@deepseek-ai/dsh-base")
})

test("removeListItemById drops a nested insert row and keeps siblings", () => {
  const text = `- insert:
    - id: code-runtime
      name: '@deepseek-ai/dsh-code-runtime-worker-thread'

    - id: storage
      name: '@deepseek-ai/dsh-storage'

    - id: storage-json
      name: '@deepseek-ai/dsh-storage-json'
      config:
        root: !!js dshHomePath('storages')

- id: system-prompt
  config:
    persona: hi
`
  const { text: out, removed } = removeListItemById(text, "storage")
  expect(removed).toBe(true)
  expect(/^\s*- id: storage\s*$/m.test(out)).toBe(false)
  expect(/^\s*- id: storage-json\s*$/m.test(out)).toBe(true)
  expect(/^\s*- id: code-runtime\s*$/m.test(out)).toBe(true)
  expect(/^\s*- id: system-prompt\s*$/m.test(out)).toBe(true)
  expect(out).toContain("!!js dshHomePath('storages')")
  // The surrounding list is still valid YAML once the !!js tag is stripped.
  expect(() => parseYaml(out.replace(/!!js\s+/g, ""))).not.toThrow()
})

test("removeListItemById never removes an id that is absent", () => {
  const text = `- insert:
    - id: storage
      name: '@deepseek-ai/dsh-storage'
`
  const { text: out, removed } = removeListItemById(text, "workspace")
  expect(removed).toBe(false)
  expect(out).toBe(text)
})

test("the shipped bundle patch can shed a host row and stay valid YAML", () => {
  const root = join(import.meta.dir, "..")
  const patch = readFileSync(join(root, "cordis.patch.yml"), "utf8")
  const { text: out, removed } = removeListItemById(patch, "workspace")
  expect(removed).toBe(true)
  expect(/^\s*- id: workspace\s*$/m.test(out)).toBe(false)
  expect(/^\s*- id: webserver\s*$/m.test(out)).toBe(true)
  expect(() => parseYaml(out.replace(/!!js\s+/g, ""))).not.toThrow()
})

test("the shipped bundle patch defers base-provided rows to dsh-base", () => {
  const root = join(import.meta.dir, "..")
  const patch = readFileSync(join(root, "cordis.patch.yml"), "utf8")
  for (const id of ["storage", "storage-json", "storage-domain", "session-projection-cache", "api-gateway", "dsh-host-apiproxy"]) {
    const re = new RegExp(`^(\\s*)- id:\\s*${id}\\s*$`, "m")
    expect(re.test(patch), `bundle must not declare base-provided/removed row ${id}`).toBe(false)
  }
})

test("detects a storage duplicate between a newer dsh-base and the bundle", () => {
  // Mirrors a newer dsh whose base composes storage (so the bundle's insert
  // collides); the profile patch itself contributes nothing.
  const dump = `# == @deepseek-ai/dsh-base
- id: storage
  name: '@deepseek-ai/dsh-storage'
# == @ai-thinker/deepseek-harness-cli
- id: storage
  name: '@deepseek-ai/dsh-storage'
# == D:\\Users\\Seahi\\.dsh\\profiles\\tui\\cordis.patch.yml
- id: mcp-flashkey
  name: '@deepseek-ai/dsh-mcp-client'
`
  const rows = parseComposedLayerIds(dump)
  const storageRows = rows.filter((r) => r.id === "storage")
  expect(storageRows).toHaveLength(2)
  expect(storageRows.map((r) => r.layer)).toEqual(["@deepseek-ai/dsh-base", "@ai-thinker/deepseek-harness-cli"])
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.id] = (counts[r.id] ?? 0) + 1
  expect(counts.storage).toBe(2)
  expect(counts["mcp-flashkey"]).toBe(1)
})

test("stripFlashKeyMcp removes the row and the orphaned empty - insert:", () => {
  const patch = `# profile patch
- insert:
    - id: mcp-flashkey
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: flashkey
        url: http://127.0.0.1:8100/sse
`
  const out = stripFlashKeyMcp(patch)
  expect(out.includes("mcp-flashkey")).toBe(false)
  // The now-empty `- insert:` is dropped too, leaving only the comment.
  expect(out).not.toContain("- insert:")
  expect(out.trim()).toBe("# profile patch")
  // When the mcp-flashkey row sits in an insert that also has other rows, the
  // siblings stay and the parent insert is kept (covered by the next test).
})

test("stripFlashKeyMcp keeps other rows and is a no-op when absent", () => {
  const patch = `- insert:
    - id: mcp-flashkey
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: flashkey
    - id: other-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: mine
`
  const out = stripFlashKeyMcp(patch)
  expect(out.includes("mcp-flashkey")).toBe(false)
  expect(out).toContain("serverName: mine")
  expect(out).toContain("- insert:")

  const without = `- id: tui-runner\n  name: '@ai-thinker/deepseek-harness-cli'\n`
  expect(stripFlashKeyMcp(without)).toBe(without)
})

test("normalizeProfilePatch keeps a comments-only patch a valid top-level array", () => {
  // Reproduces the regression: stripping the only row would leave comments only,
  // which parses to null and aborts profile boot
  // ("must be a top-level YAML array of loader patch entries").
  const patch = `# profile patch
- insert:
    - id: mcp-flashkey
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: flashkey
        url: http://127.0.0.1:8100/sse
`
  const out = normalizeProfilePatch(patch)
  expect(out.includes("mcp-flashkey")).toBe(false)
  expect(Array.isArray(parseYaml(out))).toBe(true)

  // An already-broken (comments-only / empty) patch is repaired too.
  const broken = "# just a comment\n"
  const fixed = normalizeProfilePatch(broken)
  expect(Array.isArray(parseYaml(fixed))).toBe(true)

  const empty = normalizeProfilePatch("")
  expect(Array.isArray(parseYaml(empty))).toBe(true)
})

test("normalizeProfilePatch leaves a patch with real rows untouched", () => {
  const patch = `- id: tui-runner\n  name: '@ai-thinker/deepseek-harness-cli'\n`
  expect(normalizeProfilePatch(patch)).toBe(patch)
})
