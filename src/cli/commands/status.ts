/**
 * Vaulter `status` Command
 *
 * Unified status with subcommands:
 *   status               Show scorecard (default)
 *   status vars -e env   List variables
 *   status audit         Audit trail (forwards to audit command)
 *   status drift -e env  Local vs backend drift
 *   status inventory     Orphans, missing, coverage
 *
 * Usage:
 *   vaulter status                         Scorecard for default environment
 *   vaulter status -e prd                  Scorecard for production
 *   vaulter status vars -e dev --values    List all vars with values
 *   vaulter status drift -e dev            Show drift status
 *   vaulter status inventory               Cross-environment inventory
 *   vaulter status --json                  JSON output
 */

import type { VarContext } from './change.js'
import { findConfigDir } from '../../lib/config-loader.js'
import { withClient } from '../lib/create-client.js'
import { computePlan } from '../../domain/plan.js'
import { buildInventory } from '../../domain/inventory.js'
import { buildScorecard, checkGovernance } from '../../domain/index.js'
import { readLocalState, readProvenance } from '../../domain/state.js'
import { compileGlobPatterns } from '../../lib/pattern-matcher.js'
import { formatScope } from '../../domain/types.js'
import type { Scorecard, Inventory, CoverageEntry, ResolvedVariable } from '../../domain/types.js'
import { c, symbols, print } from '../lib/colors.js'
import { maskValueBySensitivity } from '../../lib/masking.js'
import * as ui from '../ui.js'

// ============================================================================
// Status Command Router
// ============================================================================

export async function runStatus(context: VarContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1] as string | undefined

  switch (subcommand) {
    case 'vars':
    case 'variables':
      await runStatusVars(context)
      break

    case 'audit':
      await runStatusAudit(context)
      break

    case 'drift':
      await runStatusDrift(context)
      break

    case 'inventory':
    case 'inv':
      await runStatusInventory(context)
      break

  case 'scorecard':
  default:
    await runStatusScorecard(context)
    break
  }
}

// ============================================================================
// Scorecard (default)
// ============================================================================

async function runStatusScorecard(context: VarContext): Promise<void> {
  const { args, config, project, environment, service, verbose, jsonOutput } = context

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found. Run "vaulter init" first.')
    process.exit(1)
  }

  const knownServices = resolveKnownServices(config)
  let scorecard: Scorecard

  if (args.offline) {
    // Local-first mode: scorecard from local filesystem state only
    const localVars = readLocalState(configDir, environment, {
      service,
      includeShared: true
    })
    const governance = checkGovernance({
      variables: localVars,
      config,
      environment,
      knownServices
    })
    scorecard = buildScorecard({
      localVars,
      remoteVars: [],
      changes: [],
      governance,
      config,
      environment,
      knownServices
    })
  } else {
    // Build scorecard via plan computation (lighter path — no artifact)
    scorecard = await withClient(
      { args, config, project, environment, verbose },
      async (client) => {
        const plan = await computePlan({
          client,
          config,
          configDir,
          project,
          environment,
          service
        })
        return plan.scorecard
      }
    )
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project,
      environment,
      scorecard
    }, null, 2))
    return
  }

  displayScorecard(scorecard, project, environment)

  if (Boolean(context.args.ci) && scorecard.health !== 'ok') {
    process.exitCode = 1
  }
}

// ============================================================================
// Scorecard Display
// ============================================================================

