/**
 * Vaulter CLI - Pull Command
 *
 * Two modes:
 * 1. Outputs mode (default): Pull to output targets defined in config
 *    - Use --all to pull to all outputs
 *    - Use --output <name> to pull to a specific output
 *
 * 2. Dir mode (--dir): Pull backend → .vaulter/{env}/ structure
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { withClient } from '../lib/create-client.js'
import { findConfigDir } from '../../lib/config-loader.js'
import { parseEnvFile } from '../../lib/env-parser.js'
import { c, colorEnv, print } from '../lib/colors.js'
import { pullToOutputs, validateOutputsConfig } from '../../lib/outputs.js'
import { pullFromBackend } from '../../lib/backend-sync.js'
import { normalizePlanSummary, writeSyncPlanArtifact } from '../../lib/sync-plan.js'
import * as ui from '../ui.js'

export interface PullContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  /** Pull to all output targets (outputs mode) */
  all?: boolean
  /** Specific output target name (outputs mode) */
  target?: string
  /** Use directory mode: pull to .vaulter/{env}/ structure */
  dir?: boolean
  /** Optional sync plan output path */
  planOutput?: string
}

interface EnvDiff {
  added: string[]
  updated: string[]
  deleted: string[]
  unchanged: string[]
}

function getPlanOutputFromContext(context: PullContext): string | undefined {
  const rawValue = context.planOutput || context.args['plan-output']
  if (typeof rawValue !== 'string') return undefined
  const trimmed = rawValue.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readEnvFileSafe(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  try {
    return parseEnvFile(filePath)
  } catch {
    return {}
  }
}

function diffEnv(before: Record<string, string>, after: Record<string, string>): EnvDiff {
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)])
  const result: EnvDiff = { added: [], updated: [], deleted: [], unchanged: [] }

  for (const key of keys) {
    const beforeValue = before[key]
    const afterValue = after[key]

    if (beforeValue === undefined) {
      result.added.push(key)
      continue
    }

    if (afterValue === undefined) {
      result.deleted.push(key)
      continue
    }

    if (beforeValue === afterValue) {
      result.unchanged.push(key)
    } else {
      result.updated.push(key)
    }
  }

  return result
}

async function emitPullPlanArtifact(context: PullContext, payload: {
  localCount: number
  remoteCount: number
  status: 'planned' | 'applied' | 'failed'
  changes: EnvDiff
  notes: string[]
  source: { inputPath?: string; outputPath?: string; isDirMode?: boolean }
  guardWarnings?: string[]
}): Promise<void> {
  const planOutput = getPlanOutputFromContext(context)
  if (!planOutput) return

  const summary = normalizePlanSummary({
    operation: 'pull',
    project: context.project,
    environment: context.environment,
    apply: payload.status === 'applied',
    dryRun: payload.status === 'planned',
    status: payload.status,
    source: {
      inputPath: payload.source.inputPath,
      outputPath: payload.source.outputPath,
      isDirMode: payload.source.isDirMode
    },
    counts: {
      local: payload.localCount,
      remote: payload.remoteCount,
      plannedChangeCount: payload.changes.added.length + payload.changes.updated.length + payload.changes.deleted.length,
      unchangedCount: payload.changes.unchanged.length
    },
    changes: {
      added: payload.changes.added,
      updated: payload.changes.updated,
      deleted: payload.changes.deleted,
      unchanged: payload.changes.unchanged,
      localAdded: [],
      localUpdated: [],
      localDeleted: [],
      conflicts: []
    },
    notes: payload.notes,
    missingRequired: [],
    guardWarnings: payload.guardWarnings || [],
    encodingWarnings: []
  })

  try {
    writeSyncPlanArtifact(summary, {
      operation: 'pull',
      project: context.project,
      environment: context.environment,
      outputPath: planOutput
    })
  } catch (error) {
    if (context.verbose) {
      ui.verbose(`Failed to write pull plan artifact: ${(error as Error).message}`, true)
    }
  }
}

