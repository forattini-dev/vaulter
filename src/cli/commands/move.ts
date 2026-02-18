/**
 * Vaulter CLI - Move Command
 *
 * Move/copy a variable between scopes in one operation.
 * Supports shared ↔ service and service ↔ service transitions.
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { withClient } from '../lib/create-client.js'
import {
  collectScopePolicyIssues,
  formatScopePolicySummary,
  getScopeLabelFromParsed,
  getScopePolicyMode,
  hasBlockingPolicyIssues,
  parseScopeSpec
} from '../../lib/scope-policy.js'
import { createConnectedAuditLogger, logDeleteOperation, logSetOperation, disconnectAuditLogger } from '../lib/audit-helper.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import { SHARED_SERVICE } from '../../lib/shared.js'
import * as ui from '../ui.js'

interface MoveContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

function resolveScope(
  spec: string | undefined,
  fallback?: string
): { mode: 'shared' | 'service'; service?: string } | null {
  const parsed = parseScopeSpec(spec)
  if (parsed) return parsed
  if (!spec && fallback) {
    return { mode: 'service', service: fallback }
  }
  return null
}

/**
 * Run the move/copy command
 */
export async function runMove(context: MoveContext): Promise<void> {
  const { args, config, project, environment, verbose, dryRun, jsonOutput } = context
  const key = args._[1]
  const fromRaw = args.from
  const toRaw = args.to
  const overwrite = args.overwrite === true
  const deleteOriginal = args.deleteOriginal !== false

  if (!project) {
    print.error('Project not specified and no config found')
    ui.log(`Run "${c.command('vaulter init')}" or specify ${c.highlight('--project')}`)
    process.exit(1)
  }

  if (!key) {
    print.error('Key name is required')
    ui.log(`${c.label('Usage:')} ${c.command('vaulter var move')} ${c.key('<key>')} ${c.highlight('--from')} ${c.muted('<scope>')} ${c.highlight('--to')} ${c.muted('<scope>')}`)
    ui.log(`${c.label('Hint:')} ${c.muted('shared')} or ${c.muted('service:<name>')}`)
    process.exit(1)
  }

  if (!fromRaw || !toRaw) {
    print.error('Both --from and --to are required')
    ui.log(`Example: ${c.command('vaulter var move API_KEY --from svc-notifications --to shared')}`)
    ui.log(`Example: ${c.command('vaulter var move API_KEY --from shared --to svc-notifications')}`)
    process.exit(1)
  }

  const fromScope = resolveScope(fromRaw)
  const toScope = resolveScope(toRaw)
  if (!fromScope || !toScope) {
    print.error('Invalid scope format. Use shared or service:<name>')
    process.exit(1)
  }

  if (fromScope.mode === toScope.mode) {
    if (fromScope.mode === 'shared') {
      print.error('Source and destination are both shared')
      process.exit(1)
    }
    if (fromScope.service === toScope.service) {
      print.error('Source and destination are the same scope')
      process.exit(1)
    }
  }

  const sourceService = fromScope.mode === 'shared' ? SHARED_SERVICE : fromScope.service
  const targetService = toScope.mode === 'shared' ? SHARED_SERVICE : toScope.service
  const sourceLabel = getScopeLabelFromParsed(fromScope)
  const targetLabel = getScopeLabelFromParsed(toScope)
  const action = deleteOriginal ? 'move' : 'copy'
  const actionPast = deleteOriginal ? 'moved' : 'copied'

  const policyChecks = collectScopePolicyIssues([key], {
    scope: toScope.mode,
    service: targetService === SHARED_SERVICE ? undefined : targetService,
    policyMode: getScopePolicyMode()
  })
  const policyIssues = policyChecks.flatMap(check => check.issues)
  if (policyIssues.length > 0) {
    print.warning('Scope policy check:')
    print.warning(formatScopePolicySummary(policyIssues))

    if (hasBlockingPolicyIssues(policyChecks)) {
      print.error('Scope policy blocked this change.')
      ui.log('Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to continue.')
      process.exit(1)
    }
  }

  const auditLogger = await createConnectedAuditLogger(config, project, environment, verbose)

  try {
    await withClient({ args, config, project, verbose }, async (client) => {
      const sourceVar = await client.get(key, project, environment, sourceService)
      if (!sourceVar) {
        if (jsonOutput) {
          ui.output(JSON.stringify({ error: 'not_found', key, from: sourceLabel }))
        } else {
          print.error(`Variable ${c.key(key)} not found in ${sourceLabel}`)
        }
        process.exit(1)
      }

      const destinationVar = await client.get(key, project, environment, targetService)
      if (destinationVar && !overwrite) {
        if (jsonOutput) {
          ui.output(JSON.stringify({
            error: 'destination_exists',
            key,
            from: sourceLabel,
            to: targetLabel
          }))
        } else {
          print.error(`Destination ${c.key(key)} already exists in ${targetLabel}. Use --overwrite to replace it.`)
        }
        process.exit(1)
      }

      const dryRunSource = deleteOriginal ? sourceLabel : `${sourceLabel} (source kept)`
      if (dryRun) {
        const payload = {
          action,
          key,
          from: sourceLabel,
          to: targetLabel,
          project,
          environment,
          overwrite,
          deleteOriginal
        }
        if (jsonOutput) {
          ui.output(JSON.stringify({ ...payload, dryRun: true }))
        } else {
          ui.log(`${symbols.info} ${action} ${c.key(key)} from ${c.env(dryRunSource)} to ${c.env(targetLabel)}`)
          ui.log(`Environment: ${c.project(project)}/${colorEnv(environment)}`)
          if (overwrite && destinationVar) ui.log(c.warning('Will overwrite existing destination value'))
          if (!deleteOriginal) ui.log(c.muted('Copy mode: source value preserved'))
        }
        return
      }

      const previousTarget = destinationVar?.value
      await client.set({
        key,
        value: sourceVar.value,
        project,
        environment,
        service: targetService,
        tags: sourceVar.tags,
        sensitive: sourceVar.sensitive,
        metadata: {
          ...sourceVar.metadata,
          source: 'manual',
          movedFrom: sourceLabel,
          movedTo: targetLabel,
          movedAt: new Date().toISOString(),
          moveAction: action
        }
      })
      await logSetOperation(auditLogger, {
        key,
        previousValue: previousTarget,
        newValue: sourceVar.value,
        project,
        environment,
        service: targetService,
        source: 'cli',
        metadata: {
          movedFrom: sourceLabel,
          movedTo: targetLabel,
          overwrite,
          deleteOriginal
        }
      })

      if (deleteOriginal) {
        await client.delete(key, project, environment, sourceService)
        await logDeleteOperation(auditLogger, {
          key,
          previousValue: sourceVar.value,
          project,
          environment,
          service: sourceService,
          source: 'cli',
          metadata: {
            movedTo: targetLabel,
            movedAt: new Date().toISOString()
          }
        })
      }

      if (jsonOutput) {
        ui.output(JSON.stringify({
          success: true,
          action: actionPast,
          key,
          from: sourceLabel,
          to: targetLabel,
          project,
          environment,
          deleteOriginal,
          overwrite,
          value: sourceVar.value
        }))
      } else {
        const actionVerb = deleteOriginal ? 'Moved' : 'Copied'
        ui.success(`${actionVerb} ${c.key(key)} from ${c.env(sourceLabel)} to ${c.env(targetLabel)} in ${c.project(project)}/${colorEnv(environment)}`)
      }
    })
  } finally {
    await disconnectAuditLogger(auditLogger)
  }
}