function displayScorecard(scorecard: Scorecard, project: string, environment: string): void {
  ui.log('')
  ui.log(c.header(`Status: ${project} / ${environment}`))
  ui.log('')

  // Variables overview
  ui.log(`  ${c.bold('Variables')}`)
  ui.log(`    Total:   ${scorecard.totalVars}`)
  ui.log(`    Secrets: ${scorecard.secrets}`)
  ui.log(`    Configs: ${scorecard.configs}`)
  ui.log('')

  // Services
  if (scorecard.services.length > 0) {
    ui.log(`  ${c.bold('Services')}`)
    for (const svc of scorecard.services) {
      const lifecycleTag = svc.lifecycle === 'orphan'
        ? c.warning(' [orphan]')
        : svc.lifecycle === 'deprecated'
          ? c.muted(' [deprecated]')
          : ''
      ui.log(`    ${svc.name}: ${svc.varCount} vars (${svc.sharedCount} shared + ${svc.serviceCount} service)${lifecycleTag}`)
    }
    ui.log('')
  }

  // Drift
  ui.log(`  ${c.bold('Drift')}`)
  if (scorecard.drift.synced) {
    ui.log(`    ${symbols.success} In sync`)
  } else {
    if (scorecard.drift.localOnly > 0) {
      ui.log(`    ${c.success(`+${scorecard.drift.localOnly}`)} local-only`)
    }
    if (scorecard.drift.remoteOnly > 0) {
      ui.log(`    ${c.warning(`${scorecard.drift.remoteOnly}`)} remote-only`)
    }
    if (scorecard.drift.conflicts > 0) {
      ui.log(`    ${c.error(`~${scorecard.drift.conflicts}`)} conflicts`)
    }
  }
  ui.log('')

  // Policy
  if (scorecard.policy.warnings > 0 || scorecard.policy.violations > 0) {
    ui.log(`  ${c.bold('Policy')}`)
    if (scorecard.policy.violations > 0) {
      ui.log(`    ${c.error(`${scorecard.policy.violations} violation(s)`)}`)
    }
    if (scorecard.policy.warnings > 0) {
      ui.log(`    ${c.warning(`${scorecard.policy.warnings} warning(s)`)}`)
    }
    ui.log('')
  }

  // Required
  if (scorecard.required.missing.length > 0) {
    ui.log(`  ${c.bold('Required Variables')}`)
    ui.log(`    ${c.error(`${scorecard.required.missing.length} missing:`)} ${scorecard.required.missing.join(', ')}`)
    ui.log('')
  }

  // Rotation
  if (scorecard.rotation.overdue > 0) {
    ui.log(`  ${c.bold('Rotation')}`)
    ui.log(`    ${c.warning(`${scorecard.rotation.overdue} overdue`)}`)
    for (const rk of scorecard.rotation.keys) {
      ui.log(`    ${c.muted('•')} ${rk.key} (last: ${rk.lastRotated}, max: ${rk.maxAgeDays}d)`)
    }
    ui.log('')
  }

  // Issues
  if (scorecard.issues.length > 0) {
    ui.log(`  ${c.bold('Issues')}`)
    for (const issue of scorecard.issues) {
      const icon = issue.severity === 'error'
        ? symbols.error
        : issue.severity === 'warning'
          ? symbols.warning
          : symbols.info
      ui.log(`    ${icon} ${issue.message}`)
      if (issue.suggestion) {
        ui.log(`      ${c.muted('→')} ${c.muted(issue.suggestion)}`)
      }
    }
    ui.log('')
  }

  // Health
  const healthIcon = scorecard.health === 'ok'
    ? c.success('OK')
    : scorecard.health === 'warning'
      ? c.warning('WARNING')
      : c.error('CRITICAL')
  ui.log(`  Health: ${healthIcon}`)
  ui.log('')
}

// ============================================================================
// status vars — list variables
// ============================================================================

