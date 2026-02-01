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
  loadLocalShared,
  mergeAllLocalVars,
  diffOverrides,
  resolveBaseEnvironment,
  type LocalDiffResult
} from './local.js'
import { SHARED_SERVICE } from './shared.js'

export interface LocalPullOptions {
  client: VaulterClient
  config: VaulterConfig
  configDir: string
  service?: string
  all?: boolean
  output?: string
  dryRun?: boolean
  verbose?: boolean
  /** Overwrite mode - disable section-aware writing (default: false) */
  overwrite?: boolean
}

export interface LocalPullResult {
  baseEnvironment: string
  /** Local shared vars from .vaulter/local/configs.env + secrets.env */
  localShared: Record<string, string>
  localSharedCount: number
  /** Service-specific overrides */
  overrides: Record<string, string>
  overridesCount: number
  result: PullToOutputsResult
}

export async function runLocalPull(options: LocalPullOptions): Promise<LocalPullResult> {
  const {
    client,
    config,
    configDir,
    service: serviceArg,
    all = false,
    output,
    dryRun,
    verbose,
    overwrite = false
  } = options

  if (!all && !output) {
    throw new Error('Requires all=true or output=<name>')
  }

  if (!config.outputs || Object.keys(config.outputs).length === 0) {
    throw new Error('No outputs defined in config')
  }

  const baseEnvironment = resolveBaseEnvironment(config)

  // Resolve service from output config if specified, otherwise use serviceArg
  let service = serviceArg
  if (output && !service && config.outputs[output]) {
    const outputConfig = config.outputs[output]
    if (typeof outputConfig === 'object' && outputConfig.service) {
      service = outputConfig.service
    }
  }

  // Load local shared vars (shared across all services)
  const localShared = loadLocalShared(configDir)

  // Load service-specific overrides
  const overrides = loadOverrides(configDir, service)

  // Fetch from backend
  const baseVars = await client.export(config.project, baseEnvironment, service)
  const sharedServiceVars = await getSharedServiceVars(client, config.project, baseEnvironment)

  // Merge: backend + local shared + service overrides
  const merged = mergeAllLocalVars(baseVars, localShared, overrides)

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
    sharedVarsOverride: sharedServiceVars,
    sectionAware: !overwrite  // Default: section-aware; --overwrite disables it
  })

  return {
    baseEnvironment,
    localShared,
    localSharedCount: Object.keys(localShared).length,
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

// ============================================================================
// Local Push - Push local overrides to remote backend
// ============================================================================

export interface LocalPushOptions {
  client: VaulterClient
  config: VaulterConfig
  configDir: string
  service?: string
  /** Push shared vars instead of service-specific */
  shared?: boolean
  /** Preview without applying */
  dryRun?: boolean
  /** Target environment (defaults to base env from config) */
  targetEnvironment?: string
}

export interface LocalPushResult {
  /** Source environment (base) */
  sourceEnvironment: string
  /** Target environment for push */
  targetEnvironment: string
  /** Variables that would be/were added (new keys) */
  added: Array<{ key: string; value: string; sensitive: boolean }>
  /** Variables that would be/were updated (existing keys, different values) */
  updated: Array<{ key: string; oldValue: string; newValue: string; sensitive: boolean }>
  /** Variables unchanged (same value) */
  unchanged: string[]
  /** Total vars pushed */
  pushedCount: number
  /** Was this a dry run? */
  dryRun: boolean
}

/**
 * Push local overrides to remote backend
 *
 * This allows sharing local development configs with the team by
 * pushing them to the backend storage.
 */
export async function runLocalPush(options: LocalPushOptions): Promise<LocalPushResult> {
  const {
    client,
    config,
    configDir,
    service,
    shared = false,
    dryRun = false,
    targetEnvironment
  } = options

  const sourceEnvironment = resolveBaseEnvironment(config)
  const target = targetEnvironment || sourceEnvironment

  // Load local vars based on shared flag
  const localVars = shared
    ? loadLocalShared(configDir)
    : loadOverrides(configDir, service)

  if (Object.keys(localVars).length === 0) {
    return {
      sourceEnvironment,
      targetEnvironment: target,
      added: [],
      updated: [],
      unchanged: [],
      pushedCount: 0,
      dryRun
    }
  }

  // Fetch current remote state
  const remoteVars = shared
    ? await client.export(config.project, target, SHARED_SERVICE)
    : await client.export(config.project, target, service)

  // Fetch existing var metadata to preserve sensitive flag
  const existingVars = await client.list({
    project: config.project,
    environment: target,
    service: shared ? SHARED_SERVICE : service
  })
  const existingSensitiveMap = new Map<string, boolean>()
  for (const v of existingVars) {
    existingSensitiveMap.set(v.key, v.sensitive ?? false)
  }

  // Compare and categorize
  const added: LocalPushResult['added'] = []
  const updated: LocalPushResult['updated'] = []
  const unchanged: string[] = []

  for (const [key, value] of Object.entries(localVars)) {
    // No inference - use existing sensitive flag for updates, false for new vars
    const existingSensitive = existingSensitiveMap.get(key) ?? false

    if (!(key in remoteVars)) {
      // New var - defaults to not sensitive (config), user must mark explicitly if needed
      added.push({ key, value, sensitive: false })
    } else if (remoteVars[key] !== value) {
      // Update - preserve existing sensitive flag
      updated.push({ key, oldValue: remoteVars[key], newValue: value, sensitive: existingSensitive })
    } else {
      unchanged.push(key)
    }
  }

  // Apply if not dry run
  if (!dryRun && (added.length > 0 || updated.length > 0)) {
    const inputs = [
      ...added.map(v => ({
        key: v.key,
        value: v.value,
        project: config.project,
        environment: target,
        service: shared ? SHARED_SERVICE : service,
        sensitive: v.sensitive
      })),
      ...updated.map(v => ({
        key: v.key,
        value: v.newValue,
        project: config.project,
        environment: target,
        service: shared ? SHARED_SERVICE : service,
        sensitive: v.sensitive
      }))
    ]

    await client.setMany(inputs)
  }

  return {
    sourceEnvironment,
    targetEnvironment: target,
    added,
    updated,
    unchanged,
    pushedCount: added.length + updated.length,
    dryRun
  }
}

