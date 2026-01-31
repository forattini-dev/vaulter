/**
 * UI Components for Secrets Explorer
 */

import {
  Box,
  Text,
  Spacer,
  Badge,
  ProgressBar,
  Table,
  useTerminalSize,
} from 'tuiuiu.js'
import type { LoadingStep } from './types.js'
import {
  loadingSteps,
  loadingProgress,
  loadingError,
  envFetchStatuses,
  services,
  selectedServiceIdx, setSelectedServiceIdx,
  environments,
  selectedEnvIdx,
  secrets,
  selectedSecretIdx, setSelectedSecretIdx,
  showValues,
  loading,
  error,
  searchFilter,
  isSearching,
  scrollOffset,
  setVisibleRows,
  actionType,
  focusArea, setFocusArea,
  isMonorepo,
  loadedConfig,
} from './store.js'
import { getEnvColor, maskValue } from './utils.js'
import { applySecretsFromStore } from './loader.js'

// ============================================================================
// Splash Screen Components
// ============================================================================

export function Logo() {
  return Box(
    { flexDirection: 'column' },
    Text({ color: 'primary', bold: true }, '╦  ╦╔═╗╦ ╦╦ ╔╦╗╔═╗╦═╗'),
    Text({ color: 'primary', bold: true }, '╚╗╔╝╠═╣║ ║║  ║ ║╣ ╠╦╝'),
    Text({ color: 'primary', bold: true }, ' ╚╝ ╩ ╩╚═╝╩═╝╩ ╚═╝╩╚═'),
    Box({ height: 1 }),
    Text({ color: 'foreground' }, 'Secure Environment Management')
  )
}

export function LoadingStepsList() {
  const steps = loadingSteps()
  const envStatuses = envFetchStatuses()

  const getStepIcon = (status: LoadingStep['status']) => {
    switch (status) {
      case 'done': return { icon: '✓', iconColor: 'success' as const, textColor: 'success' as const }
      case 'loading': return { icon: '●', iconColor: 'primary' as const, textColor: 'foreground' as const }
      case 'error': return { icon: '✗', iconColor: 'error' as const, textColor: 'error' as const }
      default: return { icon: '○', iconColor: 'muted' as const, textColor: 'muted' as const }
    }
  }

  const elements: ReturnType<typeof Box>[] = []

  for (const step of steps) {
    const { icon, iconColor, textColor } = getStepIcon(step.status)

    // For secrets step, append stats inline
    let label = step.label
    if (step.id === 'secrets' && envStatuses.length > 0) {
      const status = envStatuses[0]
      if (status.status === 'done' && status.varsCount !== undefined) {
        label += ` (${status.varsCount} vars`
        if (status.durationMs) {
          label += `, ${(status.durationMs / 1000).toFixed(1)}s`
        }
        label += ')'
      }
    }

    elements.push(
      Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: iconColor }, icon),
        Text({ color: textColor }, label)
      )
    )
  }

  return Box({ flexDirection: 'column' }, ...elements)
}

export function SplashScreen() {
  const progress = loadingProgress()
  const err = loadingError()

  return Box(
    { flexDirection: 'column', height: '100%' },
    Box({ flexGrow: 1 }),
    Box(
      { flexDirection: 'row' },
      Box({ flexGrow: 1 }),
      Box(
        { flexDirection: 'column', alignItems: 'center' },
        Logo(),
        Box({ height: 2 }),
        LoadingStepsList(),
        Box({ height: 2 }),
        ProgressBar({
          value: progress,
          max: 100,
          width: 40,
          showPercentage: true,
          color: err ? 'error' : 'primary',
          background: 'muted',
        }),
        err
          ? Box(
              { flexDirection: 'column', alignItems: 'center' },
              Box({ height: 1 }),
              Text({ color: 'error' }, err),
              Text({ color: 'foreground' }, 'Press q to quit')
            )
          : null
      ),
      Box({ flexGrow: 1 })
    ),
    Box({ flexGrow: 1 })
  )
}

// ============================================================================
// Main Explorer Components
// ============================================================================

