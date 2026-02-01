/**
 * Secrets Explorer Tab
 *
 * Wraps the secrets explorer for the unified shell.
 * Uses shared utilities from secrets-explorer module (lib-first architecture).
 */

import {
  Box,
  Text,
  Spacer,
  Badge,
  createSignal,
  batch,
  useHotkeys,
} from 'tuiuiu.js'
import path from 'node:path'
import type { VaulterConfig, EnvVar } from '../../../types.js'
import { getProjectName } from '../../../lib/config-loader.js'
import { type ServiceInfo } from '../../../lib/monorepo.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import { VaulterClient } from '../../../client.js'
import { maskValue as baseMaskValue } from '../../../lib/masking.js'
// Use shared utilities from secrets-explorer module (lib-first!)
import {
  findEnvFilePath,
  parseEnvFile as parseEnvFileToDisplayVars,
  filterVarsByService,
  getEnvColor,
  getSourceColor,
} from '../secrets-explorer/utils.js'
import type { DisplayVar } from '../secrets-explorer/types.js'

// Re-export types
export type { DisplayVar }

// ============================================================================
// Module-level signals
// ============================================================================

const [services, setServices] = createSignal<ServiceInfo[]>([])
const [selectedServiceIdx, setSelectedServiceIdx] = createSignal(0)
const [environments, setEnvironments] = createSignal<string[]>(['local', 'dev', 'stg', 'prd'])
const [selectedEnvIdx, setSelectedEnvIdx] = createSignal(0)
const [secrets, setSecrets] = createSignal<DisplayVar[]>([])
const [loading, setLoading] = createSignal(false)
const [error, setError] = createSignal<string | null>(null)
const [searchFilter, _setSearchFilter] = createSignal('')
const [isSearching, _setIsSearching] = createSignal(false)
const [scrollOffset, setScrollOffset] = createSignal(0)
const [showValues, setShowValues] = createSignal(false)
const [selectedSecretIdx, setSelectedSecretIdx] = createSignal(0)
const [config, setConfig] = createSignal<VaulterConfig | null>(null)
const [isMonorepo, setIsMonorepo] = createSignal(false)
const [isInitialized, setIsInitialized] = createSignal(false)

const VISIBLE_ROWS = 15

// Store for caching vars per environment
interface EnvStore {
  vars: DisplayVar[]
  timestamp: number
  error?: string
}
const envStore = new Map<string, EnvStore>()
const STORE_TTL = 30 * 60 * 1000

let currentClient: VaulterClient | null = null

// ============================================================================
// Helpers
// ============================================================================

function getEnvStore(environment: string): EnvStore | null {
  const store = envStore.get(environment)
  if (!store) return null
  if (Date.now() - store.timestamp > STORE_TTL) {
    envStore.delete(environment)
    return null
  }
  return store
}

function setEnvStore(environment: string, vars: DisplayVar[], err?: string): void {
  envStore.set(environment, { vars, timestamp: Date.now(), error: err })
}

export function invalidateSecretsCache(environment?: string): void {
  if (environment) {
    envStore.delete(environment)
  } else {
    envStore.clear()
  }
}

// filterVarsByService and getEnvColor are now imported from secrets-explorer/utils.js

function maskValue(value: string, show: boolean): string {
  if (show) return value.length > 50 ? value.substring(0, 47) + '...' : value
  return baseMaskValue(value, { maskChar: '•', visibleStart: 3, visibleEnd: 3 })
}

// ============================================================================
// Data Loading
// ============================================================================

// parseEnvFile and findEnvFilePath are now imported from secrets-explorer/utils.js