function listDirPullFiles(configDir: string, environment: Environment): string[] {
  const envDir = path.join(configDir, environment)
  const files = [
    path.join(envDir, 'configs.env'),
    path.join(envDir, 'secrets.env')
  ]

  if (!fs.existsSync(envDir)) return files

  for (const dirent of fs.readdirSync(envDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const serviceDir = path.join(envDir, dirent.name)
    files.push(path.join(serviceDir, 'configs.env'))
    files.push(path.join(serviceDir, 'secrets.env'))
  }

  return files
}

/**
 * Run the pull command
 */
export async function runPull(context: PullContext): Promise<void> {
  const { project, args } = context

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  // Check for --dir flag
  const dirMode = args.dir || context.dir
  const configDir = findConfigDir()

  if (dirMode) {
    if (!configDir) {
      print.error('Could not find .vaulter/ directory')
      process.exit(1)
    }
    await runDirPull(context, configDir)
    return
  }

  // Auto-detect: if no --all or --output, suggest dir mode
  if (!context.all && !context.target) {
    print.error('Specify --all, --output <name>, or --dir')
    ui.log('Examples:')
    ui.log(`  ${c.command('vaulter sync pull --all')}        ${c.muted('# Pull to all output targets')}`)
    ui.log(`  ${c.command('vaulter sync pull --output web')} ${c.muted('# Pull to specific output')}`)
    ui.log(`  ${c.command('vaulter sync pull --dir')}        ${c.muted('# Pull to .vaulter/{env}/ structure')}`)
    process.exit(1)
  }

  await runPullOutputs(context)
}

/**
 * Run pull in outputs mode (--all or --output <name>)
 *
 * Pulls variables to multiple output targets defined in config.outputs
 */
async function runPullOutputs(context: PullContext): Promise<void> {
  const { args, config, project, environment, verbose, dryRun, jsonOutput, all, target } = context

  if (!config) {
    print.error('Config required for outputs mode')
    ui.log(`Run "${c.command('vaulter init')}" to create a config file`)
    process.exit(1)
  }

  if (!config.outputs || Object.keys(config.outputs).length === 0) {
    print.error('No outputs defined in config')
    ui.log('Add an "outputs" section to your config:')
    ui.log('')
    ui.log(c.muted('  outputs:'))
    ui.log(c.muted('    web:'))
    ui.log(c.muted('      path: apps/web'))
    ui.log(c.muted('      include: [NEXT_PUBLIC_*]'))
    ui.log(c.muted('    api: apps/api'))
    ui.log('')
    process.exit(1)
  }

  // Validate outputs config
  const errors = validateOutputsConfig(config)
  if (errors.length > 0) {
    print.error('Invalid outputs config:')
    for (const err of errors) {
      ui.log(`  ${c.removed(err)}`)
    }
    process.exit(1)
  }

  // Find project root (where .vaulter/ is located)
  const configDir = findConfigDir()
  if (!configDir) {
    print.error('Could not find .vaulter/ directory')
    process.exit(1)
  }
  const projectRoot = path.dirname(configDir)

  if (verbose) {
    const outputNames = Object.keys(config.outputs)
    const targetDesc = all ? `all outputs (${outputNames.join(', ')})` : `output "${target}"`
    ui.verbose(`Pulling ${c.project(project)}/${colorEnv(environment)} to ${targetDesc}`, true)
    ui.verbose(`Project root: ${c.muted(projectRoot)}`, true)
  }

  await withClient({ args, config, project, verbose }, async (client) => {
    const result = await pullToOutputs({
      client,
      config,
      environment,
      projectRoot,
      all,
      output: target,
      dryRun,
      verbose
    })

    const outputChanges: EnvDiff = { added: [], updated: [], deleted: [], unchanged: [] }
    let localCount = 0
    let remoteCount = 0

    for (const file of result.files) {
      const before = readEnvFileSafe(file.fullPath)
      const diff = diffEnv(before, file.vars)
      outputChanges.added.push(...diff.added)
      outputChanges.updated.push(...diff.updated)
      outputChanges.deleted.push(...diff.deleted)
      outputChanges.unchanged.push(...diff.unchanged)
      localCount += Object.keys(before).length
      remoteCount += Object.keys(file.vars).length
    }

    await emitPullPlanArtifact(context, {
      localCount,
      remoteCount,
      status: dryRun ? 'planned' : 'applied',
      changes: outputChanges,
      notes: [
        `mode=outputs`,
        all ? 'all outputs' : `output=${target || 'default'}`
      ],
      source: {
        outputPath: context.target || 'all'
      }
    })

    // Output results
    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        dryRun,
        project,
        environment,
        files: result.files.map(f => ({
          output: f.output,
          path: f.fullPath,
          varsCount: f.varsCount,
          vars: dryRun ? f.vars : Object.keys(f.vars)
        })),
        warnings: result.warnings
      }, null, 2))
    } else {
      if (dryRun) {
        ui.log('Dry run - would write:')
      } else {
        ui.success(`Pulled to ${result.files.length} output(s):`)
      }

      for (const file of result.files) {
        const varsList = Object.keys(file.vars).slice(0, 5).join(', ')
        const more = Object.keys(file.vars).length > 5 ? '...' : ''
        ui.log(`  ${c.highlight(file.output)}: ${c.muted(file.fullPath)} (${file.varsCount} vars)`)
        if (verbose) {
          ui.log(`    ${c.muted(varsList + more)}`)
        }
      }

      for (const warning of result.warnings) {
        print.warning(warning)
      }
    }
  })
}

