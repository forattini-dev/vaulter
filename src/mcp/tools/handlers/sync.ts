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
import { isMonorepoFromConfig } from '../../../lib/monorepo.js'
import { checkValuesForEncoding } from '../../../lib/encoding-detection.js'
import { parseEnvFile, serializeEnv } from '../../../lib/env-parser.js'
import { evaluateWriteGuard, formatWriteGuardLines } from '../../../lib/write-guard.js'
import type { VaulterConfig, Environment } from '../../../types.js'
import type { ToolResponse } from '../config.js'

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
  const dryRun = args.dryRun as boolean || false

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
  const localKeys = Object.keys(localVars)
  const effectiveService = service
  const hasMonorepo = isMonorepoFromConfig(config)

  const remoteList = await client.list({
    project,
    environment,
    service: effectiveService
  })

  const remoteVars: Record<string, string> = {}
  const remoteSensitivity = new Map<string, boolean>()
  for (const item of remoteList) {
    remoteVars[item.key] = item.value
    if (item.sensitive !== undefined) {
      remoteSensitivity.set(item.key, !!item.sensitive)
    }
  }

  // Dry run mode - preview changes without applying
  if (dryRun) {
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

  const writeInputs = localKeys.map((key) => ({
    key,
    value: localVars[key],
    sensitive: remoteSensitivity.get(key)
  }))
  const targetScope: 'shared' | 'service' = hasMonorepo && !effectiveService ? 'shared' : 'service'
  const scopeGuard = evaluateWriteGuard({
    variables: writeInputs,
    targetScope,
    targetService: targetScope === 'service' ? effectiveService : undefined,
    config,
    environment,
    policyMode: process.env.VAULTER_SCOPE_POLICY,
    guardrailMode: process.env.VAULTER_VALUE_GUARDRAILS
  })
  const guardWarnings = formatWriteGuardLines(scopeGuard)
  const encodingWarnings = checkValuesForEncoding(writeInputs).map((item) => ({
    key: item.key,
    message: item.result.message
  }))

  if (scopeGuard.blocked) {
    return { content: [{ type: 'text', text: ['Sync blocked by validation rules:', ...guardWarnings, '', 'Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to continue.', 'Set VAULTER_VALUE_GUARDRAILS=warn or VAULTER_VALUE_GUARDRAILS=off to continue.'].join('\n') }] }
  }

  const toSet = localKeys.map((key) => ({
    key,
    value: localVars[key],
    project,
    environment,
    service: effectiveService,
    sensitive: remoteSensitivity.get(key),
    metadata: { source: 'sync' }
  }))

  await client.setMany(toSet, { preserveMetadata: true })

  return {
    content: [{
      type: 'text',
      text: [
        `✓ Synced ${localKeys.length} variables from ${inputPath}`,
        ...(guardWarnings.length > 0
          ? ['⚠ Validation warnings:', ...guardWarnings.map((line) => `- ${line}`)]
          : []),
        ...(encodingWarnings.length > 0
          ? ['⚠ Encoding warnings:', ...encodingWarnings.map((item) => `- ${item.key}: ${item.message}`)]
          : [])
      ].join('\n')
    }]
  }
}