async function loadSecrets(
  cfg: VaulterConfig,
  serviceInfo: ServiceInfo | undefined,
  environment: string,
  forceRefresh = false
): Promise<void> {
  const service = serviceInfo?.name
  const servicePath = serviceInfo?.path

  if (environment === 'local') {
    setLoading(true)
    setError(null)

    let vars: DisplayVar[] = []
    const isSharedView = service === '[SHARED]'

    if (isSharedView) {
      // Unified structure: shared files at .vaulter/local/configs.env
      const sharedPath = path.join(process.cwd(), '.vaulter', 'local', 'configs.env')
      vars = parseEnvFileToDisplayVars(sharedPath, 'shared')
    } else {
      const envFilePath = findEnvFilePath(cfg, service, servicePath)
      if (envFilePath) {
        vars = parseEnvFileToDisplayVars(envFilePath, 'service')
      }
    }

    batch(() => {
      setSecrets(vars)
      setSelectedSecretIdx(0)
      setError(vars.length === 0 ? `No .env file found for ${isSharedView ? 'shared' : service}` : null)
      setLoading(false)
    })
    return
  }

  // Remote: check store
  if (!forceRefresh) {
    const store = getEnvStore(environment)
    if (store) {
      if (store.error) {
        batch(() => {
          setError(store.error!)
          setSecrets([])
          setLoading(false)
        })
      } else {
        const filtered = filterVarsByService(store.vars, service)
        batch(() => {
          setSecrets(filtered)
          setSelectedSecretIdx(0)
          setError(null)
          setLoading(false)
        })
      }
      return
    }
  }

  setLoading(true)
  setError(null)

  const project = getProjectName(cfg)

  try {
    if (!currentClient) {
      currentClient = await createClientFromConfig({
        config: cfg,
        project,
        environment,
        args: { _: [] },
      })
    }
    await currentClient.connect()
  } catch (connErr) {
    currentClient = null
    const msg = connErr instanceof Error ? connErr.message : String(connErr)
    const errMsg = msg.includes('credentials') || msg.includes('AWS')
      ? `${environment.toUpperCase()} requires S3 backend. Press 1 for LOCAL.`
      : `Connection failed: ${msg.substring(0, 50)}...`
    setEnvStore(environment, [], errMsg)
    batch(() => {
      setError(errMsg)
      setSecrets([])
      setLoading(false)
    })
    return
  }

  let allVars: EnvVar[]
  try {
    allVars = await currentClient.list({ project, environment })
  } catch (listErr) {
    const msg = listErr instanceof Error ? listErr.message : String(listErr)
    const errMsg = `List error: ${msg.substring(0, 50)}`
    setEnvStore(environment, [], errMsg)
    batch(() => {
      setError(errMsg)
      setSecrets([])
      setLoading(false)
    })
    return
  }

  const displayVars: DisplayVar[] = allVars.map(v => ({
    ...v,
    source: (v.service === '__shared__' || !v.service) ? 'shared' as const : 'service' as const,
  }))
  setEnvStore(environment, displayVars)

  const filtered = filterVarsByService(displayVars, service)
  batch(() => {
    setSecrets(filtered)
    setSelectedSecretIdx(0)
    setError(null)
    setLoading(false)
  })
}

// ============================================================================
// Init Function (called once when shell starts)
// ============================================================================

export async function initSecretsExplorer(
  cfg: VaulterConfig,
  discoveredServices: ServiceInfo[],
  envList: string[],
  options: { environment?: string; service?: string } = {}
): Promise<void> {
  batch(() => {
    setConfig(cfg)
    setServices(discoveredServices)
    setEnvironments(envList)
    setIsMonorepo(discoveredServices.length > 0)
  })

  // Determine initial environment
  let defaultEnvIdx = 0 // Start with LOCAL
  if (options.environment && options.environment !== 'local') {
    const idx = envList.indexOf(options.environment)
    if (idx >= 0) defaultEnvIdx = idx
  }
  setSelectedEnvIdx(defaultEnvIdx)

  // Initial service
  const initialServiceIdx = discoveredServices.length > 1 ? 1 : 0
  setSelectedServiceIdx(initialServiceIdx)

  const environment = envList[defaultEnvIdx]
  const serviceInfo = discoveredServices[initialServiceIdx]

  // Pre-fetch all remote environments
  const project = getProjectName(cfg)
  const remoteEnvs = envList.filter(e => e !== 'local')

  if (remoteEnvs.length > 0) {
    try {
      currentClient = await createClientFromConfig({
        config: cfg,
        project,
        environment: remoteEnvs[0],
        args: { _: [] },
      })
      await currentClient.connect()

      // Fetch all environments in parallel
      await Promise.all(remoteEnvs.map(async (env) => {
        try {
          const allVars = await currentClient!.list({ project, environment: env })
          const displayVars: DisplayVar[] = allVars.map(v => ({
            ...v,
            source: (v.service === '__shared__' || !v.service) ? 'shared' as const : 'service' as const,
          }))
          setEnvStore(env, displayVars)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setEnvStore(env, [], msg)
        }
      }))
    } catch (err) {
      // Connection failed - will show error when switching to remote env
      currentClient = null
    }
  }

  // Load initial secrets
  await loadSecrets(cfg, serviceInfo, environment)

  setIsInitialized(true)
}

// ============================================================================
// Components
// ============================================================================

