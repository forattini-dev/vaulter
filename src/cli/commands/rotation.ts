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

    default:
      console.error('Usage: vaulter rotation <subcommand>')
      console.error('')
      console.error('Subcommands:')
      console.error('  check, status   Check which secrets need rotation')
      console.error('  set KEY         Set rotation policy for a secret')
      console.error('  list, ls        List secrets with rotation policies')
      process.exit(1)
  }
}

/**
 * Check which secrets need rotation
 */
async function runRotationCheck(context: RotationContext): Promise<void> {
  const { args, config, project, service, environment, verbose, jsonOutput } = context

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "vaulter init" or specify --project')
    process.exit(1)
  }

  const allEnvs = args['all-envs']
  const defaultDays = args.days || config?.encryption?.rotation?.interval_days || 90
  const environments = allEnvs && config
    ? getValidEnvironments(config)
    : [environment]

  if (verbose) {
    console.error(`Checking secrets older than ${defaultDays} days`)
    console.error(`Environments: ${environments.join(', ')}`)
  }

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
    console.log(JSON.stringify({
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
    console.log(`Rotation check for ${project}/${environments.join(', ')}`)
    console.log(`Default rotation interval: ${defaultDays} days`)
    console.log('')

    if (needingRotation.length > 0) {
      console.log(`⚠️  Secrets needing rotation (${needingRotation.length}):`)
      for (const s of needingRotation) {
        const envLabel = allEnvs ? ` [${s.environment}]` : ''
        const ageLabel = s.daysOld === Infinity ? 'never rotated' : `${s.daysOld} days old`
        console.log(`  • ${s.key}${envLabel} - ${ageLabel}`)
      }
      console.log('')
    }

    if (upToDate.length > 0 && verbose) {
      console.log(`✓ Secrets up to date (${upToDate.length}):`)
      for (const s of upToDate) {
        const envLabel = allEnvs ? ` [${s.environment}]` : ''
        const dueLabel = s.daysUntilDue !== undefined
          ? `due in ${s.daysUntilDue} days`
          : `${s.daysOld} days old`
        console.log(`  • ${s.key}${envLabel} - ${dueLabel}`)
      }
      console.log('')
    }

    console.log(`Summary: ${needingRotation.length} need rotation, ${upToDate.length} up to date`)
  }
}

/**
 * Set rotation policy for a secret
 */
async function runRotationSet(context: RotationContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  const key = args._[2]
  if (!key) {
    console.error('Error: Key name is required')
    console.error('Usage: vaulter rotation set <key> --interval 90d')
    process.exit(1)
  }

  if (!project) {
    console.error('Error: Project not specified and no config found')
    console.error('Run "vaulter init" or specify --project')
    process.exit(1)
  }

  const intervalStr = args.interval
  const clear = args.clear

  if (!intervalStr && !clear) {
    console.error('Error: Either --interval or --clear is required')
    console.error('Usage: vaulter rotation set <key> --interval 90d')
    console.error('       vaulter rotation set <key> --clear')
    process.exit(1)
  }

  let intervalDays: number | null = null
  if (intervalStr) {
    intervalDays = parseDuration(intervalStr)
    if (intervalDays === null) {
      console.error(`Error: Invalid interval format: ${intervalStr}`)
      console.error('Valid formats: 30d (days), 4w (weeks), 3m (months), 1y (year)')
      process.exit(1)
    }
  }

  if (verbose) {
    if (clear) {
      console.error(`Clearing rotation policy for ${key}`)
    } else {
      console.error(`Setting rotation interval for ${key}: ${intervalDays} days`)
    }
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
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
        console.log(`Dry run - would clear rotation policy for ${key}`)
      } else {
        console.log(`Dry run - would set rotation interval for ${key}: ${intervalDays} days`)
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
      console.error(`Error: Variable ${key} not found`)
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
      console.log(JSON.stringify({
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
        console.log(`✓ Cleared rotation policy for ${key}`)
      } else {
        console.log(`✓ Set rotation policy for ${key}`)
        console.log(`  Interval: ${intervalDays} days`)
        console.log(`  Next rotation due: ${rotateAfter!.toISOString().split('T')[0]}`)
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
    console.error('Error: Project not specified and no config found')
    console.error('Run "vaulter init" or specify --project')
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
    console.log(JSON.stringify({
      project,
      service,
      environments,
      total: results.length,
      policies: results
    }))
  } else {
    if (results.length === 0) {
      console.log('No secrets with rotation policies found.')
      console.log('')
      console.log('Set a rotation policy with:')
      console.log('  vaulter rotation set <key> --interval 90d')
    } else {
      console.log(`Secrets with rotation policies (${results.length}):`)
      console.log('')

      // Sort by days until due
      results.sort((a, b) => (a.daysUntilDue ?? Infinity) - (b.daysUntilDue ?? Infinity))

      for (const policy of results) {
        const envLabel = allEnvs ? ` [${policy.environment}]` : ''
        const status = policy.daysUntilDue !== undefined
          ? (policy.daysUntilDue < 0 ? '⚠️  OVERDUE' : `due in ${policy.daysUntilDue} days`)
          : 'no due date'
        console.log(`  • ${policy.key}${envLabel} - ${status}`)
        if (verbose && policy.rotateAfter) {
          console.log(`      Due: ${policy.rotateAfter.split('T')[0]}`)
          if (policy.rotatedAt) {
            console.log(`      Last rotated: ${policy.rotatedAt.split('T')[0]}`)
          }
        }
      }
    }
  }
}
