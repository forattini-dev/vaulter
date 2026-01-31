/**
 * Types for Secrets Explorer
 */

import type { EnvVar, VaulterConfig } from '../../../types.js'

/**
 * Local sync status for variables
 * - synced: Value in local .env matches backend value
 * - modified: User has modified the value in local .env (different from backend)
 * - missing: Variable exists in backend but not in local .env
 * - local-only: Variable only exists in local .env (not in backend)
 * - n/a: Not applicable (not in local environment)
 */
export type LocalSyncStatus = 'synced' | 'modified' | 'missing' | 'local-only' | 'n/a'

/** Extended EnvVar with source tracking for display */
export interface DisplayVar extends EnvVar {
  source: 'shared' | 'service' | 'override' | 'local'
  /** Local .env sync status (only relevant when viewing local environment) */
  localStatus?: LocalSyncStatus
  /** Value in local .env file (if different from backend) */
  localValue?: string
}

/** Service info from monorepo detection */
export interface ServiceInfo {
  name: string
  path?: string
}

/** Loading step for splash screen */
export interface LoadingStep {
  id: string
  label: string
  status: 'pending' | 'loading' | 'done' | 'error'
}

/** Per-environment fetch status */
export interface EnvFetchStatus {
  env: string
  status: 'pending' | 'loading' | 'done' | 'error'
  varsCount?: number
  error?: string
  durationMs?: number
}

/** Action types for modal */
export type ActionType = 'delete' | 'copy' | 'move' | 'promote' | 'spread' | 'add' | 'edit' | 'deleteAll' | 'moveToService' | null

/** Modal field focus */
export type ModalField = 'key' | 'value' | 'type' | 'target' | 'env'

/** Focus area for navigation context */
export type FocusArea = 'services' | 'envs' | 'secrets'

/** Props for SecretsExplorer component */
export interface SecretsExplorerProps {
  config: VaulterConfig | null
  isMonorepo: boolean
}

/** Result from action operations */
export interface ActionResult {
  success: boolean
  error?: string
  count?: number
}
