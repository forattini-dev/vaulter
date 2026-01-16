/**
 * ESBuild configuration for vaulter CLI bundling
 *
 * Creates single-file bundles that can be compiled to native binaries
 *
 * Build targets:
 * - vaulter.cjs: Full CLI with MCP (requires node_modules at runtime)
 * - vaulter-standalone.cjs: CLI-only for pkg binaries (no MCP)
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
    's3db.js',
    'yaml',
    '@modelcontextprotocol/sdk',
    '@aws-sdk/client-s3'
  ]
}

// Optional dependencies from s3db.js that we don't use
// These are dynamically imported and won't affect runtime if missing
const s3dbOptionalDeps = [
  'node:sqlite',
  'node-cron',
  '@hono/swagger-ui',
  'puppeteer-extra',
  'puppeteer-extra-plugin-stealth',
  'user-agents',
  'ghost-cursor',
  '@aws-sdk/client-sqs',
  'amqplib',
  'bullmq',
  'redis',
  'better-sqlite3',
  'mysql2',
  '@aws-sdk/client-dynamodb',
  '@aws-sdk/util-dynamodb',
  '@clickhouse/client',
  '@google-cloud/bigquery',
  'pg',
  '@planetscale/database',
  '@libsql/client'
]

// Standalone CLI bundle (for pkg binaries - no MCP)
const standaloneConfig = {
  ...commonOptions,
  entryPoints: ['./src/cli/index.ts'],
  outfile: './dist/bin/vaulter-standalone.cjs',
  define: {
    ...commonOptions.define,
    'process.env.VAULTER_STANDALONE': JSON.stringify('true')
  },
  // s3db.js has too many dynamic imports - keep it and its deps external
  // pkg will include node_modules via assets
  external: [
    's3db.js',
    'yaml',
    '@aws-sdk/*',
    ...s3dbOptionalDeps,
    '@modelcontextprotocol/sdk',
    '@modelcontextprotocol/sdk/*'
  ]
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
