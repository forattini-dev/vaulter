/**
 * vaulter_status handler — scorecard | vars | audit | drift | inventory
 */

import type { VaulterClient } from '../../../client.js'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse } from '../config.js'
import {
  buildScorecard,
  computePlan,
  buildInventory,
  readLocalState,
  readProvenance,
  listLocalServices,
  checkGovernance,
  formatScope
} from '../../../domain/index.js'
import { compileGlobPatterns } from '../../../lib/pattern-matcher.js'
import type { ResolvedVariable, CoverageEntry, Inventory } from '../../../domain/types.js'

export async function handleStatus(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const action = (args.action as string) || 'scorecard'

  switch (action) {
    case 'scorecard':
      return handleScorecard(ctx, client, args)
    case 'vars':
      return handleVars(ctx)
    case 'audit':
      return handleAudit(ctx, args)
    case 'drift':
      return handleDrift(ctx, client, args)
    case 'inventory':
      return handleInventory(ctx, client, args)
    default:
      return errorResponse(`Unknown action: ${action}. Valid: scorecard, vars, audit, drift, inventory`)
  }
}

async function handleScorecard(ctx: HandlerContext, client: VaulterClient, args: Record<string, unknown>): Promise<ToolResponse> {
  if (!ctx.configDir) {
    return errorResponse('No .vaulter/ directory found. Run vaulter init first.')
  }

  if (args.offline === true) {
    const localVars = readLocalState(ctx.configDir, ctx.environment, {
      service: ctx.service,
      includeShared: true
    })
    const knownServices = resolveKnownServices(ctx)
    const governance = checkGovernance({
      variables: localVars,
      config: ctx.config,
      environment: ctx.environment,
      knownServices
    })
    const sc = buildScorecard({
      localVars,
      remoteVars: [],
      changes: [],
      governance,
      config: ctx.config,
      environment: ctx.environment,
      knownServices
    })

    const lines: string[] = [
      `## Scorecard (offline): ${ctx.project}/${ctx.environment}`,
      `Backend comparison skipped because offline=true`,
      '',
      `**Health:** ${sc.health}`,
      `**Total vars:** ${sc.totalVars} (${sc.configs} config, ${sc.secrets} secret)`,
      '',
      '### Services'
    ]
    for (const svc of sc.services) {
      const lifecycle = svc.lifecycle !== 'active' ? ` [${svc.lifecycle}]` : ''
      lines.push(`  ${svc.name}${lifecycle}: ${svc.varCount} vars (${svc.sharedCount} shared + ${svc.serviceCount} service)`)
    }
    return textResponse(lines.join('\n'))
  }

  const plan = await computePlan({
    client,
    config: ctx.config,
    configDir: ctx.configDir,
    project: ctx.project,
    environment: ctx.environment,
    service: ctx.service
  })

  const sc = plan.scorecard
  const lines: string[] = [
    `## Scorecard: ${ctx.project}/${ctx.environment}`,
    '',
    `**Health:** ${sc.health}`,
    `**Total vars:** ${sc.totalVars} (${sc.configs} config, ${sc.secrets} secret)`,
    '',
    '### Services'
  ]

  for (const svc of sc.services) {
    const lifecycle = svc.lifecycle !== 'active' ? ` [${svc.lifecycle}]` : ''
    lines.push(`  ${svc.name}${lifecycle}: ${svc.varCount} vars (${svc.sharedCount} shared + ${svc.serviceCount} service)`)
  }

  lines.push('')
  lines.push('### Drift')
  if (sc.drift.synced) {
    lines.push('  ✓ Local and backend are in sync')
  } else {
    if (sc.drift.localOnly > 0) lines.push(`  ${sc.drift.localOnly} local-only`)
    if (sc.drift.remoteOnly > 0) lines.push(`  ${sc.drift.remoteOnly} remote-only`)
    if (sc.drift.conflicts > 0) lines.push(`  ${sc.drift.conflicts} conflicts`)
  }

  if (sc.issues.length > 0) {
    lines.push('')
    lines.push('### Issues')
    for (const issue of sc.issues) {
      const icon = issue.severity === 'error' ? '!!' : issue.severity === 'warning' ? '!' : 'i'
      lines.push(`  [${icon}] ${issue.message}`)
      if (issue.suggestion) lines.push(`    → ${issue.suggestion}`)
    }
  }

  return textResponse(lines.join('\n'))
}

