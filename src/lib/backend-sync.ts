/**
 * Vaulter Backend Sync
 *
 * Synchronizes local .vaulter/{env}/ files with backend storage.
 *
 * Push: local files → backend
 * Pull: backend → local files
 */

import type { VaulterClient } from '../client.js'
import type { Environment } from '../types.js'
import {
  loadShared,
  loadService,
  listServices,
  initEnv,
  writeEnvFile,
  getConfigsPath,
  getSecretsPath
} from './fs-store.js'

// =============================================================================
// Types
// =============================================================================

export interface PushResult {
  environment: Environment
  pushed: number
  services: string[]
  details: {
    shared: { configs: number; secrets: number }
    services: Record<string, { configs: number; secrets: number }>
  }
}

export interface PullResult {
  environment: Environment
  pulled: number
  services: string[]
  details: {
    shared: { configs: number; secrets: number }
    services: Record<string, { configs: number; secrets: number }>
  }
}

// =============================================================================
// Push: Local → Backend
// =============================================================================

export interface PushOptions {
  client: VaulterClient
  vaulterDir: string
  project: string
  environment: Environment
  dryRun?: boolean
}

/**
 * Push local files to backend
 */
export async function pushToBackend(options: PushOptions): Promise<PushResult> {
  const { client, vaulterDir, project, environment, dryRun = false } = options

  const result: PushResult = {
    environment,
    pushed: 0,
    services: [],
    details: {
      shared: { configs: 0, secrets: 0 },
      services: {}
    }
  }

  // Load and push shared vars
  const shared = loadShared(vaulterDir, environment)

  // Push shared configs
  for (const [key, value] of Object.entries(shared.configs)) {
    if (!dryRun) {
      await client.set({
        key,
        value,
        project,
        environment,
        service: '__shared__',
        sensitive: false
      })
    }
    result.pushed++
    result.details.shared.configs++
  }

  // Push shared secrets
  for (const [key, value] of Object.entries(shared.secrets)) {
    if (!dryRun) {
      await client.set({
        key,
        value,
        project,
        environment,
        service: '__shared__',
        sensitive: true
      })
    }
    result.pushed++
    result.details.shared.secrets++
  }

  // Load and push service-specific vars
  const services = listServices(vaulterDir, environment)
  result.services = services

  for (const service of services) {
    const serviceVars = loadService(vaulterDir, environment, service)
    result.details.services[service] = { configs: 0, secrets: 0 }

    // Push service configs
    for (const [key, value] of Object.entries(serviceVars.configs)) {
      if (!dryRun) {
        await client.set({
          key,
          value,
          project,
          environment,
          service,
          sensitive: false
        })
      }
      result.pushed++
      result.details.services[service].configs++
    }

    // Push service secrets
    for (const [key, value] of Object.entries(serviceVars.secrets)) {
      if (!dryRun) {
        await client.set({
          key,
          value,
          project,
          environment,
          service,
          sensitive: true
        })
      }
      result.pushed++
      result.details.services[service].secrets++
    }
  }

  return result
}

// =============================================================================
// Pull: Backend → Local
// =============================================================================

export interface PullOptions {
  client: VaulterClient
  vaulterDir: string
  project: string
  environment: Environment
  dryRun?: boolean
}

/**
 * Pull from backend to local files
 */
export async function pullFromBackend(options: PullOptions): Promise<PullResult> {
  const { client, vaulterDir, project, environment, dryRun = false } = options

  const result: PullResult = {
    environment,
    pulled: 0,
    services: [],
    details: {
      shared: { configs: 0, secrets: 0 },
      services: {}
    }
  }

  // Initialize env dir if needed
  if (!dryRun) {
    initEnv(vaulterDir, environment)
  }

  // Pull shared vars
  const sharedVars = await client.list({
    project,
    environment,
    service: '__shared__'
  })

  const sharedConfigs: Record<string, string> = {}
  const sharedSecrets: Record<string, string> = {}

  for (const v of sharedVars) {
    if (v.sensitive) {
      sharedSecrets[v.key] = v.value
      result.details.shared.secrets++
    } else {
      sharedConfigs[v.key] = v.value
      result.details.shared.configs++
    }
    result.pulled++
  }

  if (!dryRun) {
    writeEnvFile(getConfigsPath(vaulterDir, environment), sharedConfigs)
    writeEnvFile(getSecretsPath(vaulterDir, environment), sharedSecrets)
  }

  // Get all services from backend
  // We need to list all vars and extract unique services
  const allVars = await client.list({ project, environment })
  const backendServices = new Set<string>()

  for (const v of allVars) {
    if (v.service && v.service !== '__shared__') {
      backendServices.add(v.service)
    }
  }

  result.services = [...backendServices].sort()

  // Pull service-specific vars
  for (const service of result.services) {
    const serviceVars = await client.list({
      project,
      environment,
      service
    })

    result.details.services[service] = { configs: 0, secrets: 0 }

    const serviceConfigs: Record<string, string> = {}
    const serviceSecrets: Record<string, string> = {}

    for (const v of serviceVars) {
      if (v.sensitive) {
        serviceSecrets[v.key] = v.value
        result.details.services[service].secrets++
      } else {
        serviceConfigs[v.key] = v.value
        result.details.services[service].configs++
      }
      result.pulled++
    }

    if (!dryRun) {
      initEnv(vaulterDir, environment, [service])
      writeEnvFile(getConfigsPath(vaulterDir, environment, service), serviceConfigs)
      writeEnvFile(getSecretsPath(vaulterDir, environment, service), serviceSecrets)
    }
  }

  return result
}
