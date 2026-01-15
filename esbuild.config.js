/**
 * ESBuild configuration for vaulter CLI and MCP server bundling
 *
 * Creates single-file bundles that can be compiled to native binaries
 */

import esbuild from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

const isWatch = process.argv.includes('--watch')

// Common build options
const commonOptions = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  minify: true,
  define: {
    'process.env.MINIENV_VERSION': JSON.stringify(pkg.version)
  },
  banner: {
    js: '#!/usr/bin/env node'
  },
  loader: {
    '.json': 'json'
  },
  logLevel: 'info',
  // External modules that shouldn't be bundled
  // These have dynamic imports or native bindings that break bundling
  external: [
    's3db.js',
    'bcrypt',
    'ws',
    'yaml',
    'minimist',
    '@modelcontextprotocol/sdk',
    '@aws-sdk/client-s3'
  ]
}

// CLI bundle configuration (includes MCP server as subcommand)
const cliConfig = {
  ...commonOptions,
  entryPoints: ['./src/cli/index.ts'],
  outfile: './dist/bin/vaulter.cjs'
}

async function build() {
  if (isWatch) {
    const ctx = await esbuild.context(cliConfig)
    await ctx.watch()
    console.log('Watching for changes...')
  } else {
    await esbuild.build(cliConfig)
    console.log(`✓ Built vaulter v${pkg.version}`)
    console.log('  → dist/bin/vaulter.cjs (CLI + MCP)')
  }
}

build().catch(err => {
  console.error(err)
  process.exit(1)
})
