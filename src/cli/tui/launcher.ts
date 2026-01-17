/**
 * Vaulter TUI Launcher
 *
 * Main menu interface for accessing all TUI screens
 */

import {
  render,
  Box,
  Text,
  Spacer,
  AppShell,
  StatusBar,
  Badge,
  Select,
  useState,
  useHotkeys,
  useApp,
  setTheme,
  tokyoNightTheme,
} from 'tuiuiu.js'
import type { VaulterConfig, Environment } from '../../types.js'
import { loadConfig, getProjectName } from '../../lib/config-loader.js'
import { Dashboard } from './dashboard.js'
import { AuditViewer } from './audit-viewer.js'
import { KeyManager } from './key-manager.js'

// Screen types
type Screen = 'menu' | 'dashboard' | 'audit' | 'keys'

interface LauncherProps {
  config: VaulterConfig
  environment: Environment
  service?: string
  verbose?: boolean
  initialScreen?: Screen
}

// Menu items
const MENU_ITEMS = [
  {
    value: 'dashboard' as Screen,
    label: '📊 Secrets Dashboard',
    description: 'View and manage environment variables'
  },
  {
    value: 'audit' as Screen,
    label: '📋 Audit Log Viewer',
    description: 'View audit history and filter logs'
  },
  {
    value: 'keys' as Screen,
    label: '🔐 Key Manager',
    description: 'Manage encryption keys'
  }
]

/**
 * Header component
 */
function LauncherHeader(props: {
  project: string
  environment: string
  currentScreen: Screen
}) {
  const screenNames: Record<Screen, string> = {
    menu: 'Main Menu',
    dashboard: 'Secrets Dashboard',
    audit: 'Audit Log',
    keys: 'Key Manager'
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
 * Main Menu component
 */
function MainMenu(props: {
  onSelect: (screen: Screen) => void
}) {
  return Box(
    { flexDirection: 'column', gap: 2, alignItems: 'center', justifyContent: 'center', height: '100%' },
    Logo(),
    Box(
      { width: 50 },
      Select({
        items: MENU_ITEMS,
        maxVisible: 5,
        onChange: (val) => props.onSelect(val as Screen),
        cursorIndicator: '▸',
        colorActive: 'primary'
      })
    ),
    Box(
      { flexDirection: 'column', alignItems: 'center', gap: 0 },
      Text({ color: 'muted', dim: true }, 'Use ↑↓ to navigate, Enter to select'),
      Text({ color: 'muted', dim: true }, 'Press q to quit')
    )
  )
}

/**
 * Main Launcher component
 */
function Launcher(props: LauncherProps) {
  const app = useApp()
  const [currentScreen, setCurrentScreen] = useState<Screen>(props.initialScreen || 'menu')
  const [isNavigating, setIsNavigating] = useState(false)

  const project = getProjectName(props.config)

  // Register hotkeys
  useHotkeys('q', () => {
    if (currentScreen() === 'menu') {
      app.exit()
    } else {
      setCurrentScreen('menu')
    }
  }, { description: 'Quit/Back' })

  useHotkeys('escape', () => {
    if (currentScreen() !== 'menu') {
      setCurrentScreen('menu')
    }
  }, { description: 'Back to menu' })

  // Quick access keys
  useHotkeys('1', () => setCurrentScreen('dashboard'), { description: 'Dashboard' })
  useHotkeys('2', () => setCurrentScreen('audit'), { description: 'Audit' })
  useHotkeys('3', () => setCurrentScreen('keys'), { description: 'Keys' })

  // Handle screen navigation
  async function handleScreenSelect(screen: Screen) {
    if (isNavigating()) return
    setIsNavigating(true)

    try {
      // For now, we'll render inline components
      // In future, could spawn separate processes
      setCurrentScreen(screen)
    } finally {
      setIsNavigating(false)
    }
  }

  // Status bar content
  const statusBar = StatusBar({
    left: Text({ color: 'muted' }, currentScreen() === 'menu' ? 'Select an option' : 'ESC to return'),
    center: undefined,
    right: Text({ color: 'muted', dim: true }, 'q:quit  1:dashboard  2:audit  3:keys')
  })

  // Render current screen
  let content: any

  switch (currentScreen()) {
    case 'menu':
      content = MainMenu({ onSelect: handleScreenSelect })
      break

    case 'dashboard':
      content = Dashboard({
        config: props.config,
        environment: props.environment,
        service: props.service,
        verbose: props.verbose
      })
      break

    case 'audit':
      content = AuditViewer({
        config: props.config,
        environment: props.environment,
        service: props.service,
        verbose: props.verbose
      })
      break

    case 'keys':
      content = KeyManager({
        config: props.config,
        verbose: props.verbose
      })
      break
  }

  return AppShell({
    header: LauncherHeader({
      project,
      environment: props.environment,
      currentScreen: currentScreen()
    }),
    headerHeight: 1,
    footer: statusBar,
    footerHeight: 1,
    dividers: true,
    dividerStyle: 'line',
    dividerColor: 'border',
    padding: 0,
    children: Box({ padding: 1 }, content)
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

  // Set theme
  setTheme(tokyoNightTheme)

  // Determine environment
  const environment = options.environment || config.default_environment || 'dev'

  // Determine initial screen
  let initialScreen: Screen = 'menu'
  if (options.screen) {
    const screen = options.screen.toLowerCase()
    if (screen === 'dashboard' || screen === 'secrets') initialScreen = 'dashboard'
    else if (screen === 'audit' || screen === 'logs') initialScreen = 'audit'
    else if (screen === 'keys' || screen === 'key') initialScreen = 'keys'
  }

  // Render the launcher
  render(() =>
    Launcher({
      config,
      environment,
      service: options.service,
      verbose: options.verbose,
      initialScreen
    })
  )
}
