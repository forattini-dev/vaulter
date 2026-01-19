/**
 * Vaulter CLI - Rotation Management Commands
 *
 * Manage secret rotation policies and check rotation status:
 * - rotation check - Check which secrets need rotation
 * - rotation set KEY --interval 90d - Set rotation policy for a secret
 * - rotation list - List secrets with rotation policies
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { getValidEnvironments } from '../../lib/config-loader.js'
import * as ui from '../ui.js'
import { c, print } from '../lib/colors.js'

interface RotationContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

/**
 * Parse duration string (e.g., "30d", "90d", "1y") to days
 */
function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)(d|w|m|y)$/i)
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()

  switch (unit) {
    case 'd': return value
    case 'w': return value * 7
    case 'm': return value * 30
    case 'y': return value * 365
    default: return null
  }
}

/**
 * Check if a secret needs rotation
 * Note: rotateAfter can be Date or string (from storage deserialization)
 */
function needsRotation(
  rotatedAt: string | undefined,
  rotateAfter: Date | string | undefined,
  defaultIntervalDays: number
): boolean {
  const now = new Date()

  // If rotateAfter is set, use that
  if (rotateAfter) {
    const dueDate = rotateAfter instanceof Date ? rotateAfter : new Date(rotateAfter)
    return now > dueDate
  }

  // Otherwise, check against last rotation + default interval
  const lastRotation = rotatedAt ? new Date(rotatedAt) : new Date(0)
  const dueDate = new Date(lastRotation.getTime() + defaultIntervalDays * 24 * 60 * 60 * 1000)
  return now > dueDate
}

/**
 * Run the rotation command
 */
export async function runRotation(context: RotationContext): Promise<void> {
  const { args } = context

  const subcommand = args._[1]

  switch (subcommand) {
    case 'check':
    case 'status':
      await runRotationCheck(context)
      break

    case 'set':
      await runRotationSet(context)
      break

    case 'list':
    case 'ls':
      await runRotationList(context)
      break

    case 'run':
      await runRotationRun(context)
      break

    default:
      print.error('Usage: vaulter rotation <subcommand>')
      ui.log('')
      ui.log('Subcommands:')
      ui.log('  check, status   Check which secrets need rotation')
      ui.log('  set KEY         Set rotation policy for a secret')
      ui.log('  list, ls        List secrets with rotation policies')
      ui.log('  run             Run rotation workflow (CI/CD integration)')
      process.exit(1)
  }
}

/**
 * Check which secrets need rotation
 */
async function runRotationCheck(context: RotationContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  const allEnvs = args['all-envs']
  const defaultDays = args.days || config?.encryption?.rotation?.interval_days || 90
  const environments = allEnvs && config
    ? getValidEnvironments(config)
    : [environment]

  ui.verbose(`Checking secrets older than ${defaultDays} days`, verbose)
  ui.verbose(`Environments: ${environments.join(', ')}`, verbose)

  const client = await createClientFromConfig({ args, config, project, verbose })

  interface SecretStatus {
    key: string
    environment: string
    rotatedAt?: string
    rotateAfter?: string
    needsRotation: boolean
    daysOld: number
    daysUntilDue?: number
  }

  const results: SecretStatus[] = []

  try {
    await client.connect()

    for (const env of environments) {
      const variables = await client.list({ project, environment: env as Environment, service })

      for (const variable of variables) {
        const rotatedAt = variable.metadata?.rotatedAt
        const rotateAfter = variable.metadata?.rotateAfter
        const needs = needsRotation(rotatedAt, rotateAfter, defaultDays)

        const lastRotation = rotatedAt ? new Date(rotatedAt) : variable.updatedAt
        const daysOld = lastRotation
          ? Math.floor((Date.now() - lastRotation.getTime()) / (24 * 60 * 60 * 1000))
          : Infinity

        let daysUntilDue: number | undefined
        if (rotateAfter) {
          const due = new Date(rotateAfter)
          daysUntilDue = Math.floor((due.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        }

        // Normalize rotateAfter to ISO string (could be Date or string from storage)
        const rotateAfterStr = rotateAfter
          ? (rotateAfter instanceof Date ? rotateAfter.toISOString() : String(rotateAfter))
          : undefined

        results.push({
          key: variable.key,
          environment: env,
          rotatedAt,
          rotateAfter: rotateAfterStr,
          needsRotation: needs,
          daysOld,
          daysUntilDue
        })
      }
    }
  } finally {
    await client.disconnect()
  }

  const needingRotation = results.filter(r => r.needsRotation)
  const upToDate = results.filter(r => !r.needsRotation)

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project,
      service,
      environments,
      defaultIntervalDays: defaultDays,
      total: results.length,
      needingRotation: needingRotation.length,
      upToDate: upToDate.length,
      secrets: results
    }))
  } else {
    ui.log(`Rotation check for ${c.project(project)}/${environments.join(', ')}`)
    ui.log(`Default rotation interval: ${c.value(String(defaultDays))} days`)
    ui.log('')

    if (needingRotation.length > 0) {
      ui.log(`⚠️  Secrets needing rotation (${needingRotation.length}):`)
      for (const s of needingRotation) {
        const envLabel = allEnvs ? ` [${s.environment}]` : ''
        const ageLabel = s.daysOld === Infinity ? 'never rotated' : `${s.daysOld} days old`
        ui.log(`  • ${c.key(s.key)}${envLabel} - ${ageLabel}`)
      }
      ui.log('')
    }

    if (upToDate.length > 0 && verbose) {
      ui.log(`✓ Secrets up to date (${upToDate.length}):`)
      for (const s of upToDate) {
        const envLabel = allEnvs ? ` [${s.environment}]` : ''
        const dueLabel = s.daysUntilDue !== undefined
          ? `due in ${s.daysUntilDue} days`
          : `${s.daysOld} days old`
        ui.log(`  • ${c.key(s.key)}${envLabel} - ${dueLabel}`)
      }
      ui.log('')
    }

    ui.log(`Summary: ${needingRotation.length} need rotation, ${upToDate.length} up to date`)
  }
}

