/**
 * Vaulter - Local Ops
 *
 * Shared core logic for local overrides commands (CLI & MCP).
 */

import path from 'node:path'
import type { VaulterClient } from '../client.js'
import type { VaulterConfig } from '../types.js'
import type { PullToOutputsResult } from './outputs.js'
import { pullToOutputs, getSharedServiceVars } from './outputs.js'
import {
  loadOverrides,
  mergeWithOverrides,
  diffOverrides,
  resolveBaseEnvironment,
  type LocalDiffResult
} from './local.js'

export interface LocalPullOptions {
  client: VaulterClient
  config: VaulterConfig
  configDir: string
  service?: string
  all?: boolean
  output?: string
  dryRun?: boolean
  verbose?: boolean
}

export interface LocalPullResult {
  baseEnvironment: string
  overrides: Record<string, string>
  overridesCount: number
  result: PullToOutputsResult
}

export async function runLocalPull(options: LocalPullOptions): Promise<LocalPullResult> {
  const {
    client,
    config,
    configDir,
    service,
    all = false,
    output,
    dryRun,
    verbose
  } = options

  if (!all && !output) {
    throw new Error('Requires all=true or output=<name>')
  }

  if (!config.outputs || Object.keys(config.outputs).length === 0) {
    throw new Error('No outputs defined in config')
  }

  const baseEnvironment = resolveBaseEnvironment(config)
  const overrides = loadOverrides(configDir, service)

  const baseVars = await client.export(config.project, baseEnvironment, service)
  const merged = mergeWithOverrides(baseVars, overrides)
  const sharedServiceVars = await getSharedServiceVars(client, config.project, baseEnvironment)

  const projectRoot = path.dirname(configDir)
  const result = await pullToOutputs({
    client,
    config,
    environment: baseEnvironment,
    projectRoot,
    all,
    output,
    dryRun,
    verbose,
    varsOverride: merged,
    sharedVarsOverride: sharedServiceVars
  })

  return {
    baseEnvironment,
    overrides,
    overridesCount: Object.keys(overrides).length,
    result
  }
}

export interface LocalDiffOptions {
  client: VaulterClient
  config: VaulterConfig
  configDir: string
  service?: string
}

export interface LocalOpsDiffResult {
  baseEnvironment: string
  overrides: Record<string, string>
  diff: LocalDiffResult | null
}

export async function runLocalDiff(options: LocalDiffOptions): Promise<LocalOpsDiffResult> {
  const { client, config, configDir, service } = options
  const baseEnvironment = resolveBaseEnvironment(config)
  const overrides = loadOverrides(configDir, service)

  if (Object.keys(overrides).length === 0) {
    return { baseEnvironment, overrides, diff: null }
  }

  const baseVars = await client.export(config.project, baseEnvironment, service)
  const diff = diffOverrides(baseVars, overrides)

  return { baseEnvironment, overrides, diff }
}