function handleVars(ctx: HandlerContext): ToolResponse {
  if (!ctx.configDir) {
    return errorResponse('No .vaulter/ directory found. Run vaulter init first.')
  }

  const vars = readLocalState(ctx.configDir, ctx.environment, {
    service: ctx.service
  })

  if (vars.length === 0) {
    return textResponse('No local variables found.')
  }

  const lines = [`Local variables (${vars.length}):`, '']
  for (const v of vars) {
    const typeLabel = v.sensitive ? '[secret]' : '[config]'
    lines.push(`  ${v.key} ${typeLabel} [${formatScope(v.scope)}]`)
  }

  return textResponse(lines.join('\n'))
}

function handleAudit(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  if (!ctx.configDir) {
    return errorResponse('No .vaulter/ directory found. Run vaulter init first.')
  }

  const keyFilter = args.pattern as string | undefined
  const limitRaw = args.limit as number | undefined
  const limit = Number.isFinite(limitRaw as number) ? (limitRaw as number) : 20
  const operation = args.operation as
    | 'set'
    | 'delete'
    | 'move'
    | 'rotate'
    | 'rollback'
    | 'clone'
    | 'import'
    | undefined
  const source = args.source as string | undefined
  const since = args.since as string | undefined
  const until = args.until as string | undefined

  const keyMatcher = keyFilter && (keyFilter.includes('*') || keyFilter.includes('?'))
    ? compileGlobPatterns([keyFilter])
    : null

  let entries = readProvenance(ctx.configDir, {
    key: keyMatcher ? undefined : keyFilter,
    operation,
    limit,
    since
  })

  if (source) {
    entries = entries.filter((entry) => entry.source === source)
  }
  if (keyMatcher) {
    entries = entries.filter((entry) => keyMatcher(entry.key))
  }
  if (until) {
    entries = entries.filter((entry) => entry.ts <= until)
  }

  if (entries.length === 0) {
    return textResponse('No audit entries found.')
  }

  const lines = [`Audit log (last ${entries.length}):`, '']
  for (const e of entries) {
    lines.push(`  ${e.ts} | ${e.op.padEnd(8)} | ${e.key} [${e.scope}] by ${e.actor} (${e.source})`)
  }

  return textResponse(lines.join('\n'))
}

async function handleDrift(ctx: HandlerContext, client: VaulterClient, args: Record<string, unknown>): Promise<ToolResponse> {
  if (!ctx.configDir) {
    return errorResponse('No .vaulter/ directory found. Run vaulter init first.')
  }

  if (args.offline === true) {
    const localVars = readLocalState(ctx.configDir, ctx.environment, {
      service: ctx.service,
      includeShared: true
    })
    return textResponse(`Offline mode: ${localVars.length} local variable(s) loaded. Run without offline=true to compare against backend drift.`)
  }

  const plan = await computePlan({
    client,
    config: ctx.config,
    configDir: ctx.configDir,
    project: ctx.project,
    environment: ctx.environment,
    service: ctx.service
  })

  const drift = plan.scorecard.drift
  if (drift.synced) {
    return textResponse(`✓ No drift detected. Local and backend are in sync for ${ctx.environment}.`)
  }

  const lines = [`Drift report for ${ctx.environment}:`, '']
  if (drift.localOnly > 0) lines.push(`  ${drift.localOnly} variable(s) local-only (not in backend)`)
  if (drift.remoteOnly > 0) lines.push(`  ${drift.remoteOnly} variable(s) remote-only (not in local)`)
  if (drift.conflicts > 0) lines.push(`  ${drift.conflicts} variable(s) with different values`)

  if (plan.changes.length > 0) {
    lines.push('')
    lines.push('Changes:')
    for (const c of plan.changes) {
      const icon = c.action === 'add' ? '+' : c.action === 'delete' ? '-' : '~'
      lines.push(`  ${icon} ${c.key} (${formatScope(c.scope)})`)
    }
  }

  return textResponse(lines.join('\n'))
}