/**
 * Set rotation policy for a secret
 */
async function runRotationSet(context: RotationContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  const key = args._[2]
  if (!key) {
    print.error('Key name is required')
    ui.log(`Usage: ${c.command('vaulter rotation set')} <key> ${c.highlight('--interval')} 90d`)
    process.exit(1)
  }

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  const intervalStr = args.interval
  const clear = args.clear

  if (!intervalStr && !clear) {
    print.error('Either --interval or --clear is required')
    ui.log(`Usage: ${c.command('vaulter rotation set')} <key> ${c.highlight('--interval')} 90d`)
    ui.log(`       ${c.command('vaulter rotation set')} <key> ${c.highlight('--clear')}`)
    process.exit(1)
  }

  let intervalDays: number | null = null
  if (intervalStr) {
    intervalDays = parseDuration(intervalStr)
    if (intervalDays === null) {
      print.error(`Invalid interval format: ${intervalStr}`)
      ui.log('Valid formats: 30d (days), 4w (weeks), 3m (months), 1y (year)')
      process.exit(1)
    }
  }

  if (clear) {
    ui.verbose(`Clearing rotation policy for ${key}`, verbose)
  } else {
    ui.verbose(`Setting rotation interval for ${key}: ${intervalDays} days`, verbose)
  }

  if (dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        dryRun: true,
        action: clear ? 'clear' : 'set',
        key,
        project,
        service,
        environment,
        intervalDays: clear ? null : intervalDays
      }))
    } else {
      if (clear) {
        ui.log(`Dry run - would clear rotation policy for ${c.key(key)}`)
      } else {
        ui.log(`Dry run - would set rotation interval for ${c.key(key)}: ${intervalDays} days`)
      }
    }
    return
  }

  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()

    // Get existing variable
    const existing = await client.get(key, project, environment, service)
    if (!existing) {
      print.error(`Variable ${c.key(key)} not found`)
      process.exit(1)
    }

    // Calculate new rotateAfter date
    let rotateAfter: Date | undefined
    if (!clear && intervalDays) {
      const now = new Date()
      rotateAfter = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000)
    }

    // Update the variable with new rotation policy
    await client.set({
      key,
      value: existing.value,
      project,
      service,
      environment,
      metadata: {
        ...existing.metadata,
        rotateAfter,
        rotatedAt: existing.metadata?.rotatedAt
      }
    })

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        action: clear ? 'cleared' : 'set',
        key,
        project,
        service,
        environment,
        rotateAfter: rotateAfter ? rotateAfter.toISOString() : null
      }))
    } else {
      if (clear) {
        ui.success(`Cleared rotation policy for ${c.key(key)}`)
      } else {
        ui.success(`Set rotation policy for ${c.key(key)}`)
        ui.log(`  Interval: ${c.value(String(intervalDays))} days`)
        ui.log(`  Next rotation due: ${c.value(rotateAfter!.toISOString().split('T')[0])}`)
      }
    }
  } finally {
    await client.disconnect()
  }
}

