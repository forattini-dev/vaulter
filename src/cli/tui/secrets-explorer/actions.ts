/**
 * Action Handlers for Secrets Explorer
 *
 * All CRUD operations and monorepo-specific actions.
 */

import { getProjectName } from '../../../lib/config-loader.js'
import type { DisplayVar, ActionResult } from './types.js'
import {
  loadedConfig,
  services,
  selectedServiceIdx,
  environments,
  selectedEnvIdx,
  getClient,
} from './store.js'
import { deleteFromEnvFile, setInEnvFile, getEnvFilePathForAction } from './utils.js'

/**
 * Delete a variable
 */
export async function performDelete(secret: DisplayVar): Promise<ActionResult> {
  const config = loadedConfig()
  if (!config) return { success: false, error: 'No config loaded' }

  const service = services()[selectedServiceIdx()]
  const env = environments()[selectedEnvIdx()]
  const project = getProjectName(config)
  const client = getClient()

  if (env === 'local') {
    const filePath = getEnvFilePathForAction(config, service?.name, env, service?.path, false)
    if (!filePath) return { success: false, error: 'Cannot find .env file' }
    deleteFromEnvFile(filePath, secret.key)
    return { success: true }
  }

  if (!client) {
    return { success: false, error: 'No backend connection' }
  }

  try {
    const targetService = secret.service === '__shared__' || !secret.service ? '__shared__' : secret.service
    await client.delete(secret.key, project, env, targetService)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Copy a variable to another environment and/or service
 */
export async function performCopy(
  secret: DisplayVar,
  targetEnv: string,
  targetServiceName?: string,
  targetServicePath?: string
): Promise<ActionResult> {
  const config = loadedConfig()
  if (!config) return { success: false, error: 'No config loaded' }

  const currentService = services()[selectedServiceIdx()]
  const project = getProjectName(config)
  const client = getClient()

  // Determine target service
  let targetService: string
  if (targetServiceName) {
    targetService = targetServiceName === '[SHARED]' ? '__shared__' : targetServiceName
  } else {
    // Keep same service as source
    targetService = secret.service === '__shared__' || !secret.service
      ? '__shared__'
      : (currentService?.name || secret.service)
  }

  if (targetEnv === 'local') {
    const svcName = targetServiceName || currentService?.name
    const svcPath = targetServicePath || currentService?.path
    const filePath = getEnvFilePathForAction(config, svcName, targetEnv, svcPath)
    if (!filePath) return { success: false, error: 'Cannot find .env file' }
    setInEnvFile(filePath, secret.key, secret.value)
    return { success: true }
  }

  if (!client) {
    return { success: false, error: 'No backend connection' }
  }

  try {
    await client.set({
      key: secret.key,
      value: secret.value,
      project,
      environment: targetEnv,
      service: targetService,
      sensitive: secret.sensitive,
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Move a variable to another environment and/or service (copy + delete)
 */
export async function performMove(
  secret: DisplayVar,
  targetEnv: string,
  targetServiceName?: string,
  targetServicePath?: string
): Promise<ActionResult> {
  // First copy to target
  const copyResult = await performCopy(secret, targetEnv, targetServiceName, targetServicePath)
  if (!copyResult.success) {
    return copyResult
  }

  // Then delete from source
  const deleteResult = await performDelete(secret)
  if (!deleteResult.success) {
    return { success: false, error: `Copied but failed to delete from source: ${deleteResult.error}` }
  }

  return { success: true }
}

/**
 * Promote a variable from service to shared (monorepo)
 */
export async function performPromote(secret: DisplayVar): Promise<ActionResult> {
  const config = loadedConfig()
  if (!config) return { success: false, error: 'No config loaded' }

  const env = environments()[selectedEnvIdx()]
  const project = getProjectName(config)
  const service = services()[selectedServiceIdx()]
  const client = getClient()

  // Handle local environment - use .env files
  if (env === 'local') {
    try {
      // Get shared env file path
      const sharedPath = getEnvFilePathForAction(config, '[SHARED]', 'local', undefined, true)
      if (!sharedPath) {
        return { success: false, error: 'Could not determine shared env file path' }
      }

      // Write to shared file
      setInEnvFile(sharedPath, secret.key, secret.value)

      // Delete from service file (only if it was a service-specific var)
      if (secret.source === 'service' || secret.source === 'override') {
        const servicePath = getEnvFilePathForAction(config, service?.name, 'local', service?.path, false)
        if (servicePath) {
          deleteFromEnvFile(servicePath, secret.key)
        }
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  if (!client) {
    return { success: false, error: 'No backend connection' }
  }

  try {
    // Set in shared
    await client.set({
      key: secret.key,
      value: secret.value,
      project,
      environment: env,
      service: '__shared__',
      sensitive: secret.sensitive,
    })

    // Delete from service (only if it was a service-specific var)
    if (secret.service && secret.service !== '__shared__') {
      await client.delete(secret.key, project, env, secret.service)
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Spread a shared variable to all services
 */
export async function performSpread(secret: DisplayVar): Promise<ActionResult> {
  const config = loadedConfig()
  if (!config) return { success: false, error: 'No config loaded' }

  const env = environments()[selectedEnvIdx()]
  const project = getProjectName(config)
  const serviceList = services()
  const client = getClient()

  // Handle local environment - use .env files
  if (env === 'local') {
    try {
      let count = 0
      for (const svc of serviceList) {
        if (svc.name === '[SHARED]') continue

        const servicePath = getEnvFilePathForAction(config, svc.name, 'local', svc.path, true)
        if (servicePath) {
          setInEnvFile(servicePath, secret.key, secret.value)
          count++
        }
      }

      return { success: true, count }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  if (!client) {
    return { success: false, error: 'No backend connection' }
  }

  try {
    let count = 0
    for (const svc of serviceList) {
      if (svc.name === '[SHARED]') continue

      await client.set({
        key: secret.key,
        value: secret.value,
        project,
        environment: env,
        service: svc.name,
        sensitive: secret.sensitive,
      })
      count++
    }

    return { success: true, count }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Add a new variable
 */
export async function performAdd(
  key: string,
  value: string,
  sensitive: boolean,
  toShared: boolean,
  targetEnv: string
): Promise<ActionResult> {
  const config = loadedConfig()
  if (!config) return { success: false, error: 'No config loaded' }

  const service = services()[selectedServiceIdx()]
  const project = getProjectName(config)
  const client = getClient()

  const targetService = toShared ? '__shared__' : (service?.name === '[SHARED]' ? '__shared__' : service?.name)

  if (targetEnv === 'local') {
    const filePath = getEnvFilePathForAction(config, toShared ? '[SHARED]' : service?.name, targetEnv, service?.path)
    if (!filePath) return { success: false, error: 'Cannot find .env file' }
    setInEnvFile(filePath, key, value)
    return { success: true }
  }

  if (!client) {
    return { success: false, error: 'No backend connection' }
  }

  try {
    await client.set({
      key,
      value,
      project,
      environment: targetEnv,
      service: targetService,
      sensitive,
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Edit/update a variable's value
 */
export async function performEdit(secret: DisplayVar, newValue: string): Promise<ActionResult> {
  const config = loadedConfig()
  if (!config) return { success: false, error: 'No config loaded' }

  const service = services()[selectedServiceIdx()]
  const env = environments()[selectedEnvIdx()]
  const project = getProjectName(config)
  const client = getClient()

  if (env === 'local') {
    const filePath = getEnvFilePathForAction(config, service?.name, env, service?.path)
    if (!filePath) return { success: false, error: 'Cannot find .env file' }
    setInEnvFile(filePath, secret.key, newValue)
    return { success: true }
  }

  if (!client) {
    return { success: false, error: 'No backend connection' }
  }

  try {
    const targetService = secret.service === '__shared__' || !secret.service ? '__shared__' : secret.service

    await client.set({
      key: secret.key,
      value: newValue,
      project,
      environment: env,
      service: targetService,
      sensitive: secret.sensitive,
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Delete all service-specific variables (keeping only shared)
 * This "resets" a service to only inherit shared vars
 */
export async function performDeleteAllServiceVars(serviceVars: DisplayVar[]): Promise<ActionResult> {
  const config = loadedConfig()
  if (!config) return { success: false, error: 'No config loaded' }

  const service = services()[selectedServiceIdx()]
  const env = environments()[selectedEnvIdx()]
  const project = getProjectName(config)
  const client = getClient()

  if (!service || service.name === '[SHARED]') {
    return { success: false, error: 'Select a service first (not [SHARED])' }
  }

  // Filter to only service-specific and override vars (not shared)
  const varsToDelete = serviceVars.filter(v => v.source === 'service' || v.source === 'override')

  if (varsToDelete.length === 0) {
    return { success: false, error: 'No service-specific variables to delete' }
  }

  if (env === 'local') {
    try {
      const filePath = getEnvFilePathForAction(config, service.name, env, service.path, false)
      if (!filePath) return { success: false, error: 'Cannot find .env file' }

      for (const v of varsToDelete) {
        deleteFromEnvFile(filePath, v.key)
      }

      return { success: true, count: varsToDelete.length }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  if (!client) {
    return { success: false, error: 'No backend connection' }
  }

  try {
    const keysToDelete = varsToDelete.map(v => v.key)
    await client.deleteManyByKeys(keysToDelete, project, env, service.name)
    return { success: true, count: varsToDelete.length }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Move a variable from current service to another service
 */
export async function performMoveToService(
  secret: DisplayVar,
  targetServiceName: string,
  targetServicePath?: string
): Promise<ActionResult> {
  const config = loadedConfig()
  if (!config) return { success: false, error: 'No config loaded' }

  const currentService = services()[selectedServiceIdx()]
  const env = environments()[selectedEnvIdx()]
  const project = getProjectName(config)
  const client = getClient()

  if (!currentService) {
    return { success: false, error: 'No service selected' }
  }

  if (targetServiceName === currentService.name) {
    return { success: false, error: 'Target service is the same as current' }
  }

  // Handle [SHARED] as target
  const actualTargetService = targetServiceName === '[SHARED]' ? '__shared__' : targetServiceName

  if (env === 'local') {
    try {
      // 1. Write to target service's .env file
      const targetPath = getEnvFilePathForAction(
        config,
        targetServiceName,
        env,
        targetServicePath,
        true
      )
      if (!targetPath) return { success: false, error: 'Cannot find target .env file' }
      setInEnvFile(targetPath, secret.key, secret.value)

      // 2. Delete from current service's .env file (only if it's service-specific)
      if (secret.source === 'service' || secret.source === 'override') {
        const currentPath = getEnvFilePathForAction(config, currentService.name, env, currentService.path, false)
        if (currentPath) {
          deleteFromEnvFile(currentPath, secret.key)
        }
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  if (!client) {
    return { success: false, error: 'No backend connection' }
  }

  try {
    // 1. Set in target service
    await client.set({
      key: secret.key,
      value: secret.value,
      project,
      environment: env,
      service: actualTargetService,
      sensitive: secret.sensitive,
    })

    // 2. Delete from current service (only if it was service-specific)
    if (secret.service && secret.service !== '__shared__') {
      await client.delete(secret.key, project, env, secret.service)
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