async function runStatusVars(context: VarContext): Promise<void> {
  const { args, environment, service, project, jsonOutput } = context
  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found. Run "vaulter init" first.')
    process.exit(1)
  }

  const localVars = readLocalState(configDir, environment, {
    service: args.shared ? undefined : service,
    includeShared: true
  }).filter(v => args.shared ? v.scope.kind === 'shared' : true)

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project,
      environment,
      service: args.shared ? 'shared' : service || 'all',
      includeShared: args.shared ? false : true,
      count: localVars.length,
      variables: localVars.map(v => ({
        key: v.key,
        value: v.value,
        environment: v.environment,
        scope: formatScope(v.scope),
        sensitive: v.sensitive
      }))
    }, null, 2))
    return
  }

  if (localVars.length === 0) {
    ui.log(`${symbols.info} ${c.muted('No local variables found')}`)
    return
  }

  const showValues = args.verbose || args['values'] || false
  const tableData = localVars
    .slice()
    .sort((a, b) => {
      if (a.scope.kind !== b.scope.kind) {
        return a.scope.kind === 'shared' ? -1 : 1
      }
      const serviceA = a.scope.kind === 'service' ? a.scope.name : ''
      const serviceB = b.scope.kind === 'service' ? b.scope.name : ''
      if (serviceA !== serviceB) return serviceA.localeCompare(serviceB)
      return a.key.localeCompare(b.key)
    })
    .map((v) => ({
      scope: v.scope.kind === 'shared' ? c.muted('shared') : c.service(v.scope.name),
      type: v.sensitive ? c.secretType('secret') : c.configType('config'),
      key: c.key(v.key),
      value: showValues
        ? v.value
        : maskValueBySensitivity(v.value, v.sensitive || false)
    }))

  ui.log('')
  ui.log(c.header(`Variables: ${project} / ${environment}`))
  ui.log(`  ${c.muted('Scope:')} ${args.shared ? 'shared only' : service ? `service ${service}` : 'all services + shared'}`)
  ui.log(`  ${c.muted('Count:')} ${String(localVars.length)}`)
  ui.log('')
  ui.output(ui.formatTable(
    [
      { key: 'scope', header: 'SCOPE' },
      { key: 'type', header: 'TYPE' },
      { key: 'key', header: 'KEY' },
      { key: 'value', header: 'VALUE' }
    ],
    tableData
  ))
  ui.log('')
}

// ============================================================================
// status audit — audit trail
// ============================================================================

async function runStatusAudit(context: VarContext): Promise<void> {
  const { args, project, environment, config, jsonOutput } = context
  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found. Run "vaulter init" first.')
    process.exit(1)
  }
  if (!config) {
    print.error('Config not found. Run "vaulter init" first.')
    process.exit(1)
  }

  const keyFilter = args.pattern as string | undefined
  const limitRaw = args.limit
  const limit = Number.isFinite(limitRaw as number) ? (limitRaw as number) : 50
  const until = args.until as string | undefined
  const source = args.source as string | undefined
  const operation = args.operation as
    | 'set'
    | 'delete'
    | 'move'
    | 'rotate'
    | 'rollback'
    | 'clone'
    | 'import'
    | undefined
  const since = args.since as string | undefined

  const keyPattern = keyFilter && (keyFilter.includes('*') || keyFilter.includes('?'))
    ? compileGlobPatterns([keyFilter])
    : null

  let entries = readProvenance(configDir, {
    key: keyPattern ? undefined : keyFilter,
    operation,
    scope: args.shared ? 'shared' : undefined,
    since,
    limit
  })

  if (source) {
    entries = entries.filter((entry) => entry.source === source)
  }
  if (keyPattern) {
    entries = entries.filter((entry) => keyPattern(entry.key))
  }
  if (until) {
    entries = entries.filter((entry) => entry.ts <= until)
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project,
      environment,
      count: entries.length,
      entries
    }, null, 2))
    return
  }

  if (entries.length === 0) {
    ui.log(`${symbols.info} ${c.muted('No audit entries found')}`)
    return
  }

  ui.log('')
  ui.log(c.header(`Audit: ${project} / ${environment}`))
  ui.log('')
  ui.output(
    ui.formatTable(
      [
        { key: 'time', header: 'TIMESTAMP' },
        { key: 'op', header: 'OP' },
        { key: 'key', header: 'KEY' },
        { key: 'scope', header: 'SCOPE' },
        { key: 'actor', header: 'ACTOR' },
        { key: 'source', header: 'SOURCE' }
      ],
      entries.map((entry) => ({
        time: entry.ts,
        op: entry.op,
        key: c.key(entry.key),
        scope: entry.scope,
        actor: entry.actor,
        source: entry.source
      }))
    )
  )
  ui.log('')
}

// ============================================================================
// status drift — local vs backend drift
// ============================================================================

