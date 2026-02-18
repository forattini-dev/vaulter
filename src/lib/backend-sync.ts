/**
 * Vaulter Backend Sync
 *
 * Synchronizes local .vaulter/{env}/ files with backend storage.
 *
 * Push: local files → backend
 * Pull: backend → local files
 */

import type { VaulterClient } from '../client.js'
import type { Environment, VaulterConfig } from '../types.js'
import {
  loadShared,
  loadService,
  listServices,
  initEnv,
  writeEnvFile,
  getConfigsPath,
  getSecretsPath
} from './fs-store.js'
import {
  evaluateWriteGuard,
  formatWriteGuardLines,
  type WriteVariable
} from './write-guard.js'

// =============================================================================
// Types
// =============================================================================

export interface PushResult {
  environment: Environment
  pushed: number
  services: string[]
  guardWarnings: string[]
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
  config?: VaulterConfig | null
  policyMode?: string
  guardrailMode?: string
}

interface WriteGroup {
  scope: 'shared' | 'service'
  service?: string
  variables: WriteVariable[]
}

function toWriteGroup(
  scope: 'shared' | 'service',
  entries: Record<string, string>,
  sensitive: boolean,
  service?: string
): WriteGroup {
  return {
    scope,
    service,
    variables: Object.entries(entries).map(([key, value]) => ({ key, value, sensitive }))
  }
}

function flattenWriteGroups(groups: WriteGroup[]): WriteVariable[] {
  return groups.flatMap((g) => g.variables)
}

async function applyWriteGroup(
  client: VaulterClient,
  project: string,
  environment: Environment,
  group: WriteGroup,
  options: {
    dryRun?: boolean
    config?: VaulterConfig | null
    policyMode?: string
    guardrailMode?: string
  },
  warnings: string[]
): Promise<number> {
  if (group.variables.length === 0) return 0

  const guard = evaluateWriteGuard({
    variables: group.variables,
    targetScope: group.scope,
    targetService: group.scope === 'shared' ? undefined : group.service,
    environment,
    config: options.config,
    policyMode: options.policyMode,
    guardrailMode: options.guardrailMode
  })

  if (guard.blocked) {
    const label = group.scope === 'shared'
      ? '[shared]'
      : `[service:${group.service}]`

    throw new Error([
      `Write blocked by validation for ${label}.`,
      ...formatWriteGuardLines(guard).map((line) => `${label} ${line}`),
      '',
      'Set VAULTER_SCOPE_POLICY=warn or VAULTER_SCOPE_POLICY=off to relax scope checks.',
      'Set VAULTER_VALUE_GUARDRAILS=warn or VAULTER_VALUE_GUARDRAILS=off to relax value checks.'
    ].join('\n'))
  }

  if (guard.scopeIssueSummary || guard.valueIssueSummary) {
    const lines = formatWriteGuardLines(guard)
    if (group.scope === 'shared') {
      warnings.push('[shared]')
    } else {
      warnings.push(`[service:${group.service}]`)
    }
    warnings.push(...lines.map((line) => `  ${line}`))
  }

  if (options.dryRun) return group.variables.length

  await client.setMany(group.variables.map((item) => ({
    key: item.key,
    value: item.value,
    project,
    environment,
    service: group.scope === 'shared' ? '__shared__' : group.service!,
    sensitive: item.sensitive,
    metadata: { source: 'sync' }
  })))

  return group.variables.length
}

export async function pushToBackend(options: PushOptions): Promise<PushResult> {
  const {
    client,
    vaulterDir,
    project,
    environment,
    dryRun = false,
    config
  } = options

  const result: PushResult = {
    environment,
    pushed: 0,
    services: [],
    guardWarnings: [],
    details: {
      shared: { configs: 0, secrets: 0 },
      services: {}
    }
  }

  const shared = loadShared(vaulterDir, environment)
  const sharedConfigEntries = toWriteGroup('shared', shared.configs, false)
  const sharedSecretEntries = toWriteGroup('shared', shared.secrets, true)
  const sharedGuardInput = flattenWriteGroups([sharedConfigEntries, sharedSecretEntries])

  if (sharedGuardInput.length > 0) {
    const sharedPushed = await applyWriteGroup(
      client,
      project,
      environment,
      {
        scope: 'shared',
        variables: sharedGuardInput
      },
      {
        dryRun,
        config,
        policyMode: options.policyMode,
        guardrailMode: options.guardrailMode
      },
      result.guardWarnings
    )
    result.pushed += sharedPushed
    result.details.shared.configs += Object.keys(shared.configs).length
    result.details.shared.secrets += Object.keys(shared.secrets).length
  }

  const services = listServices(vaulterDir, environment)
  result.services = services

  for (const service of services) {
    const serviceVars = loadService(vaulterDir, environment, service)
    const serviceConfigEntries = toWriteGroup('service', serviceVars.configs, false, service)
    const serviceSecretEntries = toWriteGroup('service', serviceVars.secrets, true, service)
    const serviceEntries = flattenWriteGroups([serviceConfigEntries, serviceSecretEntries])

    result.details.services[service] = {
      configs: Object.keys(serviceVars.configs).length,
      secrets: Object.keys(serviceVars.secrets).length
    }

    if (serviceEntries.length === 0) continue

    const written = await applyWriteGroup(
      client,
      project,
      environment,
      {
        scope: 'service',
        service,
        variables: serviceEntries
      },
      {
        dryRun,
        config,
        policyMode: options.policyMode,
        guardrailMode: options.guardrailMode
      },
      result.guardWarnings
    )

    result.pushed += written
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

  if (!dryRun) {
    initEnv(vaulterDir, environment)
  }

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

  const allVars = await client.list({ project, environment })
  const backendServices = new Set<string>()
  for (const v of allVars) {
    if (v.service && v.service !== '__shared__') {
      backendServices.add(v.service)
    }
  }

  result.services = [...backendServices].sort()

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
