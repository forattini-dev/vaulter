/**
 * Vaulter MCP Tools - Batch Handlers
 *
 * Handlers for multi_get, multi_set, multi_delete operations
 */

import { VaulterClient } from '../../../client.js'
import { SHARED_SERVICE } from '../../../lib/shared.js'
import { checkValuesForEncoding } from '../../../lib/encoding-detection.js'
import { evaluateWriteGuard, formatWriteGuardLines } from '../../../lib/write-guard.js'
import type { Environment } from '../../../types.js'
import type { VaulterConfig } from '../../../types.js'
import type { ToolResponse } from '../config.js'

function isLikelyTimeoutError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('socket hang up') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused')
  )
}

function buildMultiSetFailureMessage(message: string, requestedCount: number, successCount = 0): string {
  const lines = [
    `❌ Error setting ${requestedCount} variable(s): ${message}`,
    `  Applied: ${successCount} var(s)`
  ]

  if (isLikelyTimeoutError(message)) {
    lines.push('')
    lines.push('Suggestion:')
    lines.push('- Retry the operation with the same payload.')
    lines.push('- If failures persist, reduce batch size and increase retry/timeout in MCP client config.')
  }

  return lines.join('\n')
}

interface VariableInput {
  key: string
  value: string
  sensitive?: boolean
  tags?: string[]
}

export async function handleMultiGetCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const keys = args.keys as string[]

  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    return {
      content: [{
        type: 'text',
        text: 'Error: keys must be a non-empty array of variable names'
      }]
    }
  }

  // Use optimized getMany - single list query instead of N get queries
  const resultMap = await client.getMany(keys, project, environment, service)

  const found: Array<{ key: string, value: string }> = []
  const notFound: string[] = []

  for (const [key, envVar] of resultMap) {
    if (envVar !== null) {
      found.push({ key, value: envVar.value })
    } else {
      notFound.push(key)
    }
  }

  const location = `${project}/${environment}${service ? `/${service}` : ''}`
  const lines = [
    `Variables from ${location}:`,
    '',
    ...found.map(r => `${r.key}=${r.value}`),
    '',
    `Found: ${found.length}/${keys.length}`
  ]

  if (notFound.length > 0) {
    lines.push(`Not found: ${notFound.join(', ')}`)
  }

  return {
    content: [{
      type: 'text',
      text: lines.join('\n')
    }]
  }
}

export async function handleMultiSetCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  config: VaulterConfig | null,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const variables = args.variables
  const shared = args.shared === true
  const defaultSensitive = args.sensitive === true // default sensitive flag for all vars

  // If shared flag is set, use __shared__ as service
  const effectiveService = shared ? SHARED_SERVICE : service

  if (!variables) {
    return {
      content: [{
        type: 'text',
        text: 'Error: variables is required. Provide an array of {key, value} objects or a {key: value} object'
      }]
    }
  }

  // Normalize to array of {key, value, sensitive?, tags?} objects
  let varsArray: VariableInput[]

  if (Array.isArray(variables)) {
    // Already array format: [{ key: "VAR", value: "val", sensitive?: bool, tags?: [...] }]
    varsArray = variables as VariableInput[]
  } else if (typeof variables === 'object') {
    // Object format: { VAR1: "val1", VAR2: "val2" } - uses defaultSensitive
    varsArray = Object.entries(variables as Record<string, string>).map(([key, value]) => ({
      key,
      value: String(value)
    }))
  } else {
    return {
      content: [{
        type: 'text',
        text: 'Error: variables must be an array of {key, value} objects or a {key: value} object'
      }]
    }
  }

  if (varsArray.length === 0) {
    return {
      content: [{
        type: 'text',
        text: 'Error: no variables provided'
      }]
    }
  }

  // Filter valid entries and apply guardrails before writing
  const validEntries = varsArray.filter(({ key, value }) => key && value !== undefined)
  const skipped = varsArray.length - validEntries.length
  const normalizedEntries = validEntries.map((entry) => ({
    ...entry,
    value: String(entry.value),
    sensitive: entry.sensitive ?? defaultSensitive
  }))

  const guard = evaluateWriteGuard({
    variables: normalizedEntries,
    targetScope: shared ? 'shared' : 'service',
    targetService: shared ? undefined : service,
    environment,
    config,
    policyMode: process.env.VAULTER_SCOPE_POLICY,
    guardrailMode: process.env.VAULTER_VALUE_GUARDRAILS
  })

  if (guard.blocked) {
    return {
      content: [{
        type: 'text',
        text: [
          '❌ Write blocked by validation.',
          ...formatWriteGuardLines(guard),
          '',
          'Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to relax scope checks.',
          'Set VAULTER_VALUE_GUARDRAILS=warn or VAULTER_VALUE_GUARDRAILS=off to relax value checks.'
        ].join('\n')
      }]
    }
  }

  // Use optimized setMany - single list query + parallel insert/update
  // Per-variable sensitive overrides the default
  const inputs = normalizedEntries.map(({ key, value, sensitive, tags }) => ({
    key,
    value,
    project,
    environment,
    service: effectiveService,
    sensitive,
    tags,
    metadata: { source: 'manual' as const }
  }))

  try {
    const results = await client.setMany(inputs)
    const succeeded = results.map(r => r.key)

    const location = shared
      ? `${project}/${environment} (shared)`
      : `${project}/${environment}${service ? `/${service}` : ''}`

    const lines = [`Set ${succeeded.length}/${varsArray.length} variable(s) in ${location}:`]
    if (guard.scopeIssueSummary || guard.valueIssueSummary) {
      lines.push('')
      lines.push('⚠️ Validation warnings (continuing with apply):')
      lines.push(...formatWriteGuardLines(guard))
    }

    if (succeeded.length > 0) lines.push(`✓ ${succeeded.join(', ')}`)
    if (skipped > 0) lines.push(`⚠ Skipped ${skipped} invalid entries`)

    // Check for pre-encoded/pre-encrypted values and add warnings
    const encodingWarnings = checkValuesForEncoding(
      normalizedEntries.map(({ key, value }) => ({ key, value: String(value) }))
    )
    if (encodingWarnings.length > 0) {
      lines.push('')
      lines.push('⚠️ Encoding warnings:')
      for (const { key, result } of encodingWarnings) {
        lines.push(`  • ${key}: ${result.message}`)
      }
      lines.push('Vaulter automatically encrypts all values. Pre-encoding is usually unnecessary.')
    }

    return {
      content: [{
        type: 'text',
        text: lines.join('\n')
      }]
    }
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: buildMultiSetFailureMessage((err as Error).message, varsArray.length)
      }]
    }
  }
}

export async function handleMultiDeleteCall(
  client: VaulterClient,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const keys = args.keys as string[]

  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    return {
      content: [{
        type: 'text',
        text: 'Error: keys must be a non-empty array of variable names'
      }]
    }
  }

  // Use optimized deleteManyByKeys - single list query + batch delete
  const { deleted, notFound } = await client.deleteManyByKeys(keys, project, environment, service)

  const location = `${project}/${environment}${service ? `/${service}` : ''}`
  const lines = [`Deleted from ${location}:`]

  if (deleted.length > 0) {
    lines.push(`✓ Deleted: ${deleted.join(', ')}`)
  }

  if (notFound.length > 0) {
    lines.push(`⚠ Not found: ${notFound.join(', ')}`)
  }

  lines.push(`\nTotal: ${deleted.length}/${keys.length} deleted`)

  return {
    content: [{
      type: 'text',
      text: lines.join('\n')
    }]
  }
}
