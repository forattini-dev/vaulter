/**
 * Data Loading for Secrets Explorer
 *
 * Loads ALL data in ONE request, then filters locally.
 * Uses lib functions for all file operations (lib first!)
 */

import { batch } from 'tuiuiu.js'
import type { VaulterConfig } from '../../../types.js'
import { getProjectName, findConfigDir } from '../../../lib/config-loader.js'
import { loadLocalShared } from '../../../lib/local.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import type { DisplayVar, ServiceInfo } from './types.js'
import {
  loadedConfig,
  setLoading,
  setError,
  setSecrets,
  setSelectedSecretIdx,
  setScrollOffset,
  getClient,
  setClient,
  envStore,
  setEnvStore,
} from './store.js'
import { findEnvFilePath, parseEnvFile, filterVarsByService, sortSecrets, getAllVarsFromEnvFile, varsToDisplayVars } from './utils.js'
import type { LocalSyncStatus } from './types.js'

/**
 * Load ALL vars for a project in ONE request.
 * Groups by environment locally for instant navigation.
 */
export async function loadAllEnvironments(
  config: VaulterConfig,
  envList: string[],
  onProgress?: (phase: 'connecting' | 'fetching' | 'done', info?: { totalVars?: number, durationMs?: number, error?: string }) => void
): Promise<Map<string, DisplayVar[]>> {
  const project = getProjectName(config)
  const store = new Map<string, DisplayVar[]>()

  // Initialize empty arrays for all envs (including local)
  for (const env of envList) {
    store.set(env, [])
  }

  // Skip if no remote envs
  const remoteEnvs = envList.filter(e => e !== 'local')
  if (remoteEnvs.length === 0) {
    setEnvStore(store)
    onProgress?.('done', { totalVars: 0, durationMs: 0 })
    return store
  }

  // Connect to backend
  onProgress?.('connecting')
  let client = getClient()
  if (!client) {
    client = await createClientFromConfig({
      config,
      project,
      environment: remoteEnvs[0],
      args: { _: [] },
    })
    await client.connect()
    setClient(client)
  }

  // ONE request to get ALL vars for the project
  onProgress?.('fetching')
  const startTime = Date.now()

  try {
    const allVars = await client.list({ project })
    const durationMs = Date.now() - startTime

    // Group by environment locally
    for (const v of allVars) {
      const env = v.environment
      if (!store.has(env)) store.set(env, [])

      const displayVar: DisplayVar = {
        ...v,
        source: (v.service === '__shared__' || !v.service) ? 'shared' as const : 'service' as const,
      }
      store.get(env)!.push(displayVar)
    }

    setEnvStore(store)
    onProgress?.('done', { totalVars: allVars.length, durationMs })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setEnvStore(store)
    onProgress?.('done', { totalVars: 0, durationMs: 0, error: msg })
  }

  return store
}

/**
 * Load secrets for LOCAL environment (reads from .env files)
 * For services, merges shared vars + service-specific vars (like remote envs)
 * Uses lib/local.ts functions (lib first!)
 */
export function loadLocalSecrets(
  config: VaulterConfig,
  serviceInfo: ServiceInfo | undefined
): DisplayVar[] {
  const service = serviceInfo?.name
  const servicePath = serviceInfo?.path
  const isShared = service === '[SHARED]'

  // Use lib function for loading shared vars
  const configDir = findConfigDir()
  const sharedRecord = configDir ? loadLocalShared(configDir) : {}
  const sharedVars = varsToDisplayVars(sharedRecord, 'shared')

  // If viewing [SHARED], return only shared vars
  if (isShared) {
    return sharedVars
  }

  // Load service-specific vars from .env file
  const envFilePath = findEnvFilePath(config, service, servicePath)
  const serviceVars = envFilePath ? parseEnvFile(envFilePath, 'service') : []

  // Merge: service-specific overrides shared (same logic as filterVarsByService)
  const merged = new Map<string, DisplayVar>()

  for (const v of sharedVars) {
    merged.set(v.key, v)
  }

  const sharedKeys = new Set(sharedVars.map(v => v.key))
  for (const v of serviceVars) {
    const source = sharedKeys.has(v.key) ? 'override' : 'service'
    merged.set(v.key, { ...v, source: source as DisplayVar['source'] })
  }

  return Array.from(merged.values())
}

