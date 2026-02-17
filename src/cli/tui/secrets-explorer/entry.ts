/**
 * Entry Point for Secrets Explorer
 *
 * Handles initialization and startup of the TUI.
 * Loads ALL data in ONE request for instant navigation.
 */

import {
  render,
  batch,
  setTheme,
  createTheme,
  tokyoNightTheme,
} from 'tuiuiu.js'
import { DEFAULT_ENVIRONMENTS } from '../../../types.js'
import type { VaulterConfig } from '../../../types.js'
import { loadConfig, getValidEnvironments } from '../../../lib/config-loader.js'
import {
  discoverServicesWithFallback,
  isMonorepo as checkIsMonorepo,
  findMonorepoRoot
} from '../../../lib/monorepo.js'

import type { ServiceInfo } from './types.js'
import {
  loadedConfig, setLoadedConfig,
  isMonorepo, setIsMonorepo,
  getClient,
  setSplashVisible,
  loadingSteps, setLoadingSteps,
  setLoadingProgress,
  setLoadingError,
  setEnvFetchStatuses,
  setServices,
  setSelectedServiceIdx,
  setEnvironments,
  setSelectedEnvIdx,
  setSecrets,
  setLoading,
  setError,
  setShowValues,
  setSelectedSecretIdx,
  setFocusArea,
  updateLoadingStep,
  envStore,
} from './store.js'
import { filterVarsByService, sortSecrets } from './utils.js'
import { loadAllEnvironments, loadLocalSecrets } from './loader.js'
import { SecretsExplorer } from './explorer.js'

// ============================================================================
// Helper: Calculate progress percentage
// ============================================================================

function calculateProgress(): number {
  const steps = loadingSteps()
  const done = steps.filter(s => s.status === 'done').length
  return Math.round((done / steps.length) * 100)
}

// ============================================================================
// Entry Point
// ============================================================================

// Custom theme with brighter muted color for better readability
const vaulterTheme = createTheme(tokyoNightTheme, {
  name: 'vaulter',
  foreground: {
    ...tokyoNightTheme.foreground,
    muted: '#9aa5ce',  // Brighter than default for better visibility
  },
})

export async function startSecretsExplorer(options: {
  environment?: string
  service?: string
  verbose?: boolean
} = {}): Promise<void> {
  setTheme(vaulterTheme)

  // Reset splash state
  batch(() => {
    setSplashVisible(true)
    setLoadingProgress(0)
    setLoadingError(null)
    setEnvFetchStatuses([])
    setLoadingSteps([
      { id: 'config', label: 'Loading configuration', status: 'pending' },
      { id: 'monorepo', label: 'Detecting monorepo', status: 'pending' },
      { id: 'services', label: 'Discovering services', status: 'pending' },
      { id: 'environments', label: 'Loading environments', status: 'pending' },
      { id: 'secrets', label: 'Fetching all secrets', status: 'pending' },
    ])
  })

  let config: VaulterConfig | null = null
  let monorepoRoot: string | null = null
  let discoveredServices: ServiceInfo[] = []
  let envList: string[] = ['local', ...DEFAULT_ENVIRONMENTS]
  let defaultEnvIdx = 0

  const performLoading = async () => {
    try {
      await new Promise(r => setTimeout(r, 100))

      // Step 1: Load config
      updateLoadingStep('config', 'loading')
      await new Promise(r => setTimeout(r, 150))
      config = loadConfig()
      if (!config || !config.project) {
        throw new Error('No .vaulter/config.yaml found. Run "vaulter init" first.')
      }
      setLoadedConfig(config)
      updateLoadingStep('config', 'done')
      setLoadingProgress(calculateProgress())

      // Step 2: Detect monorepo
      updateLoadingStep('monorepo', 'loading')
      await new Promise(r => setTimeout(r, 100))
      monorepoRoot = findMonorepoRoot()
      setIsMonorepo(monorepoRoot ? checkIsMonorepo(monorepoRoot) : false)
      updateLoadingStep('monorepo', 'done')
      setLoadingProgress(calculateProgress())

      // Step 3: Discover services
      updateLoadingStep('services', 'loading')
      await new Promise(r => setTimeout(r, 150))

      discoveredServices = monorepoRoot && config ? discoverServicesWithFallback(config, monorepoRoot) : []

      // Add [SHARED] as first service
      if (discoveredServices.length > 0) {
        discoveredServices = [
          { name: '[SHARED]', path: '' },
          ...discoveredServices
        ]
      }

      updateLoadingStep('services', 'done')
      setLoadingProgress(calculateProgress())

      // Step 4: Load environments list
      updateLoadingStep('environments', 'loading')
      await new Promise(r => setTimeout(r, 100))
      const remoteEnvs = getValidEnvironments(config)
      envList = ['local', ...remoteEnvs]
      defaultEnvIdx = 0
      if (options.environment && options.environment !== 'local') {
        const idx = envList.indexOf(options.environment)
        if (idx >= 0) defaultEnvIdx = idx
      }
      updateLoadingStep('environments', 'done')
      setLoadingProgress(calculateProgress())

      // Step 5: Load ALL secrets in ONE request
      updateLoadingStep('secrets', 'loading')

      // Show loading status
      setEnvFetchStatuses([{ env: 'all', status: 'loading' as const }])

      await loadAllEnvironments(config, envList, (phase, info) => {
        if (phase === 'done') {
          setEnvFetchStatuses([{
            env: 'all',
            status: info?.error ? 'error' as const : 'done' as const,
            varsCount: info?.totalVars,
            durationMs: info?.durationMs,
            error: info?.error,
          }])
        }
      })

      updateLoadingStep('secrets', 'done')
      setLoadingProgress(100)

      // Get initial secrets from cache
      const initialServiceIdx = discoveredServices.length > 1 ? 1 : 0
      const initialServiceInfo = discoveredServices[initialServiceIdx]
      const selectedEnv = envList[defaultEnvIdx]

      let initialSecrets = []
      if (selectedEnv === 'local') {
        initialSecrets = sortSecrets(loadLocalSecrets(config, initialServiceInfo))
      } else {
        const cachedVars = envStore().get(selectedEnv) || []
        initialSecrets = sortSecrets(filterVarsByService(cachedVars, initialServiceInfo?.name))
      }

      // Initialize main explorer state
      batch(() => {
        setServices(discoveredServices)
        setEnvironments(envList)
        setSelectedEnvIdx(defaultEnvIdx)
        setSelectedServiceIdx(initialServiceIdx)
        setSelectedSecretIdx(0)
        setFocusArea(isMonorepo() ? 'services' : 'secrets')
        setShowValues(false)
        setLoading(false)
        setError(null)
        setSecrets(initialSecrets)
      })

      await new Promise(r => setTimeout(r, 300))
      setSplashVisible(false)

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setLoadingError(errorMsg)
      setLoadingSteps(steps =>
        steps.map(s => s.status === 'loading' ? { ...s, status: 'error' } : s)
      )
    }
  }

  performLoading()

  const { waitUntilExit } = render(() =>
    SecretsExplorer({
      config: loadedConfig(),
      isMonorepo: isMonorepo(),
    })
  )

  await waitUntilExit()

  // Cleanup
  const client = getClient()
  if (client) {
    await client.disconnect().catch(() => {})
  }
}
