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
      // Collect all unique environments across packages
      const allDetectedEnvs = new Set<string>()
      for (const pkg of result.packages) {
        for (const env of pkg.detectedEnvironments) {
          allDetectedEnvs.add(env)
        }
      }

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
          withEnvFiles: result.withEnvFiles.length,
          detectedEnvironments: [...allDetectedEnvs].sort()
        },
        packages: result.packages.map(p => ({
          name: p.name,
          path: p.relativePath,
          type: p.type,
          hasVaulterConfig: p.hasVaulterConfig,
          hasDeployDir: p.hasDeployDir,
          // Detailed env info
          envFiles: p.envFiles,
          detectedEnvironments: p.detectedEnvironments,
          configuredEnvironments: p.configuredEnvironments
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
