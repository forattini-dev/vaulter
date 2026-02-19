/**
 * Vaulter TUI Dashboard
 *
 * Interactive terminal interface for managing secrets and environment variables
 */

import {
  render,
  Box,
  Text,
  Spacer,
  AppShell,
  StatusBar,
  Table,
  Badge,
  Spinner,
  useState,
  useEffect,
  useHotkeys,
  useApp,
  setTheme,
  tokyoNightTheme,
  untrack,
} from 'tuiuiu.js'
import type { VaulterConfig, Environment, CLIArgs, EnvVar } from '../../types.js'
import { maskValue as baseMaskValue } from '../../lib/masking.js'
import { loadConfig, getProjectName, getValidEnvironments } from '../../lib/config-loader.js'
import { createClientFromConfig } from '../lib/create-client.js'
import { VaulterClient } from '../../client.js'

// Types for dashboard state
interface SecretRow {
  key: string
  value: string
  type: string
  updatedAt: string
}

export interface DashboardProps {
  config: VaulterConfig
  environment: Environment
  service?: string
  verbose?: boolean
  embedded?: boolean
}

/**
 * Header component with project info
 */
function DashboardHeader(props: {
  project: string
  environment: string
  service?: string
}) {
  return Box(
    { flexDirection: 'row', paddingX: 1, alignItems: 'center' },
    Text({ color: 'primary', bold: true }, '◆ VAULTER'),
    Text({ color: 'muted' }, '  │  '),
    Text({ bold: true }, props.project),
    props.service ? Text({ color: 'muted' }, ` / ${props.service}`) : null,
    Spacer({}),
    Text({ color: 'muted', dim: true }, 'env: '),
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
 * Mask sensitive value for display (TUI style with bullets)
 */
function maskValue(value: string, isSecret: boolean): string {
  if (!isSecret) {
    return value.length > 40 ? value.substring(0, 37) + '...' : value
  }
  return baseMaskValue(value, { maskChar: '•', visibleStart: 3, visibleEnd: 3, maxLength: 40 })
}

/**
 * Main Dashboard component
 * Exported for use in launcher
 */
export function Dashboard(props: DashboardProps) {
  const app = useApp()
  const [loading, setLoading] = useState(true)
  const [vars, setVars] = useState<EnvVar[]>([])
  const [error, setError] = useState<string | null>(null)
  const [environment, setEnvironment] = useState(props.environment)
  const [showValues, setShowValues] = useState(false)
  const [client, setClient] = useState<VaulterClient | null>(null)

  const project = getProjectName(props.config)
  const environments = getValidEnvironments(props.config)

  // Cleanup on unmount - disconnect client
  useEffect(() => {
    return () => {
      const c = client()
      if (c) {
        c.disconnect().catch(() => {}) // Ignore errors during cleanup
      }
    }
  })

  // Register hotkeys
  useHotkeys('q', () => {
    if (!props.embedded) {
      app.exit()
    }
  }, { description: 'Quit' })
  useHotkeys('r', () => loadSecretsForEnv(environment()), { description: 'Refresh' })
  useHotkeys('v', () => setShowValues(v => !v), { description: 'Toggle values' })
  useHotkeys('e', () => cycleEnvironment(), { description: 'Cycle environment' })

  function cycleEnvironment() {
    const idx = environments.indexOf(environment())
    const nextIdx = (idx + 1) % environments.length
    setEnvironment(environments[nextIdx])
  }

  // Initialize client
  async function initClient() {
    const args: CLIArgs = { _: [] }
    const newClient = await createClientFromConfig({
      args,
      config: props.config,
      project,
      verbose: props.verbose
    })
    await newClient.connect()
    setClient(newClient)
    return newClient
  }

  // Load secrets for specific environment (called from effect with tracked dependency)
  async function loadSecretsForEnv(env: Environment) {
    setLoading(true)
    setError(null)

    try {
      // Use untrack to prevent client changes from re-triggering the effect
      let c = untrack(() => client())
      if (!c) {
        c = await initClient()
      }

      const fetched = await c.list({
        project,
        service: props.service,
        environment: env
      })

      setVars(fetched)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Reload when environment changes - explicitly track environment signal
  useEffect(() => {
    const env = environment()
    loadSecretsForEnv(env)
  })

  const rows: SecretRow[] = vars()
    .map((v: EnvVar) => {
      // Use the sensitive flag from the var (no pattern inference)
      const secret = v.sensitive ?? false
      return {
        key: v.key,
        value: showValues() ? v.value : maskValue(v.value, secret),
        type: secret ? '🔒' : '📄',
        updatedAt: v.updatedAt ? formatDate(v.updatedAt) : '-'
      }
    })
    .sort((a, b) => a.key.localeCompare(b.key))

  // Status bar content
  const statusBar = StatusBar({
    left: Text({ color: 'muted' }, `${rows.length} variables`),
    center: error() ? Text({ color: 'error' }, error()!) : undefined,
    right: Text({ color: 'muted', dim: true }, 'q:quit  r:refresh  e:env  v:values')
  })

  // Table columns
  const columns = [
    { key: 'key', header: 'Key' },
    { key: 'value', header: 'Value' },
    { key: 'type', header: '', width: 3 },
    { key: 'updatedAt', header: 'Updated', width: 12 }
  ]

  // Main content
  const content = loading()
    ? Box(
        { justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'row' },
        Spinner({ style: 'dots', color: 'primary' }),
        Text({ color: 'muted' }, '  Loading secrets...')
      )
    : error()
    ? Box(
        { justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 1 },
        Text({ color: 'error', bold: true }, '✗ Error'),
        Text({ color: 'muted' }, error()!)
      )
    : rows.length === 0
    ? Box(
        { justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 1 },
        Text({ color: 'muted' }, 'No variables found'),
        Text({ color: 'muted', dim: true }, `Try: vaulter change set MY_VAR=value -e ${environment()}`)
      )
    : Table({
        columns,
        data: rows,
        borderStyle: 'round'
      })

  if (props.embedded) {
    return content
  }

  return AppShell({
    header: DashboardHeader({
      project,
      environment: environment(),
      service: props.service
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
 * Format date for display
 */
function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '-'

  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Start the TUI dashboard
 */
export async function startDashboard(options: {
  environment?: Environment
  service?: string
  verbose?: boolean
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

  // Render the dashboard
  const { waitUntilExit } = render(() =>
    Dashboard({
      config,
      environment,
      service: options.service,
      verbose: options.verbose
    })
  )

  await waitUntilExit()
}
