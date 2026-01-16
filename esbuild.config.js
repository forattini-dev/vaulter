/**
 * ESBuild configuration for vaulter CLI bundling
 *
 * Creates single-file bundles that can be compiled to native binaries
 *
 * Build targets:
 * - vaulter.cjs: Full CLI with MCP (requires node_modules at runtime)
 * - vaulter-standalone.cjs: CLI-only for pkg binaries (no MCP)
 *
 * Uses s3db.js/lite which excludes optional plugins (87% smaller, no node:sqlite)
 */

import esbuild from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

const isWatch = process.argv.includes('--watch')
const isStandalone = process.argv.includes('--standalone')

// Common build options
const commonOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20', // pkg uses node20
  format: 'cjs',
  sourcemap: false,
  minify: true,
  define: {
    'process.env.VAULTER_VERSION': JSON.stringify(pkg.version)
  },
  banner: {
    js: '#!/usr/bin/env node'
  },
  loader: {
    '.json': 'json'
  },
  logLevel: 'info'
}

// Full CLI bundle (with MCP - requires node_modules)
const fullConfig = {
  ...commonOptions,
  entryPoints: ['./src/cli/index.ts'],
  outfile: './dist/bin/vaulter.cjs',
  external: [
    's3db.js/lite',
    'yaml',
    '@modelcontextprotocol/sdk',
    '@aws-sdk/client-s3'
  ]
}

// Plugin to stub optional modules not used by standalone vaulter
const stubOptionalNative = {
  name: 'stub-optional-native',
  setup(build) {
    // node:sqlite - undici's optional cache store (from recker)
    build.onResolve({ filter: /^node:sqlite$/ }, () => ({
      path: 'node:sqlite',
      namespace: 'stub-native'
    }))
    // bcrypt - optional password hashing (from s3db.js)
    build.onResolve({ filter: /^bcrypt$/ }, () => ({
      path: 'bcrypt',
      namespace: 'stub-native'
    }))
    // pino-pretty - optional log formatting (from pino via s3db.js)
    build.onResolve({ filter: /^pino-pretty$/ }, () => ({
      path: 'pino-pretty',
      namespace: 'stub-native'
    }))
    // Return empty module for all stubs
    build.onLoad({ filter: /.*/, namespace: 'stub-native' }, () => ({
      contents: 'module.exports = {};',
      loader: 'js'
    }))
  }
}

// Standalone CLI bundle (for pkg binaries - no MCP)
// s3db.js/lite bundles cleanly, but undici (from recker) has optional node:sqlite
const standaloneConfig = {
  ...commonOptions,
  entryPoints: ['./src/cli/index.ts'],
  outfile: './dist/bin/vaulter-standalone.cjs',
  define: {
    ...commonOptions.define,
    'process.env.VAULTER_STANDALONE': JSON.stringify('true'),
    // Force JSON logging to avoid pino-pretty dependency in standalone
    'process.env.S3DB_LOG_FORMAT': JSON.stringify('json')
  },
  external: [
    '@modelcontextprotocol/sdk',
    '@modelcontextprotocol/sdk/*'
  ],
  plugins: [stubOptionalNative]
}

async function build() {
  if (isWatch) {
    const ctx = await esbuild.context(fullConfig)
    await ctx.watch()
    console.log('Watching for changes...')
  } else if (isStandalone) {
    await esbuild.build(standaloneConfig)
    console.log(`✓ Built vaulter-standalone v${pkg.version}`)
    console.log('  → dist/bin/vaulter-standalone.cjs (CLI only, no MCP)')
  } else {
    await esbuild.build(fullConfig)
    console.log(`✓ Built vaulter v${pkg.version}`)
    console.log('  → dist/bin/vaulter.cjs (CLI + MCP)')
  }
}

build().catch(err => {
  console.error(err)
  process.exit(1)
})