/**
 * Run pull in directory mode
 *
 * Pulls from backend to .vaulter/{env}/ structure:
 * - configs.env + secrets.env ← __shared__
 * - services/{svc}/configs.env + secrets.env ← {svc}
 */
async function runDirPull(context: PullContext, configDir: string): Promise<void> {
  const { args, config, project, environment, verbose, dryRun, jsonOutput } = context

  // Show environment banner
  if (!jsonOutput && !dryRun) {
    ui.showEnvironmentBanner(environment, {
      project,
      action: 'Pulling to directory structure'
    })
  }

  await withClient({ args, config, project, verbose }, async (client) => {
    const envDir = path.join(configDir, environment)
    const trackedFiles = listDirPullFiles(configDir, environment)
    const beforeFiles = trackedFiles.reduce<Record<string, Record<string, string>>>((acc, filePath) => {
      acc[filePath] = readEnvFileSafe(filePath)
      return acc
    }, {})

    const result = await pullFromBackend({
      client,
      vaulterDir: configDir,
      project,
      environment,
      dryRun
    })

    const afterFiles = trackedFiles.reduce<Record<string, Record<string, string>>>((acc, filePath) => {
      if (dryRun) {
        acc[filePath] = beforeFiles[filePath] || {}
      } else {
        acc[filePath] = readEnvFileSafe(filePath)
      }
      return acc
    }, {})

    const dirChanges: EnvDiff = { added: [], updated: [], deleted: [], unchanged: [] }
    let localCount = 0
    let remoteCount = result.pulled

    for (const filePath of trackedFiles) {
      const before = beforeFiles[filePath] || {}
      const after = afterFiles[filePath] || {}
      const diff = diffEnv(before, after)
      dirChanges.added.push(...diff.added)
      dirChanges.updated.push(...diff.updated)
      dirChanges.deleted.push(...diff.deleted)
      dirChanges.unchanged.push(...diff.unchanged)
      localCount += Object.keys(before).length
    }

    await emitPullPlanArtifact(context, {
      localCount,
      remoteCount,
      status: dryRun ? 'planned' : 'applied',
      changes: dirChanges,
      notes: [
        'mode=dir',
        `path=${envDir}`
      ],
      source: {
        outputPath: envDir,
        isDirMode: true
      }
    })

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        dryRun,
        project,
        environment,
        pulled: result.pulled,
        services: result.services,
        details: result.details
      }))
    } else if (dryRun) {
      ui.log(`${c.muted('Dry run')} - would pull:`)
      ui.log(`  Shared: ${result.details.shared.configs} configs, ${result.details.shared.secrets} secrets`)
      for (const [svc, counts] of Object.entries(result.details.services)) {
        ui.log(`  ${c.service(svc)}: ${counts.configs} configs, ${counts.secrets} secrets`)
      }
      ui.log(`  ${c.muted('Total:')} ${result.pulled} variables`)
    } else {
      ui.success(`Pulled ${result.pulled} variables to ${configDir}/${environment}/`)
      ui.log(`  Shared: ${result.details.shared.configs} configs, ${result.details.shared.secrets} secrets`)
      for (const [svc, counts] of Object.entries(result.details.services)) {
        ui.log(`  ${c.service(svc)}: ${counts.configs} configs, ${counts.secrets} secrets`)
      }
    }
  })
}
