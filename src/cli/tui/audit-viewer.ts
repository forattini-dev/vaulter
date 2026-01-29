/**
 * Vaulter TUI Audit Log Viewer
 *
 * Interactive terminal interface for viewing and filtering audit logs
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
  Select,
  TextInput,
  useState,
  useEffect,
  useHotkeys,
  useApp,
  setTheme,
  tokyoNightTheme,
  untrack,
} from 'tuiuiu.js'
import type { VaulterConfig, Environment, AuditEntry, AuditOperation, AuditSource } from '../../types.js'
import { loadConfig, getProjectName } from '../../lib/config-loader.js'
import { AuditLogger } from '../../lib/audit.js'
import { resolveBackendUrls, loadEncryptionKeyForEnv } from '../../index.js'
import { maskValue as baseMaskValue } from '../../lib/masking.js'

// Types for viewer state
interface AuditRow {
  time: string
  user: string
  op: string
  key: string
  env: string
  src: string
  id: string
}

export interface AuditViewerProps {
  config: VaulterConfig
  environment: Environment
  service?: string
  verbose?: boolean
  embedded?: boolean
}

type FilterField = 'none' | 'operation' | 'source' | 'search'

const OPERATIONS: { value: AuditOperation | 'all'; label: string }[] = [
  { value: 'all', label: 'All Operations' },
  { value: 'set', label: 'Set' },
  { value: 'delete', label: 'Delete' },
  { value: 'sync', label: 'Sync' },
  { value: 'push', label: 'Push' },
  { value: 'rotate', label: 'Rotate' },
  { value: 'deleteAll', label: 'Delete All' },
]

const SOURCES: { value: AuditSource | 'all'; label: string }[] = [
  { value: 'all', label: 'All Sources' },
  { value: 'cli', label: 'CLI' },
  { value: 'mcp', label: 'MCP' },
  { value: 'api', label: 'API' },
  { value: 'loader', label: 'Loader' },
]

/**
 * Header component with audit info
 */
function AuditHeader(props: {
  project: string
  environment: string
  count: number
}) {
  return Box(
    { flexDirection: 'row', paddingX: 1, alignItems: 'center' },
    Text({ color: 'primary', bold: true }, '◆ VAULTER AUDIT'),
    Text({ color: 'muted' }, '  │  '),
    Text({ bold: true }, props.project),
    Spacer({}),
    Badge({ label: `${props.count} entries`, color: 'info' }),
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
 * Get color for operation badge
 */
function getOpColor(op: string): 'success' | 'warning' | 'error' | 'info' {
  switch (op) {
    case 'set':
      return 'success'
    case 'delete':
    case 'deleteAll':
      return 'error'
    case 'sync':
    case 'push':
      return 'info'
    case 'rotate':
      return 'warning'
    default:
      return 'info'
  }
}

/**
 * Format timestamp for display
 */
function formatTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '-'

  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Entry to row conversion
 */
function entryToRow(entry: AuditEntry): AuditRow {
  return {
    time: formatTimestamp(entry.timestamp),
    user: entry.user.length > 12 ? entry.user.substring(0, 10) + '..' : entry.user,
    op: entry.operation,
    key: entry.key.length > 25 ? entry.key.substring(0, 23) + '..' : entry.key,
    env: entry.environment,
    src: entry.source,
    id: entry.id
  }
}

/**
 * Mask sensitive value for display (TUI style with bullets)
 */
function maskValue(value: string): string {
  return baseMaskValue(value, { maskChar: '•', visibleStart: 3, visibleEnd: 3 })
}

/**
 * Detail Panel for selected entry
 */
function DetailPanel(props: { entry: AuditEntry | null; showValues: boolean }) {
  if (!props.entry) {
    return Box(
      { padding: 1, borderStyle: 'round', borderColor: 'border' },
      Text({ color: 'muted', dim: true }, 'Select an entry to view details')
    )
  }

  const e = props.entry
  const displayValue = (val: string) => props.showValues ? val : maskValue(val)

  return Box(
    { flexDirection: 'column', padding: 1, borderStyle: 'round', borderColor: 'border', gap: 0 },
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'ID:'),
      Text({ color: 'primary' }, e.id)
    ),
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Time:'),
      Text({}, e.timestamp instanceof Date ? e.timestamp.toISOString() : String(e.timestamp))
    ),
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'User:'),
      Text({ bold: true }, e.user)
    ),
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Operation:'),
      Badge({ label: e.operation.toUpperCase(), color: getOpColor(e.operation) })
    ),
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Key:'),
      Text({ color: 'warning' }, e.key)
    ),
    e.previousValue ? Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Previous:'),
      Text({ color: 'error', dim: true }, displayValue(e.previousValue))
    ) : null,
    e.newValue ? Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'New:'),
      Text({ color: 'success' }, displayValue(e.newValue))
    ) : null,
    !props.showValues ? Text({ color: 'muted', dim: true }, '(Press v to reveal values)') : null
  )
}

