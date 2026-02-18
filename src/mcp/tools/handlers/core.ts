/**
 * Vaulter MCP Tools - Core Handlers
 *
 * Handlers for get, set, delete, list, export operations
 */

import { VaulterClient } from '../../../client.js'
import { SHARED_SERVICE } from '../../../lib/shared.js'
import { detectEncoding } from '../../../lib/encoding-detection.js'
import {
  collectScopePolicyIssues,
  formatScopePolicySummary,
  hasBlockingPolicyIssues
} from '../../../lib/scope-policy.js'
import type { Environment } from '../../../types.js'
import type { ToolResponse } from '../config.js'

export async function handleGetCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const key = args.key as string
  const envVar = await client.get(key, project, environment, service)
  return {
    content: [{
      type: 'text',
      text: envVar !== null ? envVar.value : `Variable ${key} not found in ${project}/${environment}`
    }]
  }
}

export async function handleSetCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const key = args.key as string
  const value = args.value as string
  const tags = args.tags as string[] | undefined
  const shared = args.shared === true
  const sensitive = args.sensitive === true

  // If shared flag is set, use __shared__ as service
  const effectiveService = shared ? SHARED_SERVICE : service

  // Validate scope policy for target
  const policyChecks = collectScopePolicyIssues([key], {
    scope: shared ? 'shared' : 'service',
    service: shared ? undefined : service
  })
  const policyIssues = policyChecks.flatMap((check) => check.issues)
  const policyBlocked = hasBlockingPolicyIssues(policyChecks)

  const location = shared
    ? `${project}/${environment} (shared)`
    : `${project}/${environment}${service ? `/${service}` : ''}`

  const typeLabel = sensitive ? 'secret' : 'config'

  // Build response with optional warning
  const lines = [`✓ Set ${key} (${typeLabel}) in ${location}`]
  if (policyIssues.length > 0) {
    lines.push('')
    lines.push(`⚠️ Scope policy check for ${key}:`)
    lines.push(formatScopePolicySummary(policyIssues))

    if (policyBlocked) {
      return {
        content: [{
          type: 'text',
          text: lines.concat([
            '',
            'Scope policy blocked this change.',
            'Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to continue.'
          ].join('\n'))
        }]
      }
    }
  }

  // Check for pre-encoded/pre-encrypted values
  const encodingResult = detectEncoding(value)

  await client.set({
    key,
    value,
    project,
    environment,
    service: effectiveService,
    tags,
    sensitive,
    metadata: { source: 'manual' }
  })

  if (encodingResult.detected && encodingResult.confidence !== 'low') {
    lines.push('')
    lines.push(`⚠️ Warning: ${encodingResult.message}`)
    lines.push('Vaulter automatically encrypts all values. Pre-encoding is usually unnecessary.')
  }

  return {
    content: [{
      type: 'text',
      text: lines.join('\n')
    }]
  }
}

export async function handleDeleteCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const key = args.key as string
  const deleted = await client.delete(key, project, environment, service)
  return {
    content: [{
      type: 'text',
      text: deleted ? `✓ Deleted ${key} from ${project}/${environment}` : `Variable ${key} not found`
    }]
  }
}

export async function handleListCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const showValues = args.showValues as boolean || false
  const filter = args.filter as string | undefined
  const vars = await client.list({ project, environment, service })

  if (vars.length === 0) {
    return { content: [{ type: 'text', text: `No variables found for ${project}/${environment}` }] }
  }

  // Apply filter if provided
  let filtered = vars
  if (filter) {
    const regex = new RegExp('^' + filter.replace(/\*/g, '.*') + '$', 'i')
    filtered = vars.filter(v => regex.test(v.key))
  }

  // Format: KEY [type] = value (if showValues)
  const lines = filtered.map(v => {
    const typeLabel = v.sensitive ? '[secret]' : '[config]'
    if (showValues) {
      return `${v.key} ${typeLabel} = ${v.value}`
    }
    return `${v.key} ${typeLabel}`
  })

  const header = `Variables in ${project}/${environment}${filter ? ` (filter: ${filter})` : ''}:`

  // Count secrets vs configs
  const secretCount = filtered.filter(v => v.sensitive).length
  const configCount = filtered.length - secretCount

  return {
    content: [{
      type: 'text',
      text: `${header}\n${lines.join('\n')}\n\nTotal: ${filtered.length} variable(s) (${configCount} config, ${secretCount} secret)`
    }]
  }
}

export async function handleExportCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const format = (args.format as string) || 'shell'
  const includeShared = args.includeShared !== false // default true
  const vars = await client.export(project, environment, service, { includeShared })

  let output: string
  switch (format) {
    case 'json':
      output = JSON.stringify(vars, null, 2)
      break
    case 'yaml':
      output = Object.entries(vars)
        .map(([k, v]) => `${k}: "${v.replace(/"/g, '\\"')}"`)
        .join('\n')
      break
    case 'env':
      output = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
      break
    case 'tfvars':
      output = Object.entries(vars)
        .map(([k, v]) => `${k.toLowerCase()} = "${v.replace(/"/g, '\\"')}"`)
        .join('\n')
      break
    case 'docker-args':
      output = Object.entries(vars)
        .map(([k, v]) => `-e ${k}="${v.replace(/"/g, '\\"')}"`)
        .join(' ')
      break
    case 'shell':
    default:
      output = Object.entries(vars)
        .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
        .join('\n')
  }

  return { content: [{ type: 'text', text: output || '# No variables found' }] }
}

export async function handleNukePreviewCall(
  client: VaulterClient
): Promise<ToolResponse> {
  const preview = await client.nukePreview()

  if (preview.totalVars === 0) {
    return {
      content: [{
        type: 'text',
        text: '✓ No data found in remote storage. Nothing to delete.'
      }]
    }
  }

  const lines: string[] = [
    '⚠️  NUKE PREVIEW - This shows what would be deleted',
    '',
    `Project:      ${preview.project}`,
    `Total vars:   ${preview.totalVars}`,
    `Environments: ${preview.environments.join(', ')}`,
  ]

  if (preview.services.length > 0) {
    lines.push(`Services:     ${preview.services.join(', ')}`)
  }

  lines.push('')
  lines.push('Sample variables that would be deleted:')
  for (const v of preview.sampleVars) {
    const scope = v.service ? `${v.environment}/${v.service}` : v.environment
    lines.push(`  • ${v.key} (${scope})`)
  }
  if (preview.totalVars > preview.sampleVars.length) {
    lines.push(`  ... and ${preview.totalVars - preview.sampleVars.length} more`)
  }

  lines.push('')
  lines.push('─'.repeat(60))
  lines.push('⛔ To execute the nuke, run via CLI (not available in MCP):')
  lines.push('')
  lines.push(`   vaulter nuke --confirm=${preview.project}`)
  lines.push('')
  lines.push('This requires human confirmation for safety.')
  lines.push('─'.repeat(60))

  return {
    content: [{
      type: 'text',
      text: lines.join('\n')
    }]
  }
}
