/**
 * Dashboard Tab
 *
 * Overview dashboard in the unified shell.
 * Placeholder for now - will be migrated from dashboard.ts
 */

import {
  Box,
  Text,
  Badge,
  createSignal,
} from 'tuiuiu.js'
import type { VaulterConfig } from '../../../types.js'
import { getProjectName } from '../../../lib/config-loader.js'

const [isInitialized, setIsInitialized] = createSignal(false)
const [config, setConfig] = createSignal<VaulterConfig | null>(null)

export async function initDashboardTab(
  cfg: VaulterConfig,
  _options: { environment?: string } = {}
): Promise<void> {
  setConfig(cfg)
  setIsInitialized(true)
}

export function DashboardTab() {
  const initialized = isInitialized()
  const cfg = config()

  if (!initialized || !cfg) {
    return Box(
      { flexDirection: 'column', padding: 2, alignItems: 'center', justifyContent: 'center', height: '100%' },
      Text({ color: 'primary' }, '● Loading dashboard...')
    )
  }

  const project = getProjectName(cfg)

  return Box(
    { flexDirection: 'column', padding: 2, height: '100%' },
    Box(
      { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
      Text({ color: 'success', bold: true }, 'DASHBOARD'),
      Box({ height: 1 }),
      Text({ color: 'foreground' }, 'Project Overview'),
      Box({ height: 2 }),
      Box(
        { flexDirection: 'row', gap: 2 },
        Text({ color: 'muted' }, 'Project:'),
        Badge({ label: project, color: 'primary' })
      ),
      Box({ height: 2 }),
      Text({ color: 'muted' }, 'Coming soon...'),
      Box({ height: 1 }),
      Text({ color: 'muted', dim: true }, 'This tab will show:'),
      Text({ color: 'muted', dim: true }, '• Variables count per environment'),
      Text({ color: 'muted', dim: true }, '• Recent changes'),
      Text({ color: 'muted', dim: true }, '• Sync status (local vs remote)'),
      Text({ color: 'muted', dim: true }, '• Health checks'),
      Text({ color: 'muted', dim: true }, '• Quick actions')
    )
  )
}
