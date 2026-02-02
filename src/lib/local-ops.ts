/**
 * Vaulter - Local Ops
 *
 * Shared core logic for local overrides commands (CLI & MCP).
 *
 * OFFLINE-FIRST ARCHITECTURE:
 * - `vaulter local pull` reads ONLY from local files (.vaulter/local/)
 * - NO backend calls for local development
 * - Backend sync is done via `vaulter sync push/pull`
 *
 * For each output:
 *   1. Read shared vars: .vaulter/local/configs.env + secrets.env
 *   2. Read service-specific vars: .vaulter/local/services/{service}/*.env
 *   3. Merge: shared + service-specific (service wins on conflict)
 *   4. Write to output path
 */

import fs from 'node:fs'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { VaulterClient } from '../client.js'
import type { VaulterConfig, NormalizedOutputTarget } from '../types.js'
import {
  normalizeOutputTargets,
  filterVarsByPatterns,
  formatEnvFile
} from './outputs.js'
import { syncVaulterSection, getUserVarsFromEnvFile } from './env-parser.js'
import {
  loadOverrides,
  loadLocalShared,
  loadLocalSharedConfigs,
  loadLocalSharedSecrets,
  loadServiceConfigs,
  loadServiceSecrets,
  diffOverrides,
  resolveBaseEnvironment,
  setLocalShared,
  setOverride,
  getLocalDir,
  type LocalDiffResult
} from './local.js'
import { SHARED_SERVICE } from './shared.js'