/**
 * Filter Bar component
 */
function FilterBar(props: {
  activeFilter: FilterField
  operation: AuditOperation | 'all'
  source: AuditSource | 'all'
  searchQuery: string
  onOperationChange: (op: AuditOperation | 'all') => void
  onSourceChange: (src: AuditSource | 'all') => void
  onSearchChange: (query: string) => void
  onFilterClose: () => void
}) {
  if (props.activeFilter === 'none') {
    return Box(
      { flexDirection: 'row', paddingX: 1, gap: 2 },
      Text({ color: 'muted', dim: true }, 'Filters:'),
      props.operation !== 'all'
        ? Badge({ label: `op:${props.operation}`, color: 'info' })
        : null,
      props.source !== 'all'
        ? Badge({ label: `src:${props.source}`, color: 'info' })
        : null,
      props.searchQuery
        ? Badge({ label: `"${props.searchQuery}"`, color: 'warning' })
        : null,
      props.operation === 'all' && props.source === 'all' && !props.searchQuery
        ? Text({ color: 'muted', dim: true }, 'none')
        : null
    )
  }

  if (props.activeFilter === 'operation') {
    return Box(
      { paddingX: 1 },
      Select({
        items: OPERATIONS,
        initialValue: props.operation,
        onChange: (val) => {
          props.onOperationChange(val as AuditOperation | 'all')
          props.onFilterClose()
        },
        onCancel: props.onFilterClose,
        maxVisible: 7
      })
    )
  }

  if (props.activeFilter === 'source') {
    return Box(
      { paddingX: 1 },
      Select({
        items: SOURCES,
        initialValue: props.source,
        onChange: (val) => {
          props.onSourceChange(val as AuditSource | 'all')
          props.onFilterClose()
        },
        onCancel: props.onFilterClose,
        maxVisible: 5
      })
    )
  }

  if (props.activeFilter === 'search') {
    return Box(
      { paddingX: 1, flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Search key:'),
      TextInput({
        initialValue: props.searchQuery,
        placeholder: 'Type to filter by key...',
        width: 30,
        onSubmit: (val) => {
          props.onSearchChange(val)
          props.onFilterClose()
        }
      })
    )
  }

  return null
}

/**
 * Main Audit Viewer component
 * Exported for use in launcher
 */
export function AuditViewer(props: AuditViewerProps) {
  const app = useApp()
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [rows, setRows] = useState<AuditRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [logger, setLogger] = useState<AuditLogger | null>(null)

  // Filters
  const [activeFilter, setActiveFilter] = useState<FilterField>('none')
  const [opFilter, setOpFilter] = useState<AuditOperation | 'all'>('all')
  const [srcFilter, setSrcFilter] = useState<AuditSource | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showValues, setShowValues] = useState(false)

  const project = getProjectName(props.config)
  const isFilterActive = activeFilter() !== 'none'

  // Cleanup on unmount - disconnect logger
  useEffect(() => {
    return () => {
      const lg = logger()
      if (lg) {
        lg.disconnect().catch(() => {}) // Ignore errors during cleanup
      }
    }
  })

  // Register hotkeys (disabled when filter is open)
  useHotkeys('q', () => {
    if (!props.embedded) {
      app.exit()
    }
  }, { description: 'Quit' })
  useHotkeys('r', () => {
    if (!isFilterActive) {
      loadEntriesWithFilters(opFilter(), srcFilter(), searchQuery())
    }
  }, { description: 'Refresh' })
  useHotkeys('o', () => { if (!isFilterActive) setActiveFilter('operation') }, { description: 'Filter operation' })
  useHotkeys('s', () => { if (!isFilterActive) setActiveFilter('source') }, { description: 'Filter source' })
  useHotkeys('/', () => { if (!isFilterActive) setActiveFilter('search') }, { description: 'Search' })
  useHotkeys('c', () => {
    if (!isFilterActive) {
      setOpFilter('all')
      setSrcFilter('all')
      setSearchQuery('')
    }
  }, { description: 'Clear filters' })
  useHotkeys('escape', () => setActiveFilter('none'), { description: 'Close filter' })
  useHotkeys('v', () => { if (!isFilterActive) setShowValues(v => !v) }, { description: 'Toggle values' })

  // Navigation
  useHotkeys('j', () => {
    if (!isFilterActive) setSelectedIndex(i => Math.min(i + 1, rows().length - 1))
  }, { description: 'Down' })
  useHotkeys('k', () => {
    if (!isFilterActive) setSelectedIndex(i => Math.max(i - 1, 0))
  }, { description: 'Up' })
  useHotkeys('down', () => {
    if (!isFilterActive) setSelectedIndex(i => Math.min(i + 1, rows().length - 1))
  }, { description: 'Down' })
  useHotkeys('up', () => {
    if (!isFilterActive) setSelectedIndex(i => Math.max(i - 1, 0))
  }, { description: 'Up' })

  // Initialize logger
  async function initLogger(): Promise<AuditLogger> {
    const urls = resolveBackendUrls(props.config)
    if (urls.length === 0) {
      throw new Error('No backend URL configured')
    }

    // Use per-environment key resolution
    const project = props.config.project || ''
    const passphrase = await loadEncryptionKeyForEnv(props.config, project, props.environment) || undefined
    const newLogger = new AuditLogger(props.config.audit)
    await newLogger.connect(urls[0], passphrase, props.verbose)
    setLogger(newLogger)
    return newLogger
  }

  // Load entries with specific filters (called from effect with tracked dependencies)
  async function loadEntriesWithFilters(
    op: AuditOperation | 'all',
    src: AuditSource | 'all',
    search: string
  ) {
    setLoading(true)
    setError(null)

    try {
      // Use untrack to prevent logger changes from re-triggering the effect
      let lg = untrack(() => logger())
      if (!lg) {
        lg = await initLogger()
      }

      const queryOpts: Record<string, unknown> = {
        project,
        environment: props.environment,
        service: props.service,
        limit: 100
      }

      if (op !== 'all') {
        queryOpts.operation = op
      }
      if (src !== 'all') {
        queryOpts.source = src
      }
      if (search) {
        queryOpts.key = search
      }

      const result = await lg.query(queryOpts as any)
      setEntries(result)
      setRows(result.map(entryToRow))
      setSelectedIndex(0)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Reload when filters change - explicitly track filter signals
  useEffect(() => {
    // Read filter signals to track them as dependencies
    const op = opFilter()
    const src = srcFilter()
    const search = searchQuery()

    // Load with current filters
    loadEntriesWithFilters(op, src, search)
  })

  // Get selected entry
  const selectedEntry = entries()[selectedIndex()] || null

  // Status bar content
  const statusBar = StatusBar({
    left: Text({ color: 'muted' }, `${rows().length} entries`),
    center: error() ? Text({ color: 'error' }, error()!) : undefined,
    right: Text({ color: 'muted', dim: true }, 'q:quit  r:refresh  v:values  o:op  s:src  /:search  c:clear')
  })

  // Table columns
  const columns = [
    { key: 'time', header: 'Time', width: 10 },
    { key: 'user', header: 'User', width: 12 },
    { key: 'op', header: 'Op', width: 8 },
    { key: 'key', header: 'Key' },
    { key: 'env', header: 'Env', width: 5 },
    { key: 'src', header: 'Src', width: 6 }
  ]

  // Main content
  const content = loading()
    ? Box(
        { justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'row' },
        Spinner({ style: 'dots', color: 'primary' }),
        Text({ color: 'muted' }, '  Loading audit log...')
      )
    : error()
    ? Box(
        { justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 1 },
        Text({ color: 'error', bold: true }, '✗ Error'),
        Text({ color: 'muted' }, error()!)
      )
    : rows().length === 0
    ? Box(
        { justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 1 },
        Text({ color: 'muted' }, 'No audit entries found'),
        Text({ color: 'muted', dim: true }, 'Try changing filters or running some commands first')
      )
    : Box(
        { flexDirection: 'column', gap: 1, height: '100%' },
        FilterBar({
          activeFilter: activeFilter(),
          operation: opFilter(),
          source: srcFilter(),
          searchQuery: searchQuery(),
          onOperationChange: setOpFilter,
          onSourceChange: setSrcFilter,
          onSearchChange: setSearchQuery,
          onFilterClose: () => setActiveFilter('none')
        }),
        Box(
          { flexDirection: 'row', gap: 1, flexGrow: 1 },
          Box(
            { flexGrow: 1 },
            Table({
              columns,
              data: rows(),
              borderStyle: 'round'
            })
          ),
          Box(
            { width: 40 },
            DetailPanel({ entry: selectedEntry, showValues: showValues() })
          )
        )
      )

  if (props.embedded) {
    return content
  }

  return AppShell({
    header: AuditHeader({
      project,
      environment: props.environment,
      count: rows().length
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
 * Start the Audit Viewer TUI
 */
export async function startAuditViewer(options: {
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

  // Render the viewer
  const { waitUntilExit } = render(() =>
    AuditViewer({
      config,
      environment,
      service: options.service,
      verbose: options.verbose
    })
  )

  await waitUntilExit()
}
