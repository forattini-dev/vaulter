/**
 * Vaulter MCP Tools - Monorepo Handlers
 *
 * Handlers for categorize_vars, shared_list, inheritance_info, audit_list, status
 */

import { VaulterClient } from '../../../client.js'
import { createAuditLogger } from '../../../lib/audit.js'
import {
  SHARED_SERVICE,
  resolveVariables,
  calculateInheritanceStats
} from '../../../lib/shared.js'
import { resolveBackendUrls } from '../../../index.js'
import type { VaulterConfig, Environment, AuditOperation, AuditQueryOptions } from '../../../types.js'
import type { ToolResponse } from '../config.js'

/**
 * Handle vaulter_categorize_vars call
 */
export async function handleCategorizeVarsCall(
  client: VaulterClient,
  _config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined
): Promise<ToolResponse> {
  const vars = await client.list({ project, environment, service })

  // Split by sensitive flag (no pattern inference)
  const secretKeys: string[] = []
  const configKeys: string[] = []

  for (const v of vars) {
    if (v.sensitive) {
      secretKeys.push(v.key)
    } else {
      configKeys.push(v.key)
    }
  }

  const lines = [
    `Variable Categorization for ${project}/${environment}${service ? `/${service}` : ''}`,
    '',
    `SECRETS (${secretKeys.length} variables):`,
    '  (sensitive=true, encrypted)'
  ]

  for (const key of secretKeys) {
    lines.push(`  • ${key}`)
  }

  lines.push('')
  lines.push(`CONFIGS (${configKeys.length} variables):`)
  lines.push('  (sensitive=false, plain config)')

  for (const key of configKeys) {
    lines.push(`  • ${key}`)
  }

  lines.push('')
  lines.push('Note: Category is based on the sensitive flag set when the variable was created.')
  lines.push('Use KEY=value for secrets, KEY::value for configs.')

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Handle vaulter_shared_list call
 */
export async function handleSharedListCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const showValues = args.showValues === true

  // List shared variables (service = '__shared__')
  const sharedVars = await client.list({ project, environment, service: SHARED_SERVICE })

  if (sharedVars.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No shared variables in ${project}/${environment}

Shared variables apply to ALL services in a monorepo.
Set one with: vaulter_set key=... value=... shared=true

Example:
  vaulter_set key=DATABASE_HOST value=db.example.com shared=true`
      }]
    }
  }

  const lines = [
    `Shared Variables for ${project}/${environment}`,
    `(Apply to all services unless overridden)`,
    ''
  ]

  for (const v of sharedVars) {
    if (showValues) {
      lines.push(`  ${v.key}=${v.value}`)
    } else {
      lines.push(`  ${v.key}`)
    }
  }

  lines.push('')
  lines.push(`Total: ${sharedVars.length} shared variables`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Handle vaulter_inheritance_info call
 */
export async function handleInheritanceInfoCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const service = args.service as string

  // Get shared and service-specific variables
  const sharedVars = await client.list({ project, environment, service: SHARED_SERVICE })
  const serviceVars = await client.list({ project, environment, service })

  // Convert to records
  const sharedRecord: Record<string, string> = {}
  for (const v of sharedVars) {
    sharedRecord[v.key] = v.value
  }

  const serviceRecord: Record<string, string> = {}
  for (const v of serviceVars) {
    serviceRecord[v.key] = v.value
  }

  // Calculate inheritance
  const stats = calculateInheritanceStats(service, sharedRecord, serviceRecord)
  const resolved = resolveVariables(sharedRecord, serviceRecord)

  const lines = [
    `Inheritance Info for ${project}/${environment}/${service}`,
    '',
    `Summary:`,
    `  Total variables: ${stats.total}`,
    `  Inherited from shared: ${stats.inherited}`,
    `  Overrides shared: ${stats.overrides}`,
    `  Service-only: ${stats.serviceOnly}`,
    ''
  ]

  // Group by source
  const inherited: string[] = []
  const overrides: string[] = []
  const serviceOnly: string[] = []

  for (const [key, v] of resolved) {
    switch (v.source) {
      case 'shared':
        inherited.push(key)
        break
      case 'override':
        overrides.push(key)
        break
      case 'service':
        serviceOnly.push(key)
        break
    }
  }

  if (inherited.length > 0) {
    lines.push('Inherited (from shared):')
    for (const k of inherited) {
      lines.push(`  • ${k}`)
    }
    lines.push('')
  }

  if (overrides.length > 0) {
    lines.push('Overrides (service value differs from shared):')
    for (const k of overrides) {
      lines.push(`  • ${k}`)
    }
    lines.push('')
  }

  if (serviceOnly.length > 0) {
    lines.push('Service-only (no shared equivalent):')
    for (const k of serviceOnly) {
      lines.push(`  • ${k}`)
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Handle vaulter_audit_list call
 */
export async function handleAuditListCall(
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const auditLogger = createAuditLogger(config?.audit)

  // Connect audit logger to same backend as client
  if (!config) {
    return { content: [{ type: 'text', text: 'Error: No configuration found' }] }
  }
  const urls = resolveBackendUrls(config)
  if (urls.length === 0) {
    return { content: [{ type: 'text', text: 'Error: No backend URL configured for audit logging' }] }
  }

  try {
    await auditLogger.connect(urls[0], undefined, false)

    const queryOptions: AuditQueryOptions = {
      project,
      environment,
      service,
      user: args.user as string | undefined,
      operation: args.operation as AuditOperation | undefined,
      key: args.key as string | undefined,
      since: args.since ? new Date(args.since as string) : undefined,
      until: args.until ? new Date(args.until as string) : undefined,
      limit: (args.limit as number) || 50
    }

    const entries = await auditLogger.query(queryOptions)

    if (entries.length === 0) {
      return { content: [{ type: 'text', text: 'No audit entries found matching the criteria' }] }
    }

    const lines = [
      `Audit Log for ${project}/${environment}${service ? `/${service}` : ''}`,
      `Found ${entries.length} entries:`,
      ''
    ]

    for (const entry of entries) {
      const ts = new Date(entry.timestamp).toISOString()
      const val = entry.newValue ? ` (value: ${entry.newValue})` : ''
      lines.push(`[${ts}] ${entry.user} ${entry.operation} ${entry.key}${val} via ${entry.source}`)
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } finally {
    await auditLogger.disconnect()
  }
}

/**
 * Handle vaulter_status call - consolidated status tool
 */
export async function handleStatusCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const include = (args.include as string[]) || ['all']
  const overdueOnly = args.overdue_only === true
  const showAll = include.includes('all')

  const sections: string[] = []

  // === ENCRYPTION SECTION ===
  if (showAll || include.includes('encryption')) {
    const enc = config?.encryption
    const encLines: string[] = ['## Encryption', '']

    if (!enc) {
      encLines.push('Mode: symmetric (default)')
      encLines.push('Algorithm: AES-256-GCM')
      encLines.push('Key source: VAULTER_KEY env var (default)')
    } else {
      const mode = enc.mode || 'symmetric'
      encLines.push(`Mode: ${mode}`)

      if (mode === 'symmetric') {
        encLines.push('Algorithm: AES-256-GCM')
        if (enc.key_source && enc.key_source.length > 0) {
          encLines.push('Key sources:')
          for (const src of enc.key_source) {
            if ('env' in src) encLines.push(`  • env: ${src.env}`)
            if ('file' in src) encLines.push(`  • file: ${src.file}`)
            if ('s3' in src) encLines.push(`  • s3: ${src.s3}`)
          }
        }
      } else {
        const asym = enc.asymmetric
        encLines.push(`Algorithm: ${asym?.algorithm || 'rsa-4096'} + AES-256-GCM`)
        if (asym?.key_name) encLines.push(`Key name: ${asym.key_name}`)
      }
    }

    sections.push(encLines.join('\n'))
  }

  // === ROTATION SECTION ===
  if (showAll || include.includes('rotation')) {
    const rotationConfig = config?.encryption?.rotation
    const rotLines: string[] = ['## Rotation', '']

    if (!rotationConfig?.enabled) {
      rotLines.push('Status: disabled')
      rotLines.push('')
      rotLines.push('To enable, add to config.yaml:')
      rotLines.push('  encryption.rotation.enabled: true')
      rotLines.push('  encryption.rotation.interval_days: 90')
    } else {
      const patterns = rotationConfig.patterns || ['*_KEY', '*_SECRET', '*_TOKEN', '*_PASSWORD']
      const intervalDays = rotationConfig.interval_days || 90

      rotLines.push(`Status: enabled (${intervalDays} day interval)`)
      rotLines.push(`Patterns: ${patterns.join(', ')}`)
      rotLines.push('')

      // Get rotation status for secrets
      const vars = await client.list({ project, environment, service })
      const now = new Date()
      let overdueCount = 0
      let healthyCount = 0

      for (const v of vars) {
        const matchesPattern = patterns.some(p => {
          const regex = new RegExp('^' + p.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
          return regex.test(v.key)
        })
        if (!matchesPattern) continue

        const rotatedAt = v.metadata?.rotatedAt
        if (rotatedAt) {
          const rotatedDate = new Date(rotatedAt)
          const nextRotation = new Date(rotatedDate)
          nextRotation.setDate(nextRotation.getDate() + intervalDays)
          if (nextRotation < now) {
            overdueCount++
          } else {
            healthyCount++
          }
        } else {
          overdueCount++ // Never rotated
        }
      }

      if (overdueOnly) {
        if (overdueCount > 0) {
          rotLines.push(`⚠️  ${overdueCount} secret(s) overdue for rotation`)
        } else {
          rotLines.push('✓ No secrets overdue for rotation')
        }
      } else {
        if (overdueCount > 0) {
          rotLines.push(`⚠️  ${overdueCount} secret(s) overdue for rotation`)
        }
        if (healthyCount > 0) {
          rotLines.push(`✓ ${healthyCount} secret(s) healthy`)
        }
        if (overdueCount === 0 && healthyCount === 0) {
          rotLines.push('No secrets match rotation patterns')
        }
      }
    }

    sections.push(rotLines.join('\n'))
  }

  // === AUDIT SECTION ===
  if (showAll || include.includes('audit')) {
    const auditConfig = config?.audit
    const auditLines: string[] = ['## Audit', '']

    if (auditConfig?.enabled === false) {
      auditLines.push('Status: disabled')
    } else {
      auditLines.push('Status: enabled')
      auditLines.push(`Retention: ${auditConfig?.retention_days || 90} days`)
      auditLines.push(`User source: ${auditConfig?.user_source || 'git'}`)
    }

    sections.push(auditLines.join('\n'))
  }

  return {
    content: [{
      type: 'text',
      text: sections.join('\n\n')
    }]
  }
}
