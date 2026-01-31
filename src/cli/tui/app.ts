/**
 * Vaulter TUI Shell
 *
 * Unified tabbed interface for all Vaulter TUI screens.
 * F1: Secrets | F2: Audit | F3: Keys | F4: Dashboard
 */

import {
  render,
  Box,
  Text,
  Spacer,
  Badge,
  createSignal,
  batch,
  useHotkeys,
  useApp,
  setTheme,
  tokyoNightTheme,
} from 'tuiuiu.js'
import type { VaulterConfig } from '../../types.js'
import { loadConfig, getProjectName, getValidEnvironments } from '../../lib/config-loader.js'
import { discoverServices, isMonorepo, findMonorepoRoot, type ServiceInfo } from '../../lib/monorepo.js'
import {
  SecretsExplorerTab, initSecretsExplorer,
  AuditTab, initAuditTab,
  KeysTab, initKeysTab,
  DashboardTab, initDashboardTab,
} from './tabs/index.js'

// ============================================================================
// Types
// ============================================================================

type TabId = 'secrets' | 'audit' | 'keys' | 'dashboard'

interface Tab {
  id: TabId
  label: string
  shortcut: string
  color: 'primary' | 'info' | 'warning' | 'success'
}

const TABS: Tab[] = [
  { id: 'secrets', label: 'Secrets', shortcut: 'F1', color: 'primary' },
  { id: 'audit', label: 'Audit', shortcut: 'F2', color: 'info' },
  { id: 'keys', label: 'Keys', shortcut: 'F3', color: 'warning' },
  { id: 'dashboard', label: 'Dashboard', shortcut: 'F4', color: 'success' },
]

// ============================================================================
// Module-level signals
// ============================================================================

const [activeTab, setActiveTab] = createSignal<TabId>('secrets')
const [config, setConfig] = createSignal<VaulterConfig | null>(null)
const [isMonorepoMode, setIsMonorepoMode] = createSignal(false)
const [services, setServices] = createSignal<ServiceInfo[]>([])
const [environments, setEnvironments] = createSignal<string[]>(['local', 'dev', 'stg', 'prd'])
const [loadingError, setLoadingError] = createSignal<string | null>(null)
const [isReady, setIsReady] = createSignal(false)

// Export for tabs to use
export const getConfig = () => config()
export const getIsMonorepo = () => isMonorepoMode()
export const getServices = () => services()
export const getEnvironments = () => environments()

// ============================================================================
// Tab Bar Component
// ============================================================================

function TabBar() {
  const current = activeTab()

  return Box(
    { flexDirection: 'row', paddingX: 1, gap: 1, borderStyle: 'none', borderBottom: true, borderColor: 'border' },
    ...TABS.map(tab => {
      const isActive = tab.id === current
      return Box(
        { flexDirection: 'row', gap: 1, paddingX: 1 },
        Text({ color: 'muted', dim: true }, tab.shortcut),
        isActive
          ? Badge({ label: tab.label, color: tab.color })
          : Text({ color: 'muted' }, tab.label)
      )
    }),
    Spacer({}),
    Text({ color: 'muted', dim: true }, 'q:quit')
  )
}

// ============================================================================
// Status Bar Component
// ============================================================================

function AppStatusBar() {
  const cfg = config()
  const project = cfg ? getProjectName(cfg) : 'loading...'
  const monorepo = isMonorepoMode()

  return Box(
    { flexDirection: 'row', paddingX: 1, borderStyle: 'none', borderTop: true, borderColor: 'border' },
    Text({ color: 'primary', bold: true }, '◆ VAULTER'),
    Text({ color: 'muted' }, '  │  '),
    Text({ color: 'foreground' }, project),
    monorepo ? Text({ color: 'accent' }, ' (monorepo)') : null,
    Spacer({}),
    Text({ color: 'muted', dim: true }, 'Tab/Shift+Tab: switch tabs')
  )
}

// ============================================================================
// Loading Screen
// ============================================================================

