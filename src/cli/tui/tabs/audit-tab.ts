/**
 * Audit Log Tab
 *
 * Displays audit log entries in the unified shell.
 * Placeholder for now - will be migrated from audit-viewer.ts
 */

import {
  Box,
  Text,
  createSignal,
} from 'tuiuiu.js'
import type { VaulterConfig } from '../../../types.js'

const [isInitialized, setIsInitialized] = createSignal(false)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const [_config, setConfig] = createSignal<VaulterConfig | null>(null)

export async function initAuditTab(
  cfg: VaulterConfig,
  _options: { environment?: string } = {}
): Promise<void> {
  setConfig(cfg)
  setIsInitialized(true)
}

export function AuditTab() {
  const initialized = isInitialized()

  if (!initialized) {
    return Box(
      { flexDirection: 'column', padding: 2, alignItems: 'center', justifyContent: 'center', height: '100%' },
      Text({ color: 'primary' }, '● Loading audit log...')
    )
  }

  return Box(
    { flexDirection: 'column', padding: 2, height: '100%' },
    Box(
      { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
      Text({ color: 'primary', bold: true }, 'AUDIT LOG'),
      Box({ height: 1 }),
      Text({ color: 'foreground' }, 'View and filter audit entries'),
      Box({ height: 2 }),
      Text({ color: 'muted' }, 'Coming soon...'),
      Box({ height: 1 }),
      Text({ color: 'muted', dim: true }, 'This tab will show:'),
      Text({ color: 'muted', dim: true }, '• Recent operations (set, delete, sync)'),
      Text({ color: 'muted', dim: true }, '• Filter by user, operation, source'),
      Text({ color: 'muted', dim: true }, '• Search by key name'),
      Text({ color: 'muted', dim: true }, '• Time-based filtering')
    )
  )
}