function ServiceList() {
  const serviceList = services()
  const selected = selectedServiceIdx()
  const maxNameWidth = 18

  if (serviceList.length === 0) {
    return Box({ padding: 1 }, Text({ color: 'muted' }, 'No services'))
  }

  const truncateName = (name: string) => {
    if (name.length <= maxNameWidth) return name
    return name.substring(0, maxNameWidth - 1) + '…'
  }

  return Box(
    { flexDirection: 'column', padding: 1, width: 24 },
    Text({ color: 'foreground', bold: true }, 'SERVICES'),
    Box({ height: 1 }),
    ...serviceList.map((svc, idx) => {
      const isSelected = idx === selected
      const color = isSelected ? 'primary' : 'foreground'
      const prefix = isSelected ? '▸ ' : '  '
      return Text({ color, bold: isSelected }, `${prefix}${truncateName(svc.name)}`)
    })
  )
}

function EnvTabs() {
  const envList = environments()
  const selected = selectedEnvIdx()

  return Box(
    { flexDirection: 'row', gap: 2, paddingX: 1 },
    ...envList.map((env, idx) => {
      const isSelected = idx === selected
      const label = `${idx + 1}:${env.toUpperCase()}`
      if (isSelected) {
        return Badge({ label, color: getEnvColor(env) })
      }
      return Text({ color: 'muted' }, label)
    })
  )
}

function SecretsTable() {
  const allSecrets = secrets()
  const selected = selectedSecretIdx()
  const show = showValues()
  const isLoading = loading()
  const err = error()
  const filter = searchFilter()
  const searching = isSearching()
  const offset = scrollOffset()

  if (isLoading) {
    return Box(
      { padding: 2, flexDirection: 'row' },
      Text({ color: 'primary' }, '● '),
      Text({ color: 'foreground' }, 'Loading...')
    )
  }

  if (err) {
    return Box(
      { padding: 2, flexDirection: 'column', gap: 1 },
      Text({ color: 'error' }, err)
    )
  }

  const secretList = filter
    ? allSecrets.filter(s => s.key.toLowerCase().includes(filter.toLowerCase()))
    : allSecrets

  if (secretList.length === 0 && !filter) {
    return Box(
      { padding: 2 },
      Text({ color: 'muted' }, 'No variables found.')
    )
  }

  const truncate = (s: string, len: number) => s.length > len ? s.substring(0, len - 3) + '...' : s.padEnd(len)

  // getSourceColor is imported from secrets-explorer/utils.js

  const visibleSecrets = secretList.slice(offset, offset + VISIBLE_ROWS)
  const hasMore = secretList.length > offset + VISIBLE_ROWS
  const hasPrev = offset > 0

  return Box(
    { flexDirection: 'column', padding: 1 },
    searching
      ? Box(
          { flexDirection: 'row', paddingX: 1, paddingBottom: 1 },
          Text({ color: 'primary' }, '/ '),
          Text({ color: 'foreground' }, filter),
          Text({ color: 'primary' }, '▌')
        )
      : filter
        ? Box(
            { flexDirection: 'row', paddingX: 1, paddingBottom: 1 },
            Text({ color: 'muted' }, `Filter: "${filter}" (${secretList.length} matches) - Esc to clear`)
          )
        : null,
    Box(
      { flexDirection: 'row', paddingX: 1 },
      Box({ width: 2 }, Text({ color: 'muted' }, ' ')),
      Box({ width: 22 }, Text({ color: 'muted', bold: true }, 'KEY')),
      Box({ width: 26 }, Text({ color: 'muted', bold: true }, 'VALUE')),
      Box({ width: 8 }, Text({ color: 'muted', bold: true }, 'SOURCE')),
      Box({ width: 8 }, Text({ color: 'muted', bold: true }, 'TYPE'))
    ),
    hasPrev
      ? Box({ paddingX: 1 }, Text({ color: 'muted' }, `  ↑ ${offset} more above`))
      : null,
    ...visibleSecrets.map((secret, visibleIdx) => {
      const actualIdx = offset + visibleIdx
      const isSelected = actualIdx === selected
      const prefix = isSelected ? '▸' : ' '
      const keyColor = isSelected ? 'primary' : 'foreground'
      const valueColor = isSelected ? 'primary' : 'muted'

      return Box(
        { flexDirection: 'row', paddingX: 1 },
        Box({ width: 2 }, Text({ color: isSelected ? 'primary' : 'muted' }, prefix)),
        Box({ width: 22 }, Text({ color: keyColor, bold: isSelected }, truncate(secret.key, 20))),
        Box({ width: 26 }, Text({ color: valueColor }, truncate(maskValue(secret.value, show), 24))),
        Box({ width: 8 }, Text({ color: getSourceColor(secret.source) }, secret.source)),
        Box({ width: 8 }, Text({ color: secret.sensitive ? 'warning' : 'info' }, secret.sensitive ? 'secret' : 'config'))
      )
    }),
    hasMore
      ? Box({ paddingX: 1 }, Text({ color: 'muted' }, `  ↓ ${secretList.length - offset - VISIBLE_ROWS} more below`))
      : null,
    filter && secretList.length === 0
      ? Box({ padding: 1 }, Text({ color: 'muted' }, 'No matches found'))
      : null
  )
}

