/**
 * Vaulter CLI - Scan Command
 *
 * Scan monorepo for packages and .env files
 * Detects: NX, Turborepo, Lerna, pnpm workspaces, Yarn workspaces, Rush
 */

import path from 'node:path'
import type { CLIArgs } from '../../types.js'
import { scanMonorepo, formatScanResult } from '../../lib/monorepo-detect.js'
import * as ui from '../ui.js'

interface ScanContext {
  args: CLIArgs
  verbose: boolean
  jsonOutput: boolean
}

/**
 * Run the scan command
 */
export async function runScan(context: ScanContext): Promise<void> {
  const { args, verbose, jsonOutput } = context
  const scanPath = args._[1] || process.cwd()

  ui.verbose(`Scanning monorepo at ${scanPath}`, verbose)

  try {
    const result = await ui.withSpinner('Scanning monorepo...', () => scanMonorepo(scanPath), {
      successText: 'Scan complete'
    })

    if (jsonOutput) {
      ui.output(JSON.stringify({
        monorepo: {
          tool: result.monorepo.tool,
          root: result.monorepo.root,
          configFile: result.monorepo.configFile,
          workspacePatterns: result.monorepo.workspacePatterns
        },
        summary: {
          total: result.packages.length,
          initialized: result.initialized.length,
          uninitialized: result.uninitialized.length,
          withEnvFiles: result.withEnvFiles.length
        },
        packages: result.packages.map(p => ({
          name: p.name,
          path: p.relativePath,
          type: p.type,
          hasVaulterConfig: p.hasVaulterConfig,
          hasEnvFiles: p.hasEnvFiles,
          hasDeployDir: p.hasDeployDir
        }))
      }, null, 2))
      return
    }

    // Pretty text output
    ui.output(formatScanResult(result))

    // Suggestions
    if (result.uninitialized.length > 0 && result.withEnvFiles.length > 0) {
      ui.log('')
      ui.log('💡 Suggestions:')
      const uninitializedWithEnv = result.uninitialized.filter(p => p.hasEnvFiles.length > 0)
      if (uninitializedWithEnv.length > 0) {
        ui.log(`   Run "vaulter init" in these directories to start managing their secrets:`)
        for (const pkg of uninitializedWithEnv.slice(0, 5)) {
          ui.log(`   • cd ${pkg.relativePath} && vaulter init --project=${path.basename(result.monorepo.root)} --service=${pkg.name}`)
        }
        if (uninitializedWithEnv.length > 5) {
          ui.log(`   ... and ${uninitializedWithEnv.length - 5} more`)
        }
      }
    }
  } catch (error) {
    ui.error(`Failed to scan: ${(error as Error).message}`)
    process.exit(1)
  }
}
