/**
 * Vaulter TUI Launcher
 *
 * Main menu interface for accessing all TUI screens
 * Based on tuiuiu-defence pattern - manual menu, no Select component
 */

import {
  render,
  Box,
  Text,
  Spacer,
  AppShell,
  StatusBar,
  Badge,
  Panel,
  createSignal,
  useHotkeys,
  useApp,
  setTheme,
  tokyoNightTheme,
} from 'tuiuiu.js'
import type { VaulterConfig, Environment } from '../../types.js'
import { loadConfig, getProjectName } from '../../lib/config-loader.js'

// Screen types
type Screen = 'menu' | 'dashboard' | 'audit' | 'keys'

// Menu items
const MENU_OPTIONS = [
  { value: 'dashboard' as Screen, label: '📊 Secrets Dashboard', description: 'View and manage environment variables' },
  { value: 'audit' as Screen, label: '📋 Audit Log Viewer', description: 'View audit history and filter logs' },
  { value: 'keys' as Screen, label: '🔐 Key Manager', description: 'Manage encryption keys' },
] as const

interface LauncherProps {
  config: VaulterConfig
  environment: Environment
  service?: string
  verbose?: boolean
}

// Module-level signals (like tuiuiu-defence pattern)
const [menuSelection, setMenuSelection] = createSignal(0)

// Track selected screen for return value
let selectedScreen: Screen | null = null

/**
 * Get color for environment badge
 */
function getEnvColor(env: string): 'success' | 'warning' | 'error' | 'info' {
  switch (env.toLowerCase()) {
    case 'prd':
    case 'prod':
    case 'production':
      return 'error'
    case 'stg':
    case 'staging':
      return 'warning'
    case 'dev':
    case 'development':
      return 'success'
    default:
      return 'info'
  }
}

/**
 * Header component
 */
function LauncherHeader(props: { project: string; environment: string; currentScreen: Screen }) {
  const screenNames: Record<Screen, string> = {
    menu: 'Main Menu',
    dashboard: 'Secrets Dashboard',
    audit: 'Audit Log',
    keys: 'Key Manager',
  }

  return Box(
    { flexDirection: 'row', paddingX: 1, alignItems: 'center' },
    Text({ color: 'primary', bold: true }, '◆ VAULTER'),
    Text({ color: 'muted' }, '  │  '),
    Text({ bold: true }, props.project),
    Spacer({}),
    Badge({ label: screenNames[props.currentScreen], color: 'info' }),
    Text({ color: 'muted' }, '  '),
    Badge({ label: props.environment.toUpperCase(), color: getEnvColor(props.environment) })
  )
}

/**
 * ASCII Art Logo
 */
function Logo() {
  return Box(
    { flexDirection: 'column', alignItems: 'center', gap: 0 },
    Text({ color: 'primary', bold: true }, '╦  ╦╔═╗╦ ╦╦ ╔╦╗╔═╗╦═╗'),
    Text({ color: 'primary', bold: true }, '╚╗╔╝╠═╣║ ║║  ║ ║╣ ╠╦╝'),
    Text({ color: 'primary', bold: true }, ' ╚╝ ╩ ╩╚═╝╩═╝╩ ╚═╝╩╚═'),
    Text({ color: 'muted', dim: true }, 'Secure Environment Management')
  )
}

/**
 * Main Launcher component
 */
