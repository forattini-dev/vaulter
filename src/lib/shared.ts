/**
 * Vaulter - Shared Variables Module
 *
 * Implements inheritance model for monorepo shared variables:
 * - Shared vars: Apply to ALL services (stored with service='__shared__')
 * - Service vars: Apply to specific service only
 * - Inheritance: Service inherits from shared, can override
 *
 * Resolution order (last wins):
 * 1. Shared variables (base)
 * 2. Service-specific variables (override)
 */

import type { EnvVar, Environment } from '../types.js'

/** Special service identifier for shared variables */
export const SHARED_SERVICE = '__shared__'

/**
 * Variable with inheritance metadata
 */
export interface ResolvedVar {
  key: string
  value: string
  /** Where this value came from */
  source: 'shared' | 'service' | 'override'
  /** Original service name (undefined for shared) */
  originalService?: string
}

/**
 * Inheritance statistics for a service
 */
export interface InheritanceStats {
  /** Service name */
  service: string
  /** Total variables available to this service */
  total: number
  /** Variables inherited from shared (not overridden) */
  inherited: number
  /** Variables that override shared vars */
  overrides: number
  /** Service-specific variables (no shared equivalent) */
  serviceOnly: number
}

/**
 * Check if a service name is the shared service
 */
export function isSharedService(service?: string): boolean {
  return service === SHARED_SERVICE || service === 'shared'
}

/**
 * Normalize service name for storage
 * - 'shared' or '--shared' flag → '__shared__'
 * - undefined with --shared flag → '__shared__'
 */
export function normalizeServiceName(service?: string, isShared?: boolean): string | undefined {
  if (isShared || service === 'shared') {
    return SHARED_SERVICE
  }
  return service
}

/**
 * Resolve variables for a service with inheritance from shared
 *
 * @param sharedVars - Variables from shared scope
 * @param serviceVars - Variables from service-specific scope
 * @returns Merged variables with inheritance metadata
 */
export function resolveVariables(
  sharedVars: Record<string, string>,
  serviceVars: Record<string, string>
): Map<string, ResolvedVar> {
  const resolved = new Map<string, ResolvedVar>()

  // 1. Add all shared vars as base
  for (const [key, value] of Object.entries(sharedVars)) {
    resolved.set(key, {
      key,
      value,
      source: 'shared'
    })
  }

  // 2. Add/override with service vars
  for (const [key, value] of Object.entries(serviceVars)) {
    const existing = resolved.get(key)
    if (existing && existing.source === 'shared') {
      // This is an override
      resolved.set(key, {
        key,
        value,
        source: 'override',
        originalService: SHARED_SERVICE
      })
    } else {
      // Service-only variable
      resolved.set(key, {
        key,
        value,
        source: 'service'
      })
    }
  }

  return resolved
}

/**
 * Calculate inheritance statistics for a service
 */
export function calculateInheritanceStats(
  service: string,
  sharedVars: Record<string, string>,
  serviceVars: Record<string, string>
): InheritanceStats {
  const resolved = resolveVariables(sharedVars, serviceVars)

  let inherited = 0
  let overrides = 0
  let serviceOnly = 0

  for (const v of resolved.values()) {
    switch (v.source) {
      case 'shared':
        inherited++
        break
      case 'override':
        overrides++
        break
      case 'service':
        serviceOnly++
        break
    }
  }

  return {
    service,
    total: resolved.size,
    inherited,
    overrides,
    serviceOnly
  }
}

/**
 * Convert resolved variables back to a simple Record
 */
export function toRecord(resolved: Map<string, ResolvedVar>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, v] of resolved) {
    result[key] = v.value
  }
  return result
}

/**
 * Get variables that would be affected if a shared variable is changed
 *
 * @returns List of services that inherit (not override) this key
 */
export function getAffectedServices(
  key: string,
  services: string[],
  getServiceVars: (service: string) => Record<string, string>
): string[] {
  const affected: string[] = []

  for (const service of services) {
    const serviceVars = getServiceVars(service)
    // If service doesn't have this key, it inherits from shared
    if (!(key in serviceVars)) {
      affected.push(service)
    }
  }

  return affected
}

/**
 * Format inheritance source for display
 */
export function formatSource(source: 'shared' | 'service' | 'override'): string {
  switch (source) {
    case 'shared':
      return 'inherited'
    case 'override':
      return 'override'
    case 'service':
      return 'local'
  }
}
