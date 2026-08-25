/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { testRender } from "@opentui/solid"

// The published client resolves every OpenTUI runtime asset through
// OTUI_ASSET_ROOT (see src/dsh/native-assets.ts). The parser worker,
// tree-sitter grammars and web-tree-sitter wasm must therefore be vendored
// next to the native libraries, or diff/code views fail with
// "Missing OpenTUI asset @opentui/core/parser.worker.js".
const vendorRoot = join(import.meta.dir, "..", "vendor", "opentui-native")
process.env.OTUI_ASSET_ROOT = vendorRoot

test("vendored OpenTUI assets resolve under OTUI_ASSET_ROOT", async () => {
  const requiredKeys = [
    "@opentui/core/parser.worker.js",
    "@opentui/core/assets/javascript/highlights.scm",
    "@opentui/core/assets/javascript/tree-sitter-javascript.wasm",
    "@opentui/core/assets/typescript/highlights.scm",
    "@opentui/core/assets/typescript/tree-sitter-typescript.wasm",
    "@opentui/core/assets/markdown/highlights.scm",
    "@opentui/core/assets/markdown/injections.scm",
    "@opentui/core/assets/markdown/tree-sitter-markdown.wasm",
    "@opentui/core/assets/markdown_inline/highlights.scm",
    "@opentui/core/assets/markdown_inline/tree-sitter-markdown_inline.wasm",
    "@opentui/core/assets/zig/highlights.scm",
    "@opentui/core/assets/zig/tree-sitter-zig.wasm",
    "web-tree-sitter/tree-sitter.wasm",
  ]
  for (const key of requiredKeys) {
    expect(existsSync(join(vendorRoot, key)), `missing vendored asset ${key}`).toBe(true)
  }
})

test("diff view renders through the vendored parser worker", async () => {
  const app = await testRender(
    () => (
      <diff
        view="unified"
        showLineNumbers
        wrapMode="char"
        diff={`--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,2 +1,2 @@\n-const old = 1\n+const updated = 2\n`}
      />
    ),
    { width: 72, height: 20 },
  )
  await app.renderOnce()
  const frame = app.captureCharFrame()
  expect(frame).toContain("main.ts")
  expect(frame).toContain("updated")
})