/**
 * List secrets with rotation policies
 */
async function runRotationList(context: RotationContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  const allEnvs = args['all-envs']
  const environments = allEnvs && config
    ? getValidEnvironments(config)
    : [environment]

  const client = await createClientFromConfig({ args, config, project, verbose })

  interface RotationPolicy {
    key: string
    environment: string
    rotatedAt?: string
    rotateAfter?: string
    daysUntilDue?: number
  }

  const results: RotationPolicy[] = []

  try {
    await client.connect()

    for (const env of environments) {
      const variables = await client.list({ project, environment: env as Environment, service })

      for (const variable of variables) {
        // Only include variables with rotation policies
        if (variable.metadata?.rotateAfter) {
          const rotateAfter = new Date(variable.metadata.rotateAfter)
          const daysUntilDue = Math.floor((rotateAfter.getTime() - Date.now()) / (24 * 60 * 60 * 1000))

          results.push({
            key: variable.key,
            environment: env,
            rotatedAt: variable.metadata?.rotatedAt,
            rotateAfter: rotateAfter.toISOString(),
            daysUntilDue
          })
        }
      }
    }
  } finally {
    await client.disconnect()
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project,
      service,
      environments,
      total: results.length,
      policies: results
    }))
  } else {
    if (results.length === 0) {
      ui.log('No secrets with rotation policies found.')
      ui.log('')
      ui.log('Set a rotation policy with:')
      ui.log(`  ${c.command('vaulter rotation set')} <key> ${c.highlight('--interval')} 90d`)
    } else {
      ui.log(`Secrets with rotation policies (${results.length}):`)
      ui.log('')

      // Sort by days until due
      results.sort((a, b) => (a.daysUntilDue ?? Infinity) - (b.daysUntilDue ?? Infinity))

      for (const policy of results) {
        const envLabel = allEnvs ? ` [${policy.environment}]` : ''
        const status = policy.daysUntilDue !== undefined
          ? (policy.daysUntilDue < 0 ? '⚠️  OVERDUE' : `due in ${policy.daysUntilDue} days`)
          : 'no due date'
        ui.log(`  • ${c.key(policy.key)}${envLabel} - ${status}`)
        if (verbose && policy.rotateAfter) {
          ui.log(`      Due: ${policy.rotateAfter.split('T')[0]}`)
          if (policy.rotatedAt) {
            ui.log(`      Last rotated: ${policy.rotatedAt.split('T')[0]}`)
          }
        }
      }
    }
  }
}

/**
 * Match a key against a glob-like pattern
 * Supports: * (any chars), ? (single char)
 */
function matchPattern(key: string, pattern: string): boolean {
  // Convert glob to regex: * -> .*, ? -> .
  const regex = new RegExp(
    '^' + pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special chars
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') + '$',
    'i'
  )
  return regex.test(key)
}

/**
 * Run rotation workflow (CI/CD integration)
 *
 * Exits with non-zero code if secrets need rotation (useful for CI/CD gates)
 *
 * Flags:
 *   --overdue         Only show secrets past their rotation date
 *   --pattern <glob>  Filter secrets by key pattern (e.g., "*_KEY")
 *   --days <n>        Override rotation threshold (default: from config or 90)
 *   --fail            Exit with code 1 if any secrets need rotation
 */
