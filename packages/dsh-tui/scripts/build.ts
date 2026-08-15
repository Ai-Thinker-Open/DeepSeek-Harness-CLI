import { createSolidTransformPlugin } from '@opentui/solid/bun-plugin'

const result = await Bun.build({
  entrypoints: ['src/cli.tsx'],
  outdir: 'dist',
  target: 'node',
  format: 'esm',
  external: ['@opentui/core', '@opentui/solid', 'solid-js'],
  plugins: [createSolidTransformPlugin()],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log('built packages/dsh-tui/dist/cli.js')
