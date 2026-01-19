/**
 * Vaulter MCP Tools - Sync Handlers
 *
 * Handlers for sync, pull, push operations
 */

import fs from 'node:fs'
import path from 'node:path'
import { VaulterClient } from '../../../client.js'
import {
  findConfigDir,
  getEnvFilePath,
  getEnvFilePathForConfig
} from '../../../lib/config-loader.js'
import { parseEnvFile, serializeEnv } from '../../../lib/env-parser.js'
import type { VaulterConfig, Environment } from '../../../types.js'
import type { ToolResponse } from '../config.js'

export async function handleSyncCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const dryRun = args.dryRun as boolean || false

  const configDir = findConfigDir()
  if (!configDir) {
    return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
  }

  const envFilePath = config
    ? getEnvFilePathForConfig(config, configDir, environment)
    : getEnvFilePath(configDir, environment)

  if (!fs.existsSync(envFilePath)) {
    return { content: [{ type: 'text', text: `Error: Environment file not found: ${envFilePath}` }] }
  }

  const localVars = parseEnvFile(envFilePath)

  if (dryRun) {
    const remoteVars = await client.export(project, environment, service)
    const toAdd: string[] = []
    const toUpdate: string[] = []

    for (const [key, value] of Object.entries(localVars)) {
      if (!(key in remoteVars)) {
        toAdd.push(key)
      } else if (remoteVars[key] !== value) {
        toUpdate.push(key)
      }
    }

    const lines = ['Dry run - changes that would be made:']
    if (toAdd.length > 0) lines.push(`  Add: ${toAdd.join(', ')}`)
    if (toUpdate.length > 0) lines.push(`  Update: ${toUpdate.join(', ')}`)
    if (toAdd.length === 0 && toUpdate.length === 0) {
      lines.push('  No changes needed')
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  const result = await client.sync(localVars, project, environment, service, { source: 'sync' })

  const lines = [`✓ Synced ${project}/${environment}`]
  if (result.added.length > 0) lines.push(`  Added: ${result.added.length}`)
  if (result.updated.length > 0) lines.push(`  Updated: ${result.updated.length}`)
  if (result.deleted.length > 0) lines.push(`  Deleted: ${result.deleted.length}`)
  if (result.unchanged.length > 0) lines.push(`  Unchanged: ${result.unchanged.length}`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

export async function handlePullCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const configDir = findConfigDir()
  if (!configDir) {
    return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
  }

  const outputPath = (args.output as string) || (config
    ? getEnvFilePathForConfig(config, configDir, environment)
    : getEnvFilePath(configDir, environment))

  const vars = await client.export(project, environment, service)
  const content = serializeEnv(vars)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, content + '\n')

  return {
    content: [{
      type: 'text',
      text: `✓ Pulled ${Object.keys(vars).length} variables to ${outputPath}`
    }]
  }
}

export async function handlePushCall(
  client: VaulterClient,
  config: VaulterConfig | null,
  project: string,
  environment: Environment,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const configDir = findConfigDir()
  if (!configDir) {
    return { content: [{ type: 'text', text: 'Error: No .vaulter directory found' }] }
  }

  const inputPath = (args.file as string) || (config
    ? getEnvFilePathForConfig(config, configDir, environment)
    : getEnvFilePath(configDir, environment))

  if (!fs.existsSync(inputPath)) {
    return { content: [{ type: 'text', text: `Error: File not found: ${inputPath}` }] }
  }

  const localVars = parseEnvFile(inputPath)
  const result = await client.sync(localVars, project, environment, service, { source: 'sync' })

  return {
    content: [{
      type: 'text',
      text: `✓ Pushed ${Object.keys(localVars).length} variables from ${inputPath}\n  Added: ${result.added.length}, Updated: ${result.updated.length}`
    }]
  }
}