async function runStatusDrift(context: VarContext): Promise<void> {
  const { args, config, project, environment, service, verbose, jsonOutput } = context

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found. Run "vaulter init" first.')
    process.exit(1)
  }

  if (args.offline) {
    const localVars = readLocalState(configDir, environment, {
      service,
      includeShared: true
    })
    const governance = checkGovernance({
      variables: localVars,
      config,
      environment,
      knownServices: resolveKnownServices(config)
    })
    const scorecard = buildScorecard({
      localVars,
      remoteVars: [],
      changes: [],
      governance,
      config,
      environment,
      knownServices: resolveKnownServices(config)
    })

    if (jsonOutput) {
      ui.output(JSON.stringify({
        project,
        environment,
        mode: 'offline',
        drift: scorecard.drift,
        localOnly: localVars.length,
        issues: [
          {
            message: 'Backend diff unavailable in --offline mode. Run status drift without --offline to compare against remote.',
            severity: 'info'
          }
        ]
      }, null, 2))
      return
    }

    ui.log('')
    ui.log(c.header(`Drift: ${project} / ${environment} (offline)`))
    ui.log(`  ${c.muted('Backend comparison unavailable in offline mode.')}`)
    ui.log(`  ${c.muted('Local variables:')} ${localVars.length}`)
    ui.log('')
    ui.log(`  ${symbols.info} Run ${c.command('vaulter status drift')} -e ${environment} without --offline to compute real drift.`)
    ui.log('')
    return
  }

  const plan = await withClient(
    { args, config, project, environment, verbose },
    async (client) => {
      return computePlan({
        client,
        config,
        configDir,
        project,
        environment,
        service
      })
    }
  )

  const { drift } = plan.scorecard

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project,
      environment,
      drift,
      summary: plan.summary,
      changes: plan.changes.map(ch => ({
        ...ch,
        localValue: ch.sensitive ? '***' : ch.localValue,
        remoteValue: ch.sensitive ? '***' : ch.remoteValue,
        scope: formatScope(ch.scope)
      }))
    }, null, 2))
    return
  }

  ui.log('')
  ui.log(c.header(`Drift: ${project} / ${environment}`))
  ui.log('')

  if (drift.synced) {
    ui.log(`  ${symbols.success} Local and backend are in sync.`)
    ui.log('')
    return
  }

  // Summary
  if (drift.localOnly > 0) {
    ui.log(`  ${c.success(`+${drift.localOnly}`)} exist locally but not in backend`)
  }
  if (drift.remoteOnly > 0) {
    ui.log(`  ${c.warning(`${drift.remoteOnly}`)} exist in backend but not locally`)
  }
  if (drift.conflicts > 0) {
    ui.log(`  ${c.error(`~${drift.conflicts}`)} have different values`)
  }
  ui.log('')

  // Change details
  if (plan.changes.length > 0) {
    for (const change of plan.changes) {
      const scopeLabel = c.muted(`(${formatScope(change.scope)})`)
      switch (change.action) {
        case 'add':
          ui.log(`  ${c.success('+')} ${change.key} ${scopeLabel} ${c.muted('(local only)')}`)
          break
        case 'update':
          ui.log(`  ${c.warning('~')} ${change.key} ${scopeLabel} ${c.muted('(values differ)')}`)
          break
        case 'delete':
          ui.log(`  ${c.error('-')} ${change.key} ${scopeLabel} ${c.muted('(remote only)')}`)
          break
      }
    }
    ui.log('')
  }

  // Guidance
  if (drift.localOnly > 0 || drift.conflicts > 0) {
    ui.log(`  ${symbols.info} Run ${c.command('vaulter plan')} -e ${environment} to review, then ${c.command('vaulter apply')} to push.`)
  }
  if (drift.remoteOnly > 0) {
    ui.log(`  ${symbols.info} Run ${c.command('vaulter apply')} -e ${environment} ${c.muted('--prune')} to remove remote-only vars.`)
  }
  ui.log('')

  if (Boolean(context.args.ci) && !drift.synced) {
    process.exitCode = 1
  }
}

// ============================================================================
// status inventory — cross-environment inventory
// ============================================================================