export function Header(props: { project: string }) {
  const service = services()[selectedServiceIdx()]
  const env = environments()[selectedEnvIdx()]
  const isMonorepoMode = isMonorepo()

  return Box(
    { flexDirection: 'row', paddingX: 1, alignItems: 'center' },
    Text({ color: 'primary', bold: true }, '◆ VAULTER'),
    Text({ color: 'muted' }, '  │  '),
    Text({ bold: true }, props.project),
    isMonorepoMode && service
      ? Box({}, Text({ color: 'muted' }, ' / '), Text({ color: 'accent' }, service.name))
      : null,
    Spacer({}),
    Badge({ label: env?.toUpperCase() || 'DEV', color: getEnvColor(env || 'dev') }),
    Text({ color: 'muted' }, '  '),
    Badge({ label: showValues() ? 'VALUES VISIBLE' : 'VALUES HIDDEN', color: showValues() ? 'warning' : 'info' })
  )
}

export function ServiceList() {
  const serviceList = services()
  const selectedIdx = selectedServiceIdx()
  const focus = focusArea()
  const isFocused = focus === 'services'

  const rows = serviceList.map((svc, idx) => {
    const isSelected = idx === selectedIdx
    const prefix = isSelected ? '• ' : '  '
    const color = isSelected ? (isFocused ? 'primary' : 'accent') : 'foreground'

    return Box(
      {
        flexDirection: 'row',
        onClick: () => {
          setSelectedServiceIdx(idx)
          setFocusArea('services')
          // Reload secrets for this service
          if (loadedConfig()) {
            const env = environments()[selectedEnvIdx()]
            if (env) applySecretsFromStore(env, svc)
          }
        },
      },
      Text({ color, bold: isSelected }, prefix + svc.name)
    )
  })

  return Box(
    { flexDirection: 'column', width: '100%', height: '100%', borderStyle: 'single', borderColor: isFocused ? 'primary' : 'muted', padding: 1 },
    Text({ color: 'foreground', bold: true }, 'SERVICES'),
    Box({ height: 1 }),
    ...rows
  )
}