function StatusHints() {
  const isMonorepoMode = isMonorepo()
  const filter = searchFilter()
  const searching = isSearching()

  let hints: string
  if (searching) {
    hints = 'Type to search  Enter:confirm  Esc:cancel'
  } else if (filter) {
    hints = 'Esc:clear  /:search  j/k:nav  d:del  a:add  e:edit'
  } else if (isMonorepoMode) {
    hints = '/:srch j/k:nav v:vals a:add e:edit d:del p:promote S:spread'
  } else {
    hints = '/:search  j/k:nav  v:vals  a:add  e:edit  d:del  c:copy  m:move'
  }

  return Text({ color: 'muted' }, hints)
}

// ============================================================================
// Main Tab Component
// ============================================================================

export function SecretsExplorerTab() {
  const cfg = config()
  const initialized = isInitialized()
  const isMonorepoMode = isMonorepo()

  // Hotkeys for this tab
  useHotkeys('v', () => {
    if (isSearching()) return
    setShowValues(v => !v)
  })

  useHotkeys('j', () => {
    if (isSearching()) return
    const filter = searchFilter()
    const allSecrets = secrets()
    const filteredSecrets = filter
      ? allSecrets.filter(s => s.key.toLowerCase().includes(filter.toLowerCase()))
      : allSecrets
    const maxIdx = filteredSecrets.length - 1
    const newIdx = Math.min(maxIdx, selectedSecretIdx() + 1)
    setSelectedSecretIdx(newIdx)
    if (newIdx >= scrollOffset() + VISIBLE_ROWS) {
      setScrollOffset(newIdx - VISIBLE_ROWS + 1)
    }
  })

  useHotkeys('k', () => {
    if (isSearching()) return
    const newIdx = Math.max(0, selectedSecretIdx() - 1)
    setSelectedSecretIdx(newIdx)
    if (newIdx < scrollOffset()) {
      setScrollOffset(newIdx)
    }
  })

  useHotkeys('up', () => {
    const currentIdx = selectedServiceIdx()
    const newIdx = Math.max(0, currentIdx - 1)
    if (newIdx !== currentIdx) {
      setSelectedServiceIdx(newIdx)
      const cfg = config()
      if (cfg) {
        const service = services()[newIdx]
        const env = environments()[selectedEnvIdx()]
        loadSecrets(cfg, service, env)
      }
    }
  })

  useHotkeys('down', () => {
    const currentIdx = selectedServiceIdx()
    const newIdx = Math.min(services().length - 1, currentIdx + 1)
    if (newIdx !== currentIdx) {
      setSelectedServiceIdx(newIdx)
      const cfg = config()
      if (cfg) {
        const service = services()[newIdx]
        const env = environments()[selectedEnvIdx()]
        loadSecrets(cfg, service, env)
      }
    }
  })

  // Number keys for environment selection
  const selectEnv = (idx: number) => {
    if (isSearching()) return
    const envList = environments()
    if (idx < envList.length && idx !== selectedEnvIdx()) {
      setSelectedEnvIdx(idx)
      const cfg = config()
      if (cfg) {
        const service = services()[selectedServiceIdx()]
        loadSecrets(cfg, service, envList[idx])
      }
    }
  }

  useHotkeys('1', () => selectEnv(0))
  useHotkeys('2', () => selectEnv(1))
  useHotkeys('3', () => selectEnv(2))
  useHotkeys('4', () => selectEnv(3))
  useHotkeys('5', () => selectEnv(4))

  if (!initialized || !cfg) {
    return Box(
      { flexDirection: 'column', padding: 2, alignItems: 'center', justifyContent: 'center', height: '100%' },
      Text({ color: 'primary' }, '● Loading secrets...')
    )
  }

  // Layout
  const sidebar = isMonorepoMode ? ServiceList() : null

  return Box(
    { flexDirection: 'row', height: '100%' },
    sidebar,
    sidebar ? Box({ width: 1, borderStyle: 'single', borderColor: 'border' }) : null,
    Box(
      { flexDirection: 'column', flexGrow: 1 },
      Box({ paddingY: 1 }, EnvTabs()),
      Box({ flexGrow: 1 }, SecretsTable()),
      Box(
        { flexDirection: 'row', paddingX: 1, paddingY: 1, borderStyle: 'none', borderTop: true, borderColor: 'border' },
        Text({ color: 'foreground' }, `${secrets().length} vars`),
        Spacer({}),
        StatusHints()
      )
    )
  )
}
