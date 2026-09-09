import { spawnSync } from "node:child_process"
import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

// The applier bundle is gitignored (built by scripts/build.ts), so a test must
// not depend on dist/ existing during CI's test step. Invoke the source file
// directly through bun to check the wiring: it emits the applied set as JSON and
// exits. With DSH_NO_UPDATE_CHECK=1 the apply stage is a no-op.
const applierSrc = fileURLToPath(new URL("../src/dsh/apply-update.ts", import.meta.url))

test("apply-update emits the applied-set JSON and exits (no-op when disabled)", () => {
  const res = spawnSync("bun", ["run", applierSrc], {
    env: { ...process.env, DSH_NO_UPDATE_CHECK: "1" },
    encoding: "utf8",
    windowsHide: true,
  })
  expect(res.status).toBe(0)
  const parsed = JSON.parse(String(res.stdout ?? "{}")) as { updated: unknown[] }
  expect(Array.isArray(parsed.updated)).toBe(true)
  expect(parsed.updated).toEqual([])
})