export interface LocalPullOptions {
  /** Vaulter client (only needed for push operations, not for pull) */
  client?: VaulterClient
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

export interface LocalPullFileResult {
  output: string
  path: string
  filename: string
  fullPath: string
  varsCount: number
  vars: Record<string, string>
  userVars?: Record<string, string>
  totalVarsCount?: number
  /** Breakdown: shared vars count */
  sharedCount: number
  /** Breakdown: service-specific vars count */
  serviceCount: number
}

export interface LocalPullResult {
  baseEnvironment: string
  /** Local shared vars from .vaulter/local/configs.env + secrets.env */
  localShared: Record<string, string>
  localSharedCount: number
  /** Total service-specific vars across all outputs */
  totalServiceVarsCount: number
  /** Files written */
  files: LocalPullFileResult[]
  /** Warnings */
  warnings: string[]
  /** Section-aware mode used */
  sectionAware: boolean
}

/**
 * OFFLINE-FIRST Local Pull
 *
 * Generates .env files from local files ONLY - NO backend calls.
 *
 * For each output target:
 * 1. Loads shared vars from .vaulter/local/{configs,secrets}.env
 * 2. Loads service-specific vars from .vaulter/local/services/{service}/*.env
 * 3. Merges: shared + service-specific (service wins on conflict)
 * 4. Applies include/exclude filters
 * 5. Writes to output path
 */
export async function runLocalPull(options: LocalPullOptions): Promise<LocalPullResult> {
  const {
    config,
    configDir,
    all = false,
    output: specificOutput,
    dryRun = false,
    verbose = false,
    overwrite = false
  } = options

  const sectionAware = !overwrite

  if (!all && !specificOutput) {
    throw new Error('Requires all=true or output=<name>')
  }

  if (!config.outputs || Object.keys(config.outputs).length === 0) {
    throw new Error('No outputs defined in config')
  }

  const baseEnvironment = resolveBaseEnvironment(config)
  const projectRoot = path.dirname(configDir)

  // Load shared vars ONCE (used for all outputs)
  const localShared = loadLocalShared(configDir)

  if (verbose) {
    console.log(`Loaded ${Object.keys(localShared).length} shared vars from .vaulter/local/`)
  }

  // Get all output targets
  const allTargets = normalizeOutputTargets(config, baseEnvironment)

  if (allTargets.length === 0) {
    return {
      baseEnvironment,
      localShared,
      localSharedCount: Object.keys(localShared).length,
      totalServiceVarsCount: 0,
      files: [],
      warnings: ['No outputs defined in config. Add an "outputs" section.'],
      sectionAware
    }
  }

  // Filter targets
  let targets: NormalizedOutputTarget[]
  if (specificOutput) {
    const target = allTargets.find(t => t.name === specificOutput)
    if (!target) {
      const available = allTargets.map(t => t.name).join(', ')
      throw new Error(`Output "${specificOutput}" not found. Available: ${available}`)
    }
    targets = [target]
  } else if (all) {
    targets = allTargets
  } else {
    throw new Error('Either --all or --output <name> is required')
  }

  const files: LocalPullFileResult[] = []
  const warnings: string[] = []
  let totalServiceVarsCount = 0

  // Process each target - OFFLINE, no backend calls
  for (const target of targets) {
    // 1. Start with shared vars (if inherit enabled)
    let targetVars: Record<string, string> = {}
    let sharedCount = 0

    if (target.inherit) {
      targetVars = { ...localShared }
      sharedCount = Object.keys(localShared).length
    }

    // 2. Load service-specific vars (from .vaulter/local/services/{service}/)
    const serviceVars = target.service
      ? loadOverrides(configDir, target.service)
      : {}

    const serviceCount = Object.keys(serviceVars).length
    totalServiceVarsCount += serviceCount

    if (verbose && serviceCount > 0) {
      console.log(`  ${target.name}: +${serviceCount} service-specific vars`)
    }

    // 3. Merge: service-specific overrides shared
    targetVars = { ...targetVars, ...serviceVars }

    // 4. Apply include/exclude filters
    if (target.include.length > 0 || target.exclude.length > 0) {
      targetVars = filterVarsByPatterns(targetVars, target.include, target.exclude)
    }

    // 5. Generate file path
    const fullPath = path.join(projectRoot, target.path, target.filename)

    // Get user-defined vars if section-aware mode
    let userVars: Record<string, string> = {}
    if (sectionAware) {
      try {
        userVars = getUserVarsFromEnvFile(fullPath)
      } catch {
        // File doesn't exist yet, no user vars
      }
    }

    // Add to result
    files.push({
      output: target.name,
      path: target.path,
      filename: target.filename,
      fullPath,
      varsCount: Object.keys(targetVars).length,
      vars: targetVars,
      userVars: sectionAware ? userVars : undefined,
      totalVarsCount: sectionAware ? Object.keys(targetVars).length + Object.keys(userVars).length : undefined,
      sharedCount,
      serviceCount
    })

    // 6. Write file (unless dry-run)
    if (!dryRun) {
      await mkdir(path.dirname(fullPath), { recursive: true })

      if (sectionAware) {
        syncVaulterSection(fullPath, targetVars)

        if (verbose) {
          const userCount = Object.keys(userVars).length
          console.log(`Synced ${fullPath} (${Object.keys(targetVars).length} vaulter vars${userCount > 0 ? `, ${userCount} user vars preserved` : ''})`)
        }
      } else {
        const content = formatEnvFile(targetVars)
        await writeFile(fullPath, content, 'utf-8')

        if (verbose) {
          console.log(`Wrote ${fullPath} (${Object.keys(targetVars).length} vars)`)
        }
      }
    }
  }

  return {
    baseEnvironment,
    localShared,
    localSharedCount: Object.keys(localShared).length,
    totalServiceVarsCount,
    files,
    warnings,
    sectionAware
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

// ============================================================================
// Local Push All - Push entire .vaulter/local/ structure to backend
// ============================================================================

export interface LocalPushAllOptions {
  client: VaulterClient
  config: VaulterConfig
  configDir: string
  /** Preview without applying */
  dryRun?: boolean
  /** Target environment (defaults to base env from config) */
  targetEnvironment?: string
  /**
   * Overwrite mode: delete backend vars that don't exist locally.
   * This makes backend match local exactly (destructive!).
   */
  overwrite?: boolean
}

export interface LocalPushAllResult {
  targetEnvironment: string
  /** Shared vars pushed */
  shared: {
    configs: number
    secrets: number
  }
  /** Service-specific vars pushed */
  services: Record<string, { configs: number; secrets: number }>
  /** Total vars pushed */
  totalPushed: number
  /** Total vars deleted (only with overwrite=true) */
  totalDeleted: number
  /** Deleted keys by scope */
  deleted: {
    shared: string[]
    services: Record<string, string[]>
  }
  dryRun: boolean
}

/**
 * Push entire .vaulter/local/ structure to backend
 *
 * This pushes:
 * - .vaulter/local/configs.env + secrets.env → backend __shared__
 * - .vaulter/local/services/{svc}/*.env → backend {svc}
 *
 * With overwrite=true, also DELETES backend vars that don't exist locally.
 */
export async function runLocalPushAll(options: LocalPushAllOptions): Promise<LocalPushAllResult> {
  const {
    client,
    config,
    configDir,
    dryRun = false,
    targetEnvironment,
    overwrite = false
  } = options

  const target = targetEnvironment || resolveBaseEnvironment(config)

  const result: LocalPushAllResult = {
    targetEnvironment: target,
    shared: { configs: 0, secrets: 0 },
    services: {},
    totalPushed: 0,
    totalDeleted: 0,
    deleted: { shared: [], services: {} },
    dryRun
  }

  // 1. Push shared configs
  const sharedConfigs = loadLocalSharedConfigs(configDir)
  for (const [key, value] of Object.entries(sharedConfigs)) {
    if (!dryRun) {
      await client.set({
        key,
        value,
        project: config.project,
        environment: target,
        service: SHARED_SERVICE,
        sensitive: false
      })
    }
    result.shared.configs++
    result.totalPushed++
  }

  // 2. Push shared secrets
  const sharedSecrets = loadLocalSharedSecrets(configDir)
  for (const [key, value] of Object.entries(sharedSecrets)) {
    if (!dryRun) {
      await client.set({
        key,
        value,
        project: config.project,
        environment: target,
        service: SHARED_SERVICE,
        sensitive: true
      })
    }
    result.shared.secrets++
    result.totalPushed++
  }

  // 3. Find all services in .vaulter/local/services/
  const localDir = getLocalDir(configDir)
  const servicesDir = path.join(localDir, 'services')

  if (fs.existsSync(servicesDir)) {
    const serviceDirs = fs.readdirSync(servicesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)

    for (const service of serviceDirs) {
      result.services[service] = { configs: 0, secrets: 0 }

      // Push service configs
      const serviceConfigs = loadServiceConfigs(configDir, service)
      for (const [key, value] of Object.entries(serviceConfigs)) {
        if (!dryRun) {
          await client.set({
            key,
            value,
            project: config.project,
            environment: target,
            service,
            sensitive: false
          })
        }
        result.services[service].configs++
        result.totalPushed++
      }

      // Push service secrets
      const serviceSecrets = loadServiceSecrets(configDir, service)
      for (const [key, value] of Object.entries(serviceSecrets)) {
        if (!dryRun) {
          await client.set({
            key,
            value,
            project: config.project,
            environment: target,
            service,
            sensitive: true
          })
        }
        result.services[service].secrets++
        result.totalPushed++
      }
    }
  }

  // 4. If overwrite mode, delete backend vars that don't exist locally
  if (overwrite) {
    // Build set of all local keys per scope
    const localSharedKeys = new Set([
      ...Object.keys(loadLocalSharedConfigs(configDir)),
      ...Object.keys(loadLocalSharedSecrets(configDir))
    ])

    const localServiceKeys: Record<string, Set<string>> = {}
    const servicesDir = path.join(getLocalDir(configDir), 'services')
    if (fs.existsSync(servicesDir)) {
      const serviceDirs = fs.readdirSync(servicesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
      for (const service of serviceDirs) {
        localServiceKeys[service] = new Set([
          ...Object.keys(loadServiceConfigs(configDir, service)),
          ...Object.keys(loadServiceSecrets(configDir, service))
        ])
      }
    }

    // Get all backend vars
    const backendVars = await client.list({
      project: config.project,
      environment: target
    })

    // Find and delete vars that don't exist locally
    for (const v of backendVars) {
      const service = v.service
      let shouldDelete = false

      if (service === SHARED_SERVICE || !service) {
        // Shared var (or no service in single-repo mode) - check if exists locally
        if (!localSharedKeys.has(v.key)) {
          shouldDelete = true
          result.deleted.shared.push(v.key)
        }
      } else {
        // Service var - check if exists locally
        // If service doesn't exist locally at all, delete the var
        const localKeys = localServiceKeys[service]
        if (!localKeys || !localKeys.has(v.key)) {
          shouldDelete = true
          if (!result.deleted.services[service]) {
            result.deleted.services[service] = []
          }
          result.deleted.services[service].push(v.key)
        }
      }

      if (shouldDelete) {
        if (!dryRun) {
          await client.delete(v.key, config.project, target, service)
        }
        result.totalDeleted++
      }
    }
  }

  return result
}

// ============================================================================
// Local Sync - Pull from backend to .vaulter/local/
// ============================================================================

export interface LocalSyncOptions {
  client: VaulterClient
  config: VaulterConfig
  configDir: string
  /** Source environment to pull from */
  sourceEnvironment?: string
  /** Preview without applying */
  dryRun?: boolean
}

export interface LocalSyncResult {
  sourceEnvironment: string
  /** Shared vars synced */
  shared: {
    configs: number
    secrets: number
  }
  /** Service-specific vars synced */
  services: Record<string, { configs: number; secrets: number }>
  /** Total vars synced */
  totalSynced: number
  dryRun: boolean
}

/**
 * Sync from backend to .vaulter/local/
 *
 * This pulls:
 * - backend __shared__ → .vaulter/local/configs.env + secrets.env
 * - backend {svc} → .vaulter/local/services/{svc}/*.env
 */
export async function runLocalSync(options: LocalSyncOptions): Promise<LocalSyncResult> {
  const {
    client,
    config,
    configDir,
    sourceEnvironment,
    dryRun = false
  } = options

  const source = sourceEnvironment || resolveBaseEnvironment(config)

  const result: LocalSyncResult = {
    sourceEnvironment: source,
    shared: { configs: 0, secrets: 0 },
    services: {},
    totalSynced: 0,
    dryRun
  }

  // 1. Pull shared vars
  const sharedVars = await client.list({
    project: config.project,
    environment: source,
    service: SHARED_SERVICE
  })

  for (const v of sharedVars) {
    if (!dryRun) {
      setLocalShared(configDir, v.key, v.value, v.sensitive ?? false)
    }
    if (v.sensitive) {
      result.shared.secrets++
    } else {
      result.shared.configs++
    }
    result.totalSynced++
  }

  // 2. Get all services from backend
  const allVars = await client.list({
    project: config.project,
    environment: source
  })

  const backendServices = new Set<string>()
  for (const v of allVars) {
    if (v.service && v.service !== SHARED_SERVICE) {
      backendServices.add(v.service)
    }
  }

  // 3. Pull service-specific vars
  for (const service of backendServices) {
    result.services[service] = { configs: 0, secrets: 0 }

    const serviceVars = await client.list({
      project: config.project,
      environment: source,
      service
    })

    for (const v of serviceVars) {
      if (!dryRun) {
        setOverride(configDir, v.key, v.value, service, v.sensitive ?? false)
      }
      if (v.sensitive) {
        result.services[service].secrets++
      } else {
        result.services[service].configs++
      }
      result.totalSynced++
    }
  }

  return result
}