function Launcher(props: LauncherProps) {
  const { exit } = useApp()
  const project = getProjectName(props.config)

  // Menu navigation helpers
  function moveMenuSelection(delta: number): void {
    const count = MENU_OPTIONS.length
    setMenuSelection((index) => (index + delta + count) % count)
  }

  function selectScreen(screen: Screen): void {
    selectedScreen = screen
    exit()
  }

  function activateMenuSelection(): void {
    const selected = MENU_OPTIONS[menuSelection()]
    selectScreen(selected.value)
  }

  // Keyboard handlers (like tuiuiu-defence pattern)
  useHotkeys('q', () => {
    selectedScreen = null
    exit()
  })
  useHotkeys('escape', () => {
    selectedScreen = null
    exit()
  })

  // Navigation
  useHotkeys('up', () => moveMenuSelection(-1))
  useHotkeys('k', () => moveMenuSelection(-1))
  useHotkeys('down', () => moveMenuSelection(1))
  useHotkeys('j', () => moveMenuSelection(1))

  // Select with Enter
  useHotkeys('enter', () => activateMenuSelection())

  // Quick access keys
  useHotkeys('1', () => selectScreen('dashboard'))
  useHotkeys('2', () => selectScreen('audit'))
  useHotkeys('3', () => selectScreen('keys'))

  // Menu view (manual implementation like tuiuiu-defence)
  const menuView = () => {
    const items = MENU_OPTIONS.map((item, index) => {
      const selected = menuSelection() === index
      return Box(
        { flexDirection: 'row', gap: 1, paddingX: 1 },
        Text({ color: selected ? 'primary' : 'muted', bold: selected }, selected ? '▸' : ' '),
        Text({ color: selected ? 'primary' : 'foreground', bold: selected }, item.label),
        Text({ color: 'muted', dim: true }, ` - ${item.description}`)
      )
    })

    return Box(
      { flexDirection: 'column', gap: 2, alignItems: 'center', justifyContent: 'center', height: '100%' },
      Logo(),
      Panel(
        { title: 'Main Menu', padding: 1, width: 60 },
        Box({ flexDirection: 'column', gap: 0 }, ...items)
      ),
      Box(
        { flexDirection: 'column', alignItems: 'center', gap: 0 },
        Text({ color: 'muted', dim: true }, 'Use ↑↓ to navigate, Enter to select'),
        Text({ color: 'muted', dim: true }, 'Press q to quit, or 1/2/3 for quick access')
      )
    )
  }

  // Status bar
  const statusBar = StatusBar({
    left: Text({ color: 'muted' }, 'Select an option'),
    center: undefined,
    right: Text({ color: 'muted', dim: true }, 'q:quit  1:dashboard  2:audit  3:keys'),
  })

  // Only render menu - sub-screens are handled by exiting and re-rendering
  const content = menuView()

  return AppShell({
    header: LauncherHeader({
      project,
      environment: props.environment,
      currentScreen: 'menu',
    }),
    headerHeight: 1,
    footer: statusBar,
    footerHeight: 1,
    dividers: true,
    dividerStyle: 'line',
    dividerColor: 'border',
    padding: 0,
    children: Box({ padding: 1 }, content),
  })
}

/**
 * Start the TUI Launcher
 */
export async function startLauncher(options: {
  environment?: Environment
  service?: string
  verbose?: boolean
  screen?: string
}): Promise<void> {
  // Load config
  const config = loadConfig()
  if (!config || !config.project) {
    throw new Error('No .vaulter/config.yaml found. Run "vaulter init" first.')
  }

  // Set theme BEFORE render
  setTheme(tokyoNightTheme)

  // Determine environment
  const environment = options.environment || config.default_environment || 'dev'

  // Handle direct screen access
  if (options.screen) {
    const screen = options.screen.toLowerCase()
    if (screen === 'dashboard' || screen === 'secrets') {
      const { startDashboard } = await import('./dashboard.js')
      await startDashboard({ environment, service: options.service, verbose: options.verbose })
      return
    }
    if (screen === 'audit' || screen === 'logs') {
      const { startAuditViewer } = await import('./audit-viewer.js')
      await startAuditViewer({ environment, service: options.service, verbose: options.verbose })
      return
    }
    if (screen === 'keys' || screen === 'key') {
      const { startKeyManager } = await import('./key-manager.js')
      await startKeyManager({ verbose: options.verbose })
      return
    }
  }

  // Main loop - show menu, launch selected screen, return to menu
  while (true) {
    // Reset state
    selectedScreen = null
    setMenuSelection(0)

    // Show menu
    const { waitUntilExit } = render(() =>
      Launcher({
        config,
        environment,
        service: options.service,
        verbose: options.verbose,
      })
    )

    await waitUntilExit()

    // Check what was selected
    if (!selectedScreen) {
      // User quit (q or escape)
      break
    }

    // Small delay to let tuiuiu cleanup between renders
    await new Promise(resolve => setTimeout(resolve, 50))

    // Launch selected screen
    if (selectedScreen === 'dashboard') {
      const { startDashboard } = await import('./dashboard.js')
      await startDashboard({ environment, service: options.service, verbose: options.verbose })
    } else if (selectedScreen === 'audit') {
      const { startAuditViewer } = await import('./audit-viewer.js')
      await startAuditViewer({ environment, service: options.service, verbose: options.verbose })
    } else if (selectedScreen === 'keys') {
      const { startKeyManager } = await import('./key-manager.js')
      await startKeyManager({ verbose: options.verbose })
    }

    // Small delay before returning to menu
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
