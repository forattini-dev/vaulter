/**
 * Centralized Reactive Store for Secrets Explorer
 *
 * Uses tuiuiu.js signals for fine-grained reactivity.
 * All state is exported as getter/setter pairs.
 */

import { createSignal, batch } from 'tuiuiu.js'
import type { VaulterConfig } from '../../../types.js'
import type {
  DisplayVar,
  ServiceInfo,
  LoadingStep,
  EnvFetchStatus,
  ActionType,
  ModalField,
  FocusArea,
} from './types.js'
import { VaulterClient } from '../../../client.js'

// ============================================================================
// Configuration & Client
// ============================================================================

const [loadedConfig, setLoadedConfig] = createSignal<VaulterConfig | null>(null)
const [isMonorepo, setIsMonorepo] = createSignal(false)

let _client: VaulterClient | null = null
export const getClient = () => _client
export const setClient = (c: VaulterClient | null) => { _client = c }

export { loadedConfig, setLoadedConfig, isMonorepo, setIsMonorepo }

// ============================================================================
// Splash Screen State
// ============================================================================

const [splashVisible, setSplashVisible] = createSignal(true)
const [loadingSteps, setLoadingSteps] = createSignal<LoadingStep[]>([
  { id: 'config', label: 'Loading configuration', status: 'pending' },
  { id: 'monorepo', label: 'Detecting monorepo', status: 'pending' },
  { id: 'services', label: 'Discovering services', status: 'pending' },
  { id: 'environments', label: 'Loading environments', status: 'pending' },
  { id: 'backend', label: 'Connecting to backend', status: 'pending' },
  { id: 'secrets', label: 'Fetching secrets', status: 'pending' },
])
const [loadingProgress, setLoadingProgress] = createSignal(0)
const [loadingError, setLoadingError] = createSignal<string | null>(null)
const [envFetchStatuses, setEnvFetchStatuses] = createSignal<EnvFetchStatus[]>([])

export {
  splashVisible, setSplashVisible,
  loadingSteps, setLoadingSteps,
  loadingProgress, setLoadingProgress,
  loadingError, setLoadingError,
  envFetchStatuses, setEnvFetchStatuses,
}

// ============================================================================
// Services & Environment Selection
// ============================================================================

const [services, setServices] = createSignal<ServiceInfo[]>([])
const [selectedServiceIdx, setSelectedServiceIdx] = createSignal(0)
const [environments, setEnvironments] = createSignal<string[]>(['dev', 'stg', 'prd'])
const [selectedEnvIdx, setSelectedEnvIdx] = createSignal(0)

export {
  services, setServices,
  selectedServiceIdx, setSelectedServiceIdx,
  environments, setEnvironments,
  selectedEnvIdx, setSelectedEnvIdx,
}

// Derived getters
export const getSelectedService = () => services()[selectedServiceIdx()]
export const getSelectedEnv = () => environments()[selectedEnvIdx()]

// ============================================================================
// Secrets Data - Environment Store (cache all vars, filter locally)
// ============================================================================

// Master cache: all vars by environment
const [envStore, setEnvStore] = createSignal<Map<string, DisplayVar[]>>(new Map())

// Currently displayed (filtered) secrets
const [secrets, setSecrets] = createSignal<DisplayVar[]>([])
const [loading, setLoading] = createSignal(false)
const [error, setError] = createSignal<string | null>(null)

export { envStore, setEnvStore, secrets, setSecrets, loading, setLoading, error, setError }

// ============================================================================
// UI State
// ============================================================================

const [showValues, setShowValues] = createSignal(false)
const [selectedSecretIdx, setSelectedSecretIdx] = createSignal(0)
const [focusArea, setFocusArea] = createSignal<FocusArea>('secrets')

// Search/filter
const [searchFilter, setSearchFilter] = createSignal('')
const [isSearching, setIsSearching] = createSignal(false)

// Scroll offset for long lists
const [scrollOffset, setScrollOffset] = createSignal(0)

// Dynamic visible rows (updated based on terminal size)
const [visibleRows, setVisibleRows] = createSignal(15)

export {
  showValues, setShowValues,
  selectedSecretIdx, setSelectedSecretIdx,
  focusArea, setFocusArea,
  searchFilter, setSearchFilter,
  isSearching, setIsSearching,
  scrollOffset, setScrollOffset,
  visibleRows, setVisibleRows,
}

// ============================================================================
// Action Modal State
// ============================================================================

const [actionType, setActionType] = createSignal<ActionType>(null)
const [actionTargetEnvIdx, setActionTargetEnvIdx] = createSignal(0)
const [actionMessage, setActionMessage] = createSignal<string | null>(null)
const [actionError, setActionError] = createSignal<string | null>(null)
const [actionLoading, setActionLoading] = createSignal(false)

export {
  actionType, setActionType,
  actionTargetEnvIdx, setActionTargetEnvIdx,
  actionMessage, setActionMessage,
  actionError, setActionError,
  actionLoading, setActionLoading,
}