export function SecretsTable() {
  const secretList = secrets()
  const selectedIdx = selectedSecretIdx()
  const showVals = showValues()
  const filter = searchFilter()
  const offset = scrollOffset()
  const isLoadingData = loading()
  const errorMsg = error()

  // Calculate dimensions based on terminal size
  const terminalSize = useTerminalSize()
  const termWidth = terminalSize.columns
  const termHeight = terminalSize.rows

  // Visible rows: header(1) + divider(1) + envTabs(3) + tableHeader(1) + footer(1) + divider(1) + margins(2) = 10
  const calculatedRows = Math.max(5, termHeight - 10)
  setVisibleRows(calculatedRows)
  const visibleRows = calculatedRows

  // Calculate available width (subtract sidebar + divider if monorepo)
  const isMonorepoMode = isMonorepo()
  const availableWidth = termWidth - (isMonorepoMode ? 28 : 0)

  // Apply filter if search is active (secrets are already sorted at the source)
  const filteredSecrets = filter
    ? secretList.filter(s => s.key.toLowerCase().includes(filter.toLowerCase()))
    : secretList

  // Paginate based on dynamic visible rows
  const visibleSecrets = filteredSecrets.slice(offset, offset + visibleRows)

  // Check if any secrets have localStatus (showing sync status column)
  const hasLocalStatus = secretList.some(s => s.localStatus && s.localStatus !== 'n/a')

  // Column widths - SOURCE, SYNC, TYPE, KEY fixed, VALUE fills remaining
  const sourceWidth = 12  // "⚡ override" = 10 chars + prefix
  const syncWidth = hasLocalStatus ? 8 : 0  // "synced" = 6 chars + padding
  const typeWidth = 8
  const keyWidth = hasLocalStatus ? 22 : 26  // Reduce key width when showing sync
  const gapWidth = hasLocalStatus ? 4 : 3  // gaps between columns
  const valueWidth = availableWidth - sourceWidth - syncWidth - typeWidth - keyWidth - gapWidth

  // Table columns for header (uses flex for width calculation)
  const columns = hasLocalStatus
    ? [
        { key: 'source', header: '  SOURCE', width: sourceWidth },
        { key: 'sync', header: 'SYNC', width: syncWidth },
        { key: 'type', header: 'TYPE', width: typeWidth },
        { key: 'key', header: 'KEY', width: keyWidth },
        { key: 'value', header: 'VALUE', flex: 1 },
      ]
    : [
        { key: 'source', header: '  SOURCE', width: sourceWidth },
        { key: 'type', header: 'TYPE', width: typeWidth },
        { key: 'key', header: 'KEY', width: keyWidth },
        { key: 'value', header: 'VALUE', flex: 1 },
      ]

  // Header table (just headers, no data)
  const headerTable = Table({
    columns,
    data: [],
    borderStyle: 'none',
    headerStyle: { color: 'muted', bold: true },
    compact: true,
    availableWidth,
  })

  // Handle loading/error states
  if (isLoadingData) {
    return Box(
      { flexDirection: 'column', width: availableWidth, height: '100%' },
      headerTable,
      Text({ color: 'primary' }, '● Loading secrets...')
    )
  }

  if (errorMsg) {
    return Box(
      { flexDirection: 'column', width: availableWidth, height: '100%' },
      headerTable,
      Text({ color: 'error' }, errorMsg)
    )
  }

  if (filteredSecrets.length === 0) {
    return Box(
      { flexDirection: 'column', width: availableWidth, height: '100%' },
      headerTable,
      Text({ color: 'muted' }, filter ? 'No matching secrets' : 'No secrets found')
    )
  }

  // Build data rows with selection highlighting (manual Box for styling control)
  const rows = visibleSecrets.map((secret, idx) => {
    const actualIdx = offset + idx
    const isSelected = actualIdx === selectedIdx

    // Source display with visual distinction
    // override: ⚡ warning (most important - service overrides shared)
    // service:  ● accent (service-specific)
    // shared:   ○ info (inherited from shared)
    // local:    ◇ success (local-only)
    let sourceIcon: string
    let sourceColor: 'warning' | 'accent' | 'info' | 'success'
    if (secret.source === 'override') {
      sourceIcon = '⚡'
      sourceColor = 'warning'
    } else if (secret.source === 'service') {
      sourceIcon = '●'
      sourceColor = 'accent'
    } else if (secret.source === 'local') {
      sourceIcon = '◇'
      sourceColor = 'success'
    } else {
      sourceIcon = '○'
      sourceColor = 'info'
    }

    // Sync status display
    let syncIcon = ''
    let syncColor: 'success' | 'warning' | 'error' | 'muted' = 'muted'
    if (hasLocalStatus && secret.localStatus) {
      switch (secret.localStatus) {
        case 'synced':
          syncIcon = '✓'
          syncColor = 'success'
          break
        case 'modified':
          syncIcon = '≠'
          syncColor = 'warning'
          break
        case 'missing':
          syncIcon = '−'
          syncColor = 'error'
          break
        case 'local-only':
          syncIcon = '+'
          syncColor = 'success'
          break
        default:
          syncIcon = ''
      }
    }

    const typeText = secret.sensitive ? 'secret' : 'config'
    const keyText = secret.key.length > keyWidth ? secret.key.substring(0, keyWidth - 1) + '…' : secret.key
    const valueText = maskValue(secret.value, showVals)

    // When selected: white text on blue background for maximum contrast
    // Using hex directly since backgroundColor may not resolve semantic colors
    const selectedStyle = { color: '#ffffff', backgroundColor: '#7aa2f7', bold: true }

    // Build columns array conditionally
    const rowColumns = [
      // Source column
      Box(
        { width: sourceWidth },
        isSelected
          ? Text(selectedStyle, `▸ ${sourceIcon} ${secret.source}`)
          : Text({ color: sourceColor, bold: secret.source === 'override' }, `  ${sourceIcon} ${secret.source}`)
      ),
      Box({ width: 1 }),
    ]

    // Sync column (only if showing sync status)
    if (hasLocalStatus) {
      rowColumns.push(
        Box(
          { width: syncWidth },
          isSelected
            ? Text(selectedStyle, `${syncIcon} ${secret.localStatus || ''}`.slice(0, syncWidth))
            : Text({ color: syncColor }, `${syncIcon} ${secret.localStatus || ''}`.slice(0, syncWidth))
        ),
        Box({ width: 1 })
      )
    }

    // Type, Key, Value columns
    rowColumns.push(
      Box(
        { width: typeWidth },
        isSelected
          ? Text(selectedStyle, typeText)
          : Text({ color: secret.sensitive ? 'warning' : 'info' }, typeText)
      ),
      Box({ width: 1 }),
      Box(
        { width: keyWidth },
        isSelected
          ? Text(selectedStyle, keyText)
          : Text({ color: 'foreground' }, keyText)
      ),
      Box({ width: 1 }),
      Box(
        { width: valueWidth },
        isSelected
          ? Text(selectedStyle, valueText)
          : Text({ color: 'muted' }, valueText)
      )
    )

    return Box(
      {
        flexDirection: 'row',
        width: availableWidth,
        onClick: () => {
          setSelectedSecretIdx(actualIdx)
          setFocusArea('secrets')
        },
      },
      ...rowColumns
    )
  })

  // Scroll indicator
  const totalPages = Math.ceil(filteredSecrets.length / visibleRows)
  const currentPage = Math.floor(offset / visibleRows) + 1
  const scrollInfo = totalPages > 1 ? `[${currentPage}/${totalPages}]` : ''

  return Box(
    { flexDirection: 'column', width: availableWidth, height: '100%' },
    headerTable,
    ...rows,
    Box({ flexGrow: 1 }),
    scrollInfo
      ? Box(
          { flexDirection: 'row', width: availableWidth },
          Box({ flexGrow: 1 }),
          Text({ color: 'muted', dim: true }, scrollInfo)
        )
      : null
  )
}

