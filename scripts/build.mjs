import { build } from 'esbuild'

const watch = process.argv.includes('--watch')

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  logLevel: 'info',
  sourcemap: watch ? 'inline' : false,
}

const entries = [
  {
    entryPoints: ['src/cli.ts'],
    outfile: 'dist/cli.js',
    // the shebang in src/cli.ts is preserved by esbuild
    external: ['ink', 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  {
    entryPoints: ['src/cordis/entry.ts'],
    outfile: 'dist/cordis.js',
    // the cordis plugin runs inside the dsh process; it imports no
    // @deepseek-ai packages directly (the host ctx is duck-typed)
    external: ['ink', 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  {
    entryPoints: ['src/client.ts'],
    outfile: 'dist/client.js',
    external: [],
  },
  {
    entryPoints: ['src/bridge-tui.ts'],
    outfile: 'dist/bridge-tui.js',
    external: ['bun'],
  },
]

if (watch) {
  for (const e of entries) {
    await build({ ...common, ...e, watch: true })
  }
  console.log('watching…')
} else {
  for (const e of entries) {
    await build({ ...common, ...e })
  }
  console.log('built dist/cli.js, dist/cordis.js, dist/client.js, dist/bridge-tui.js')
}