// ============================================================================
// Input State (for add/edit modals)
// ============================================================================

const [inputKey, setInputKey] = createSignal('')
const [inputValue, setInputValue] = createSignal('')
const [inputSensitive, setInputSensitive] = createSignal(false)
const [inputTargetShared, setInputTargetShared] = createSignal(false)
const [inputTargetEnvIdx, setInputTargetEnvIdx] = createSignal(0)
const [targetServiceIdx, setTargetServiceIdx] = createSignal(0)

// Modal field navigation
const MODAL_FIELDS: ModalField[] = ['key', 'value', 'type', 'target', 'env']
const [modalFieldIdx, setModalFieldIdx] = createSignal(0)
export const getModalField = () => MODAL_FIELDS[modalFieldIdx()]
export { MODAL_FIELDS }

export {
  inputKey, setInputKey,
  inputValue, setInputValue,
  inputSensitive, setInputSensitive,
  inputTargetShared, setInputTargetShared,
  inputTargetEnvIdx, setInputTargetEnvIdx,
  targetServiceIdx, setTargetServiceIdx,
  modalFieldIdx, setModalFieldIdx,
}

// ============================================================================
// Helper: Update loading step
// ============================================================================

export function updateLoadingStep(id: string, status: LoadingStep['status']) {
  setLoadingSteps(steps =>
    steps.map(s => s.id === id ? { ...s, status } : s)
  )
}

// ============================================================================
// Helper: Reset action state
// ============================================================================

export function resetActionState() {
  batch(() => {
    setActionType(null)
    setActionMessage(null)
    setActionError(null)
    setActionLoading(false)
    setInputKey('')
    setInputValue('')
    setInputSensitive(false)
    setInputTargetShared(false)
    setTargetServiceIdx(0)
    setModalFieldIdx(0)
  })
}

// ============================================================================
// Helper: Reset all state (for re-initialization)
// ============================================================================

export function resetAllState() {
  batch(() => {
    setSplashVisible(true)
    setLoadingSteps([
      { id: 'config', label: 'Loading configuration', status: 'pending' },
      { id: 'monorepo', label: 'Detecting monorepo', status: 'pending' },
      { id: 'services', label: 'Discovering services', status: 'pending' },
      { id: 'environments', label: 'Loading environments', status: 'pending' },
      { id: 'backend', label: 'Connecting to backend', status: 'pending' },
      { id: 'secrets', label: 'Fetching secrets', status: 'pending' },
    ])
    setLoadingProgress(0)
    setLoadingError(null)
    setEnvFetchStatuses([])
    setServices([])
    setSelectedServiceIdx(0)
    setEnvironments(['dev', 'stg', 'prd'])
    setSelectedEnvIdx(0)
    setSecrets([])
    setLoading(false)
    setError(null)
    setShowValues(false)
    setSelectedSecretIdx(0)
    setFocusArea('secrets')
    setSearchFilter('')
    setIsSearching(false)
    setScrollOffset(0)
    resetActionState()
    setLoadedConfig(null)
    setIsMonorepo(false)
    setEnvStore(new Map())
    _client = null
  })
}

// ============================================================================
// Helper: Apply filtered secrets from store (no network)
// ============================================================================

import { filterVarsByService } from './utils.js'

/**
 * Apply filtered secrets from the envStore cache.
 * Call this when switching env/service - no network request needed.
 */
export function applyFilteredSecrets(env: string, serviceName: string | undefined): void {
  const store = envStore()
  const allVars = store.get(env) || []
  const filtered = filterVarsByService(allVars, serviceName)

  batch(() => {
    setSecrets(filtered)
    setSelectedSecretIdx(0)
    setScrollOffset(0)
    setError(allVars.length === 0 ? `No data cached for ${env}` : null)
  })
}

/**
 * Update the envStore cache for a specific environment.
 * Call this after add/edit/delete operations.
 */
export function updateEnvStoreCache(env: string, vars: DisplayVar[]): void {
  setEnvStore(store => {
    const newStore = new Map(store)
    newStore.set(env, vars)
    return newStore
  })
}

/**
 * Add a single var to the envStore cache.
 */
export function addVarToCache(env: string, newVar: DisplayVar): void {
  setEnvStore(store => {
    const newStore = new Map(store)
    const existing = newStore.get(env) || []
    // Remove old var with same key+service, add new
    const filtered = existing.filter(v => !(v.key === newVar.key && v.service === newVar.service))
    newStore.set(env, [...filtered, newVar])
    return newStore
  })
}

/**
 * Remove a var from the envStore cache.
 */
export function removeVarFromCache(env: string, key: string, service: string | undefined): void {
  setEnvStore(store => {
    const newStore = new Map(store)
    const existing = newStore.get(env) || []
    const filtered = existing.filter(v => !(v.key === key && v.service === service))
    newStore.set(env, filtered)
    return newStore
  })
}
