import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

// Bun resolves the bare `solid-js` specifier to dist/server.js (SSR runtime).
// Rewrite it to the client build so the bundle contains a single Solid
// runtime instance, matching @opentui/solid's own solid-js/dist/solid.js
// imports (a duplicate runtime breaks the renderer context at runtime).
const solidPlugin = createSolidTransformPlugin({
  resolvePath: (specifier: string) =>
    specifier === "solid-js"
      ? "solid-js/dist/solid.js"
      : specifier === "solid-js/store"
        ? "solid-js/store/dist/store.js"
        : specifier,
})

const cli = await Bun.build({
  entrypoints: ["src/cli.tsx"],
  outdir: "dist",
  naming: "cli.js",
  target: "node",
  format: "esm",
  // Bundle Solid and the OpenTUI Solid binding so the artifact runs from any
  // directory without the bunfig preload: at build time the solid transform
  // plugin already rewrites `solid-js/dist/server.js` to the client build.
  // @opentui/core stays external because it loads native platform binaries.
  // `ws` must stay external: bundling it with Bun swaps its `node:http`
  // dependency for Bun's shim, which never emits the `upgrade` event, so a
  // valid 101 handshake arrives as a plain `response` ("Unexpected server
  // response: 101"). External keeps the real `ws`/`node:http` upgrade path.
  external: ["@opentui/core", "ws"],
  plugins: [solidPlugin],
})

// Node-compatible dsh bundle plugin entry points: loaded inside the official
// `dsh` process (runner + startup), plus the dispatcher used by bin/dsh-cli.
const dsh = await Bun.build({
  entrypoints: ["src/dsh/startup.ts", "src/dsh/runner.ts", "src/dsh/dispatcher.ts", "src/dsh/silent-update-agent.ts"],
  outdir: "dist",
  naming: "[name].js",
  target: "node",
  format: "esm",
  external: ["ws"],
})

if (!cli.success || !dsh.success) {
  for (const log of [...cli.logs, ...dsh.logs]) console.error(log)
  process.exit(1)
}

console.log("built dist/cli.js, dist/startup.js, dist/runner.js, dist/dispatcher.js, dist/silent-update-agent.js")