/**
 * Get local .env file vars for a service
 */
function getLocalEnvVars(config: VaulterConfig, serviceInfo: ServiceInfo | undefined): Record<string, string> {
  const service = serviceInfo?.name
  const servicePath = serviceInfo?.path

  // Find the .env file
  const envFilePath = findEnvFilePath(config, service, servicePath)
  if (!envFilePath) return {}

  try {
    return getAllVarsFromEnvFile(envFilePath)
  } catch {
    return {}
  }
}

/**
 * Compute local sync status for a variable
 */
function computeLocalStatus(
  key: string,
  backendValue: string,
  localVars: Record<string, string>
): { status: LocalSyncStatus; localValue?: string } {
  if (!(key in localVars)) {
    return { status: 'missing' }
  }

  const localValue = localVars[key]
  if (localValue === backendValue) {
    return { status: 'synced' }
  }

  return { status: 'modified', localValue }
}

/**
 * Apply cached secrets from store (no network).
 * Call this when switching env/service - instant!
 */
export function applySecretsFromStore(
  env: string,
  serviceInfo: ServiceInfo | undefined
): void {
  const config = loadedConfig()
  const store = envStore()
  const service = serviceInfo?.name

  // For local env, load from files
  if (env === 'local' && config) {
    const vars = loadLocalSecrets(config, serviceInfo)
    const sorted = sortSecrets(vars)
    batch(() => {
      setSecrets(sorted)
      setSelectedSecretIdx(0)
      setScrollOffset(0)
      setError(vars.length === 0 ? `No .env file found for ${service || 'service'}` : null)
    })
    return
  }

  // For remote envs, filter from cache
  const allVars = store.get(env) || []
  const filtered = filterVarsByService(allVars, service)

  // Add local sync status if config exists
  let varsWithStatus = filtered
  if (config) {
    const localVars = getLocalEnvVars(config, serviceInfo)
    varsWithStatus = filtered.map(v => {
      const { status, localValue } = computeLocalStatus(v.key, v.value, localVars)
      return { ...v, localStatus: status, localValue }
    })

    // Add local-only vars (vars that exist in local .env but not in backend)
    const backendKeys = new Set(filtered.map(v => v.key))
    const localOnlyVars: DisplayVar[] = Object.entries(localVars)
      .filter(([key]) => !backendKeys.has(key))
      .map(([key, value]) => ({
        id: `local:${key}`,
        key,
        value,
        project: config.project,
        environment: env,
        sensitive: key.toUpperCase().includes('KEY') || key.toUpperCase().includes('SECRET'),
        createdAt: new Date(),
        updatedAt: new Date(),
        source: 'local' as const,
        localStatus: 'local-only' as LocalSyncStatus,
      }))

    varsWithStatus = [...varsWithStatus, ...localOnlyVars]
  }

  const sorted = sortSecrets(varsWithStatus)

  batch(() => {
    setSecrets(sorted)
    setSelectedSecretIdx(0)
    setScrollOffset(0)
    setError(allVars.length === 0 ? `No data for ${env}` : null)
  })
}

/**
 * Reload ALL data from backend and update cache.
 * Call this after add/edit/delete operations.
 */
export async function reloadEnvironment(_env: string): Promise<void> {
  const config = loadedConfig()
  if (!config) return

  const client = getClient()
  if (!client) return

  const project = getProjectName(config)

  setLoading(true)
  try {
    // Reload everything in one request
    const allVars = await client.list({ project })

    // Rebuild the store
    const newStore = new Map<string, DisplayVar[]>()
    for (const v of allVars) {
      const env = v.environment
      if (!newStore.has(env)) newStore.set(env, [])

      const displayVar: DisplayVar = {
        ...v,
        source: (v.service === '__shared__' || !v.service) ? 'shared' as const : 'service' as const,
      }
      newStore.get(env)!.push(displayVar)
    }

    setEnvStore(newStore)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setError(`Reload failed: ${msg}`)
  } finally {
    setLoading(false)
  }
}
