/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"

test("diff view renders through OpenTUI's parser worker", async () => {
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