async function runRotationRun(context: RotationContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  const allEnvs = args['all-envs']
  const overdueOnly = args.overdue || false
  const pattern = args.pattern
  const failOnRotation = args.fail !== false // Default to true for CI/CD
  const defaultDays = args.days || config?.encryption?.rotation?.interval_days || 90
  const configPatterns = config?.encryption?.rotation?.patterns || []

  const environments = allEnvs && config
    ? getValidEnvironments(config)
    : [environment]

  // Check if rotation is enabled in config
  const rotationEnabled = config?.encryption?.rotation?.enabled !== false

  ui.verbose(`Rotation workflow for ${project}`, verbose)
  ui.verbose(`  Rotation enabled: ${rotationEnabled}`, verbose)
  ui.verbose(`  Default interval: ${defaultDays} days`, verbose)
  ui.verbose(`  Overdue only: ${overdueOnly}`, verbose)
  ui.verbose(`  Pattern filter: ${pattern || 'none'}`, verbose)
  ui.verbose(`  Config patterns: ${configPatterns.length > 0 ? configPatterns.join(', ') : 'none'}`, verbose)
  ui.verbose(`  Environments: ${environments.join(', ')}`, verbose)

  // If rotation is disabled in config, exit successfully (don't fail CI)
  if (!rotationEnabled) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        project,
        service,
        environments,
        rotationEnabled: false,
        message: 'Rotation is disabled in config',
        total: 0,
        overdue: 0,
        secrets: []
      }))
    } else {
      ui.log(`Rotation workflow: ${c.project(project)}`)
      ui.log('')
      ui.log('⏭️  Rotation is disabled in config (encryption.rotation.enabled: false)')
      ui.log('   CI/CD gate passed - no secrets checked.')
    }
    return
  }

  const client = await createClientFromConfig({ args, config, project, verbose })

  interface RotationCandidate {
    key: string
    environment: string
    value: string
    rotatedAt?: string
    rotateAfter?: string
    daysOld: number
    daysOverdue?: number
    matchedPattern?: string
  }

  const candidates: RotationCandidate[] = []

  try {
    await client.connect()

    for (const env of environments) {
      const variables = await client.list({ project, environment: env as Environment, service })

      for (const variable of variables) {
        const rotatedAt = variable.metadata?.rotatedAt
        const rotateAfter = variable.metadata?.rotateAfter
        const needs = needsRotation(rotatedAt, rotateAfter, defaultDays)

        // Skip if not needing rotation and overdueOnly is set
        if (overdueOnly && !needs) continue

        // Check pattern filter
        let matchedPattern: string | undefined
        if (pattern) {
          if (!matchPattern(variable.key, pattern)) continue
          matchedPattern = pattern
        } else if (configPatterns.length > 0) {
          // Use config patterns if no explicit pattern
          const matched = configPatterns.find(p => matchPattern(variable.key, p))
          if (!matched) continue
          matchedPattern = matched
        }

        const lastRotation = rotatedAt ? new Date(rotatedAt) : variable.updatedAt
        const daysOld = lastRotation
          ? Math.floor((Date.now() - lastRotation.getTime()) / (24 * 60 * 60 * 1000))
          : Infinity

        let daysOverdue: number | undefined
        if (rotateAfter) {
          const due = new Date(rotateAfter)
          const diff = Math.floor((Date.now() - due.getTime()) / (24 * 60 * 60 * 1000))
          if (diff > 0) daysOverdue = diff
        } else if (daysOld > defaultDays) {
          daysOverdue = daysOld - defaultDays
        }

        // For overdue only mode, skip if not overdue
        if (overdueOnly && daysOverdue === undefined) continue

        candidates.push({
          key: variable.key,
          environment: env,
          value: variable.value,
          rotatedAt,
          rotateAfter: rotateAfter?.toString(),
          daysOld,
          daysOverdue,
          matchedPattern
        })
      }
    }
  } finally {
    await client.disconnect()
  }

  // Sort by overdue status (most overdue first)
  candidates.sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0))

  const overdue = candidates.filter(c => c.daysOverdue !== undefined)

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project,
      service,
      environments,
      rotationEnabled,
      defaultIntervalDays: defaultDays,
      pattern: pattern || null,
      configPatterns,
      total: candidates.length,
      overdue: overdue.length,
      secrets: candidates.map(cand => ({
        key: cand.key,
        environment: cand.environment,
        daysOld: cand.daysOld,
        daysOverdue: cand.daysOverdue,
        matchedPattern: cand.matchedPattern
      }))
    }))
  } else {
    ui.log(`Rotation workflow: ${c.project(project)}`)
    ui.log('')

    if (overdue.length > 0) {
      ui.log(`⚠️  Secrets requiring rotation (${overdue.length}):`)
      for (const cand of overdue) {
        const envLabel = allEnvs ? ` [${cand.environment}]` : ''
        const overdueLabel = cand.daysOverdue ? `${cand.daysOverdue} days overdue` : `${cand.daysOld} days old`
        const patternLabel = cand.matchedPattern ? ` (matched: ${cand.matchedPattern})` : ''
        ui.log(`  • ${c.key(cand.key)}${envLabel} - ${overdueLabel}${patternLabel}`)
      }
      ui.log('')
      ui.log('To rotate a secret:')
      ui.log(`  ${c.command('vaulter set')} <KEY> "<new-value>" ${c.highlight('-e')} <env>`)
      ui.log('')
      ui.log('The rotatedAt timestamp will be updated automatically.')
    } else {
      ui.success('No secrets require rotation')
    }

    ui.log('')
    ui.log(`Summary: ${overdue.length} overdue, ${candidates.length - overdue.length} up to date`)
  }

  // Exit with non-zero if secrets need rotation (for CI/CD)
  if (failOnRotation && overdue.length > 0) {
    process.exit(1)
  }
}
