/**
 * Vaulter MCP Tools - Core Handlers
 *
 * Handlers for get, set, delete, list, export operations
 */

import { VaulterClient } from '../../../client.js'
import { SHARED_SERVICE } from '../../../lib/shared.js'
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

  // If shared flag is set, use __shared__ as service
  const effectiveService = shared ? SHARED_SERVICE : service

  await client.set({
    key,
    value,
    project,
    environment,
    service: effectiveService,
    tags,
    metadata: { source: 'manual' }
  })

  const location = shared
    ? `${project}/${environment} (shared)`
    : `${project}/${environment}${service ? `/${service}` : ''}`

  return {
    content: [{
      type: 'text',
      text: `✓ Set ${key} in ${location}`
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

  const lines = filtered.map(v => showValues ? `${v.key}=${v.value}` : v.key)
  const header = `Variables in ${project}/${environment}${filter ? ` (filter: ${filter})` : ''}:`

  return {
    content: [{
      type: 'text',
      text: `${header}\n${lines.join('\n')}\n\nTotal: ${filtered.length} variable(s)`
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