function LoadingScreen() {
  const err = loadingError()

  return Box(
    { flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center' },
    Box({ flexGrow: 1 }),
    Box(
      { flexDirection: 'column', alignItems: 'center' },
      Text({ color: 'primary', bold: true }, '╦  ╦╔═╗╦ ╦╦ ╔╦╗╔═╗╦═╗'),
      Text({ color: 'primary', bold: true }, '╚╗╔╝╠═╣║ ║║  ║ ║╣ ╠╦╝'),
      Text({ color: 'primary', bold: true }, ' ╚╝ ╩ ╩╚═╝╩═╝╩ ╚═╝╩╚═'),
      Box({ height: 1 }),
      err
        ? Box(
            { flexDirection: 'column', alignItems: 'center' },
            Text({ color: 'error' }, err),
            Box({ height: 1 }),
            Text({ color: 'muted' }, 'Press q to quit')
          )
        : Text({ color: 'foreground' }, 'Loading...')
    ),
    Box({ flexGrow: 1 })
  )
}

// ============================================================================
// Main App Component
// ============================================================================

function VaulterApp() {
  const { exit } = useApp()
  const ready = isReady()
  const current = activeTab()

  // Tab switching hotkeys
  useHotkeys('f1', () => setActiveTab('secrets'))
  useHotkeys('f2', () => setActiveTab('audit'))
  useHotkeys('f3', () => setActiveTab('keys'))
  useHotkeys('f4', () => setActiveTab('dashboard'))

  // Also support alt+number for accessibility
  useHotkeys('alt+1', () => setActiveTab('secrets'))
  useHotkeys('alt+2', () => setActiveTab('audit'))
  useHotkeys('alt+3', () => setActiveTab('keys'))
  useHotkeys('alt+4', () => setActiveTab('dashboard'))

  // Tab cycling with tab/shift+tab at app level (when not in modals)
  // Note: Individual tabs may override this for their own navigation

  // Quit
  useHotkeys('q', () => {
    // Let individual tabs handle 'q' if they want
    // For now, always quit from app level
    exit()
  })

  if (!ready) {
    return LoadingScreen()
  }

  // Render active tab content
  let content: ReturnType<typeof Box>
  switch (current) {
    case 'secrets':
      content = SecretsExplorerTab()
      break
    case 'audit':
      content = AuditTab()
      break
    case 'keys':
      content = KeysTab()
      break
    case 'dashboard':
      content = DashboardTab()
      break
    default:
      content = Box({}, Text({}, 'Unknown tab'))
  }

  return Box(
    { flexDirection: 'column', height: '100%' },
    TabBar(),
    Box({ flexGrow: 1 }, content),
    AppStatusBar()
  )
}

// ============================================================================
// Entry Point
// ============================================================================

export async function startShell(options: {
  environment?: string
  service?: string
  tab?: TabId
  verbose?: boolean
} = {}): Promise<void> {
  setTheme(tokyoNightTheme)

  // Set initial tab if provided
  if (options.tab) {
    setActiveTab(options.tab)
  }

  // Reset state
  batch(() => {
    setIsReady(false)
    setLoadingError(null)
  })

  // Start render immediately to show loading
  const { waitUntilExit } = render(() => VaulterApp())

  // Async loading
  try {
    // Load config
    const cfg = loadConfig()
    if (!cfg || !cfg.project) {
      throw new Error('No .vaulter/config.yaml found. Run "vaulter init" first.')
    }
    setConfig(cfg)

    // Detect monorepo
    const monorepoRoot = findMonorepoRoot()
    const isMonorepoProject = monorepoRoot ? isMonorepo(monorepoRoot) : false
    setIsMonorepoMode(isMonorepoProject)

    // Discover services
    let discoveredServices: ServiceInfo[] = []
    if (isMonorepoProject && monorepoRoot) {
      discoveredServices = discoverServices(monorepoRoot)
    }

    // Check monorepo.services_pattern if no services found
    if (discoveredServices.length === 0 && cfg.monorepo?.services_pattern) {
      const pattern = cfg.monorepo.services_pattern
      const baseDir = pattern.replace('/*', '').replace('/**', '')
      const servicesDir = require('node:path').join(monorepoRoot || process.cwd(), baseDir)
      const fs = require('node:fs')

      if (fs.existsSync(servicesDir)) {
        const entries = fs.readdirSync(servicesDir, { withFileTypes: true })
        discoveredServices = entries
          .filter((e: any) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
          .map((e: any) => ({
            name: e.name,
            path: require('node:path').join(servicesDir, e.name),
            configDir: '',
            config: cfg,
          }))
        if (discoveredServices.length > 0) {
          setIsMonorepoMode(true)
        }
      }
    }

    // Add [SHARED] as first service
    if (discoveredServices.length > 0) {
      discoveredServices = [
        { name: '[SHARED]', path: '', configDir: '', config: cfg },
        ...discoveredServices
      ]
    }
    setServices(discoveredServices)

    // Load environments
    const remoteEnvs = getValidEnvironments(cfg)
    const envList = ['local', ...remoteEnvs]
    setEnvironments(envList)

    // Initialize each tab
    await initSecretsExplorer(cfg, discoveredServices, envList, options)
    await initAuditTab(cfg, options)
    await initKeysTab(cfg, options)
    await initDashboardTab(cfg, options)

    // Ready!
    setIsReady(true)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setLoadingError(msg)
  }

  await waitUntilExit()
}