async function runStatusInventory(context: VarContext): Promise<void> {
  const { args, config, project, verbose, jsonOutput } = context

  // Determine environments to scan
  const envsArg = args.envs || args.environments
  const environments = envsArg
    ? String(envsArg).split(',').map(s => s.trim()).filter(Boolean)
    : resolveEnvironmentsWithFallback(config, context.environment)
  if (environments.length === 0) {
    print.error('No environments found. Specify with --envs dev,stg,prd or configure environments in .vaulter/config.yaml.')
    process.exit(1)
  }

  const effectiveEnvs = args.offline ? [context.environment] : environments
  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found. Run "vaulter init" first.')
    process.exit(1)
  }

  if (args.offline) {
    const localVars = readLocalState(configDir, context.environment, {
      includeShared: true,
      service: context.service
    })
    const inventory = buildOfflineInventory(localVars, config, effectiveEnvs)

    if (jsonOutput) {
      ui.output(JSON.stringify({
        project,
        environment: context.environment,
        mode: 'offline',
        inventory: {
          ...inventory,
          orphanedVars: inventory.orphanedVars,
          missingVars: inventory.missingVars,
          coverageMatrix: inventory.coverageMatrix
        }
      }, null, 2))
      return
    }

    displayInventory(inventory, project, effectiveEnvs)
    ui.log(c.warning('Inventory in --offline mode is local-only; cross-environment checks were skipped.'))
    return
  }

  const knownServices = resolveKnownServices(config)

  const inventory = await withClient(
    { args, config, project, environment: environments[0], verbose },
    async (client) => {
      return buildInventory({
        client,
        config,
        project,
        environments,
        knownServices
      })
    }
  )

  if (jsonOutput) {
    ui.output(JSON.stringify({
      project,
      environments,
      inventory: {
        ...inventory,
        orphanedVars: inventory.orphanedVars.map(v => ({
          ...v,
          scope: formatScope(v.scope)
        })),
        missingVars: inventory.missingVars.map(v => ({
          ...v,
          scope: formatScope(v.scope)
        })),
        coverageMatrix: inventory.coverageMatrix.map(v => ({
          ...v,
          scope: formatScope(v.scope)
        }))
      }
    }, null, 2))
    return
  }

  displayInventory(inventory, project, environments)

  if (Boolean(context.args.ci) && (
    inventory.orphanedVars.length > 0 ||
    inventory.missingVars.length > 0
  )) {
    process.exitCode = 1
  }
}

function displayInventory(inventory: Inventory, project: string, environments: string[]): void {
  ui.log('')
  ui.log(c.header(`Inventory: ${project}`))
  ui.log(`  ${c.muted('Environments:')} ${environments.join(', ')}`)
  ui.log('')

  // Services
  if (inventory.services.length > 0) {
    ui.log(`  ${c.bold('Services')}`)
    for (const svc of inventory.services) {
      const lifecycleTag = svc.lifecycle === 'orphan'
        ? c.warning(' [orphan]')
        : ''
      const envList = svc.environments.length > 0
        ? c.muted(` (${svc.environments.join(', ')})`)
        : c.muted(' (no vars)')
      ui.log(`    ${svc.name}: ${svc.varCount} vars${envList}${lifecycleTag}`)
    }
    ui.log('')
  }

  // Orphans
  if (inventory.orphanedVars.length > 0) {
    ui.log(`  ${c.bold('Orphaned Variables')}`)
    for (const orphan of inventory.orphanedVars) {
      ui.log(`    ${symbols.warning} ${orphan.key} (${formatScope(orphan.scope)}, ${orphan.environment}) — ${orphan.reason}`)
    }
    ui.log('')
  }

  // Missing
  if (inventory.missingVars.length > 0) {
    ui.log(`  ${c.bold('Missing Variables')}`)
    for (const missing of inventory.missingVars) {
      ui.log(`    ${symbols.warning} ${missing.key} (${formatScope(missing.scope)})`)
      ui.log(`      ${c.muted('Present in:')} ${missing.presentIn.join(', ')}`)
      ui.log(`      ${c.muted('Missing from:')} ${missing.missingFrom.join(', ')}`)
    }
    ui.log('')
  }

  // Summary
  const totalVars = inventory.coverageMatrix.length
  const fullCoverage = inventory.coverageMatrix.filter(
    e => Object.values(e.environments).every(v => v)
  ).length
  ui.log(`  ${c.bold('Coverage')}: ${fullCoverage}/${totalVars} variables exist in all environments`)

  if (inventory.orphanedVars.length === 0 && inventory.missingVars.length === 0) {
    ui.log(`  ${symbols.success} No orphans or missing variables detected.`)
  }
  ui.log('')
}

