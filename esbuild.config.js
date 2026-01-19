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

// Banner for pkg compatibility - defines __filename/__dirname, patches createRequire, and suppresses harmless warnings
const pkgCompatBanner = `#!/usr/bin/env node
// pkg compatibility shim
if (typeof __filename === 'undefined') {
  globalThis.__filename = process.execPath;
  globalThis.__dirname = require('path').dirname(process.execPath);
}
// Suppress harmless experimental SQLite warning (from s3db.js cache plugin)
(function() {
  var origEmit = process.emitWarning;
  process.emitWarning = function(warning, options) {
    if (typeof warning === 'string' && warning.includes('SQLite is an experimental feature')) return;
    return origEmit.apply(process, arguments);
  };
})();
(function() {
  var Module = require('node:module');
  var origCreateRequire = Module.createRequire.bind(Module);
  Module.createRequire = function(url) {
    // Handle undefined/null from import.meta.url in pkg binaries
    if (url === undefined || url === null || url === '' ||
        (typeof url === 'object' && url.href === undefined)) {
      return origCreateRequire(__filename || process.execPath);
    }
    try {
      return origCreateRequire(url);
    } catch (e) {
      // Fallback for invalid URLs
      return origCreateRequire(__filename || process.execPath);
    }
  };
})();
`

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

// Plugin to fix import.meta.url in ESM modules when bundling for CJS
// This patches fdir (used by tinyglobby) which uses createRequire(import.meta.url)
const fixImportMetaUrl = {
  name: 'fix-import-meta-url',
  setup(build) {
    // Only apply to fdir module
    build.onLoad({ filter: /fdir.*\.mjs$/ }, async (args) => {
      let contents = readFileSync(args.path, 'utf8')

      // Replace createRequire(import.meta.url) with a pkg-compatible version
      // The original: __require = createRequire(import.meta.url)
      // We replace import.meta.url with a fallback that works in pkg binaries
      contents = contents.replace(
        /createRequire\s*\(\s*import\.meta\.url\s*\)/g,
        'createRequire(typeof __filename !== "undefined" ? __filename : process.execPath)'
      )

      return {
        contents,
        loader: 'js'
      }
    })
  }
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

// Full CLI bundle (with MCP - requires node_modules)
const fullConfig = {
  ...commonOptions,
  entryPoints: ['./src/cli/index.ts'],
  outfile: './dist/bin/vaulter.cjs',
  // Use pkg-compat banner that patches createRequire for undefined import.meta.url
  banner: {
    js: pkgCompatBanner
  },
  external: [
    's3db.js/lite',
    'yaml',
    '@modelcontextprotocol/sdk',
    '@aws-sdk/client-s3'
  ],
  plugins: [fixImportMetaUrl, stubOptionalNative]
}

// Standalone CLI bundle (for pkg binaries - no MCP)
// s3db.js/lite bundles cleanly, but undici (from recker) has optional node:sqlite
const standaloneConfig = {
  ...commonOptions,
  entryPoints: ['./src/cli/index.ts'],
  outfile: './dist/bin/vaulter-standalone.cjs',
  minify: true,
  define: {
    ...commonOptions.define,
    'process.env.VAULTER_STANDALONE': JSON.stringify('true'),
    // Force JSON logging to avoid pino-pretty dependency in standalone
    'process.env.S3DB_LOG_FORMAT': JSON.stringify('json')
  },
  // Use pkg-compat banner that patches createRequire for undefined import.meta.url
  banner: {
    js: pkgCompatBanner
  },
  external: [
    '@modelcontextprotocol/sdk',
    '@modelcontextprotocol/sdk/*'
  ],
  plugins: [fixImportMetaUrl, stubOptionalNative]
}

// GitHub Action banner - sets env vars BEFORE any imports
const actionBanner = `// Vaulter GitHub Action - https://github.com/forattini-dev/vaulter
// Force silent logging to avoid pino-pretty transport errors in bundled action
process.env.S3DB_LOG_LEVEL = 'silent';
process.env.S3DB_LOG_FORMAT = 'json';
`

// GitHub Action bundle (self-contained, no external deps needed at runtime)
const actionConfig = {
  ...commonOptions,
  entryPoints: ['./src/action/index.ts'],
  outfile: './dist/action/index.cjs',
  format: 'cjs',
  minify: false, // Keep readable for debugging
  define: {
    ...commonOptions.define
  },
  banner: {
    js: actionBanner
  },
  // Bundle everything for action
  external: [],
  plugins: [fixImportMetaUrl, stubOptionalNative]
}

const isAction = process.argv.includes('--action')

async function build() {
  if (isWatch) {
    const ctx = await esbuild.context(fullConfig)
    await ctx.watch()
    console.log('Watching for changes...')
  } else if (isStandalone) {
    await esbuild.build(standaloneConfig)
    console.log(`✓ Built vaulter-standalone v${pkg.version}`)
    console.log('  → dist/bin/vaulter-standalone.cjs (CLI only, no MCP)')
  } else if (isAction) {
    await esbuild.build(actionConfig)
    console.log(`✓ Built vaulter-action v${pkg.version}`)
    console.log('  → dist/action/index.js (GitHub Action)')
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
