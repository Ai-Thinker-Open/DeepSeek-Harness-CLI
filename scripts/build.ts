import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["src/cli.tsx"],
  outdir: "dist",
  naming: "cli.js",
  target: "node",
  format: "esm",
  external: ["@opentui/core", "@opentui/solid", "solid-js"],
  plugins: [createSolidTransformPlugin()],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log("built dist/cli.js")
