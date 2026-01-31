/**
 * Keys Manager Tab
 *
 * Displays and manages encryption keys in the unified shell.
 * Placeholder for now - will be migrated from key-manager.ts
 */

import {
  Box,
  Text,
  createSignal,
} from 'tuiuiu.js'
import type { VaulterConfig } from '../../../types.js'

const [isInitialized, setIsInitialized] = createSignal(false)
const [_config, setConfig] = createSignal<VaulterConfig | null>(null)

export async function initKeysTab(
  cfg: VaulterConfig,
  _options: { verbose?: boolean } = {}
): Promise<void> {
  setConfig(cfg)
  setIsInitialized(true)
}

export function KeysTab() {
  const initialized = isInitialized()

  if (!initialized) {
    return Box(
      { flexDirection: 'column', padding: 2, alignItems: 'center', justifyContent: 'center', height: '100%' },
      Text({ color: 'primary' }, '● Loading keys...')
    )
  }

  return Box(
    { flexDirection: 'column', padding: 2, height: '100%' },
    Box(
      { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
      Text({ color: 'warning', bold: true }, 'ENCRYPTION KEYS'),
      Box({ height: 1 }),
      Text({ color: 'foreground' }, 'Manage encryption keys'),
      Box({ height: 2 }),
      Text({ color: 'muted' }, 'Coming soon...'),
      Box({ height: 1 }),
      Text({ color: 'muted', dim: true }, 'This tab will show:'),
      Text({ color: 'muted', dim: true }, '• List of all keys (project and global)'),
      Text({ color: 'muted', dim: true }, '• Key details (algorithm, creation date)'),
      Text({ color: 'muted', dim: true }, '• Generate new keys'),
      Text({ color: 'muted', dim: true }, '• Export/import keys'),
      Text({ color: 'muted', dim: true }, '• Rotate keys')
    )
  )
}