// ============================================================================
// Helpers
// ============================================================================

function resolveEnvironmentsWithFallback(
  config: VarContext['config'],
  fallbackEnvironment?: string
): string[] {
  if (!config) return []

  const envs = (config as unknown as Record<string, unknown>).environments as string[] | undefined
  if (envs && Array.isArray(envs) && envs.length > 0) return envs

  if (fallbackEnvironment) return [fallbackEnvironment]

  return []
}

function resolveKnownServices(config: VarContext['config']): string[] {
  if (!config) return []

  const services = (config as unknown as Record<string, unknown>).services as
    Array<string | { name: string }> | undefined
  if (!services || !Array.isArray(services)) return []

  return services.map(s => typeof s === 'string' ? s : s.name)
}

function buildOfflineInventory(
  localVars: ResolvedVariable[],
  config: VarContext['config'],
  environments: string[]
): Inventory {
  const knownServices = resolveKnownServices(config)
  const knownServiceSet = new Set(knownServices)
  const targetEnvs = environments.length > 0 ? environments : ['local']

  const serviceStats = new Map<string, { environmentSet: Set<string>; varCount: number }>()
  const orphanedVars = [] as Inventory['orphanedVars']
  const coverageMap = new Map<string, CoverageEntry>()

  const firstEnv = targetEnvs[0]
  if (!firstEnv) {
    return {
      services: [],
      orphanedVars: [],
      missingVars: [],
      coverageMatrix: []
    }
  }

  for (const variable of localVars) {
    const serviceName = variable.scope.kind === 'shared'
      ? 'shared'
      : variable.scope.name

    const stats = serviceStats.get(serviceName) || { environmentSet: new Set<string>(), varCount: 0 }
    stats.varCount += 1
    stats.environmentSet.add(firstEnv)
    serviceStats.set(serviceName, stats)

    const identity = `${variable.key}|${formatScope(variable.scope)}`
    const existing = coverageMap.get(identity)
    if (existing) {
      existing.environments[firstEnv] = true
      continue
    }
    coverageMap.set(identity, {
      key: variable.key,
      scope: variable.scope,
      environments: { [firstEnv]: true }
    })

    if (variable.scope.kind === 'service' && !knownServiceSet.has(variable.scope.name)) {
      orphanedVars.push({
        key: variable.key,
        environment: firstEnv,
        scope: variable.scope,
        reason: 'unknown_service',
        suggestion: 'investigate'
      })
    }
  }

  const services = Array.from(serviceStats.entries())
    .map(([name, stat]) => ({
      name,
      lifecycle: name === 'shared' || !knownServiceSet.size || knownServiceSet.has(name)
        ? 'active' as const
        : 'orphan' as const,
      varCount: stat.varCount,
      environments: Array.from(stat.environmentSet).sort(),
      sharedCount: 0,
      serviceCount: name === 'shared' ? 0 : stat.varCount
    } as Inventory['services'][number]))
    .sort((a, b) => {
      if (a.name === 'shared') return -1
      if (b.name === 'shared') return 1
      return a.name.localeCompare(b.name)
    })

  for (const name of knownServiceSet) {
    if (!serviceStats.has(name)) {
      services.push({
        name,
        lifecycle: 'active',
        varCount: 0,
        environments: []
      })
    }
  }

  return {
    services,
    orphanedVars,
    missingVars: [],
    coverageMatrix: Array.from(coverageMap.values())
      .sort((a, b) => a.key.localeCompare(b.key))
  }
}