export function StatusFooter() {
  const allSecrets = secrets()
  const filter = searchFilter()
  const action = actionType()
  const searching = isSearching()
  const isMonorepoMode = isMonorepo()
  const focus = focusArea()

  const filteredSecrets = filter
    ? allSecrets.filter(s => s.key.toLowerCase().includes(filter.toLowerCase()))
    : allSecrets

  const varCount = filter
    ? `${filteredSecrets.length}/${allSecrets.length} vars`
    : `${allSecrets.length} vars`

  const buildHints = () => {
    if (searching) {
      return Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'muted' }, 'Type to search'),
        Text({ color: 'success' }, 'Enter:ok'),
        Text({ color: 'error' }, 'Esc:cancel')
      )
    }

    if (action === 'add') {
      return Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'info' }, '↑↓:field'),
        Text({ color: 'primary' }, '←→:toggle'),
        Text({ color: 'success' }, 'Enter:save'),
        Text({ color: 'error' }, 'Esc:cancel')
      )
    }

    if (action === 'edit') {
      return Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'muted' }, 'Type new value'),
        Text({ color: 'success' }, 'Enter:save'),
        Text({ color: 'error' }, 'Esc:cancel')
      )
    }

    if (action) {
      return Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'info' }, '←→:env'),
        Text({ color: 'success' }, 'Enter:confirm'),
        Text({ color: 'error' }, 'Esc:cancel')
      )
    }

    if (isMonorepoMode && focus === 'services') {
      return Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'error' }, 'q:quit'),
        Text({ color: 'muted' }, '|'),
        Text({ color: 'info' }, '↑↓:services'),
        Text({ color: 'success' }, 'Enter:select'),
        Text({ color: 'muted' }, '|'),
        Text({ color: 'primary' }, '1-5:env'),
        Text({ color: 'muted' }, 'v:vals')
      )
    }

    if (isMonorepoMode) {
      return Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'error' }, 'q:quit'),
        Text({ color: 'muted' }, '|'),
        Text({ color: 'info' }, '↑↓:nav'),
        Text({ color: 'primary' }, 'v:vals'),
        Text({ color: 'muted' }, '|'),
        Text({ color: 'success' }, 'a:add'),
        Text({ color: 'info' }, 'e:edit'),
        Text({ color: 'error' }, 'd:del'),
        Text({ color: 'error' }, 'D:delAll'),
        Text({ color: 'muted' }, '|'),
        Text({ color: 'accent' }, 'p:promote'),
        Text({ color: 'warning' }, 'M:move'),
        Text({ color: 'warning' }, 'S:spread'),
        Text({ color: 'muted' }, '|'),
        Text({ color: 'muted' }, 'Esc:svc')
      )
    }

    return Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'error' }, 'q:quit'),
      Text({ color: 'muted' }, '|'),
      Text({ color: 'info' }, '↑↓/jk:nav'),
      Text({ color: 'primary' }, 'v:vals'),
      Text({ color: 'muted' }, '|'),
      Text({ color: 'success' }, 'a:add'),
      Text({ color: 'info' }, 'e:edit'),
      Text({ color: 'error' }, 'd:del'),
      Text({ color: 'muted' }, '|'),
      Text({ color: 'warning' }, 'c:copy'),
      Text({ color: 'accent' }, 'm:move')
    )
  }

  const service = services()[selectedServiceIdx()]

  return Box(
    { flexDirection: 'row', paddingX: 1, justifyContent: 'space-between' },
    Text({ color: 'muted' }, varCount),
    service ? Text({ color: 'accent' }, service.name) : null,
    buildHints()
  )
}