async function handleInventory(
  ctx: HandlerContext,
  client: VaulterClient,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const environments = (args.environments as string[])
    || ctx.config?.environments
    || resolveKnownEnvironments(ctx)

  if (args.offline === true) {
    const effectiveEnvs = [ctx.environment]
    const vars = readLocalState(ctx.configDir!, ctx.environment, {
      includeShared: true,
      service: ctx.service
    })
    const inventory = buildOfflineInventory(vars, ctx, effectiveEnvs)
    const lines: string[] = [`## Inventory (offline): ${ctx.project}`, '', `Environments: ${effectiveEnvs.join(', ')}`, '']

    lines.push('### Services')
    for (const svc of inventory.services) {
      lines.push(`  ${svc.name}: ${svc.varCount} vars (${svc.environments.join(', ')})`)
    }
    if (inventory.orphanedVars.length > 0) {
      lines.push('', '### Orphaned Variables')
      for (const orphan of inventory.orphanedVars) {
        lines.push(`  ${orphan.key} [${orphan.scope}] (${orphan.environment})`)
      }
    }
    lines.push('', 'Cross-environment checks are disabled in offline mode.')
    return textResponse(lines.join('\n'))
  }

  const knownServices = ctx.configDir ? listLocalServices(ctx.configDir) : []

  const inventory = await buildInventory({
    client,
    config: ctx.config,
    project: ctx.project,
    environments,
    knownServices
  })

  const lines: string[] = [`## Inventory: ${ctx.project}`, '']

  lines.push('### Services')
  for (const svc of inventory.services) {
    const lifecycle = svc.lifecycle !== 'active' ? ` [${svc.lifecycle}]` : ''
    lines.push(`  ${svc.name}${lifecycle}: ${svc.varCount} vars in [${svc.environments.join(', ')}]`)
  }

  if (inventory.orphanedVars.length > 0) {
    lines.push('')
    lines.push(`### Orphaned Variables (${inventory.orphanedVars.length})`)
    for (const o of inventory.orphanedVars) {
      lines.push(`  ${o.key} [${o.environment}/${formatScope(o.scope)}] — ${o.reason}`)
    }
  }

  if (inventory.missingVars.length > 0) {
    lines.push('')
    lines.push(`### Missing Variables (${inventory.missingVars.length})`)
    for (const m of inventory.missingVars) {
      lines.push(`  ${m.key}: present in [${m.presentIn.join(', ')}], missing from [${m.missingFrom.join(', ')}]`)
    }
  }

  return textResponse(lines.join('\n'))
}

function resolveKnownServices(ctx: HandlerContext): string[] {
  const services = (ctx.config as { services?: Array<string | { name: string }> } | null)?.services
  if (!services) return []
  return services.map((s) => (typeof s === 'string' ? s : s.name))
}

function resolveKnownEnvironments(ctx: HandlerContext): string[] {
  const envs = (ctx.config as { environments?: string[] } | null)?.environments
  if (envs && envs.length > 0) return envs
  return [ctx.environment]
}

function buildOfflineInventory(
  localVars: ResolvedVariable[],
  ctx: HandlerContext,
  environments: string[]
): Inventory {
  const knownServiceSet = new Set(resolveKnownServices(ctx))
  const serviceStats = new Map<string, { environmentSet: Set<string>; varCount: number }>()
  const orphanedVars = [] as Inventory['orphanedVars']
  const coverageMap = new Map<string, CoverageEntry>()

  const firstEnv = environments[0] || ctx.environment

  for (const variable of localVars) {
    const serviceName = variable.scope.kind === 'shared' ? 'shared' : variable.scope.name
    const stats = serviceStats.get(serviceName) || { environmentSet: new Set<string>(), varCount: 0 }
    stats.varCount += 1
    stats.environmentSet.add(firstEnv)
    serviceStats.set(serviceName, stats)

    const identity = `${variable.key}|${formatScope(variable.scope)}`
    const existing = coverageMap.get(identity)
    if (!existing) {
      coverageMap.set(identity, {
        key: variable.key,
        scope: variable.scope,
        environments: { [firstEnv]: true }
      })
    } else {
      existing.environments[firstEnv] = true
    }

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
      lifecycle: name === 'shared' || knownServiceSet.size === 0 || knownServiceSet.has(name)
        ? 'active' as const
        : 'orphan' as const,
      varCount: stat.varCount,
      sharedCount: 0,
      serviceCount: name === 'shared' ? 0 : stat.varCount,
      environments: Array.from(stat.environmentSet).sort()
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
    coverageMatrix: Array.from(coverageMap.values()).sort((a, b) => a.key.localeCompare(b.key))
  }
}
