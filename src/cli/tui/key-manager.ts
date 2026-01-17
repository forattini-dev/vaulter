/**
 * Vaulter TUI Key Manager
 *
 * Interactive terminal interface for managing encryption keys
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
import fs from 'node:fs'
import path from 'node:path'
import type { VaulterConfig } from '../../types.js'
import { loadConfig, getProjectName, getProjectKeysDir, getGlobalKeysDir, keyExists, resolveKeyPaths } from '../../lib/config-loader.js'
import { detectAlgorithm } from '../../lib/crypto.js'

// Types for key manager state
interface KeyInfo {
  name: string
  scope: 'project' | 'global'
  type: 'symmetric' | 'asymmetric'
  algorithm: string
  hasPrivateKey: boolean
  hasPublicKey: boolean
  privateKeyPath: string
  publicKeyPath: string
  privateKeySize?: number
  publicKeySize?: number
}

export interface KeyManagerProps {
  config: VaulterConfig
  verbose?: boolean
  embedded?: boolean
}

/**
 * Header component
 */
function KeyHeader(props: {
  project: string
  keyCount: number
}) {
  return Box(
    { flexDirection: 'row', paddingX: 1, alignItems: 'center' },
    Text({ color: 'primary', bold: true }, '◆ VAULTER KEYS'),
    Text({ color: 'muted' }, '  │  '),
    Text({ bold: true }, props.project),
    Spacer({}),
    Badge({ label: `${props.keyCount} keys`, color: 'info' })
  )
}

/**
 * Get file size in human readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Key to row conversion
 */
function keyToRow(key: KeyInfo): Record<string, string> {
  const scopeIcon = key.scope === 'global' ? '🌐' : '📁'
  const typeIcon = key.type === 'asymmetric' ? '🔐' : '🔑'
  const privStatus = key.hasPrivateKey ? '✓' : '✗'
  const pubStatus = key.hasPublicKey ? '✓' : '✗'

  return {
    name: key.name,
    scope: scopeIcon,
    type: typeIcon,
    algorithm: key.algorithm,
    private: privStatus,
    public: pubStatus
  }
}

/**
 * Key Detail Panel
 */
function KeyDetailPanel(props: { key: KeyInfo | null; config: VaulterConfig }) {
  if (!props.key) {
    return Box(
      { padding: 1, borderStyle: 'round', borderColor: 'border', flexDirection: 'column' },
      Text({ color: 'muted', dim: true }, 'Select a key to view details')
    )
  }

  const k = props.key
  const isConfigured = isKeyConfigured(k, props.config)

  return Box(
    { flexDirection: 'column', padding: 1, borderStyle: 'round', borderColor: 'border', gap: 0 },
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Name:'),
      Text({ bold: true, color: 'primary' }, k.name)
    ),
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Scope:'),
      Badge({ label: k.scope.toUpperCase(), color: k.scope === 'global' ? 'warning' : 'info' })
    ),
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Type:'),
      Text({}, k.type)
    ),
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Algorithm:'),
      Text({ color: 'warning' }, k.algorithm)
    ),
    Text({ color: 'muted', dim: true }, '─'.repeat(30)),
    k.hasPrivateKey ? Box(
      { flexDirection: 'column', gap: 0 },
      Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'success' }, '✓'),
        Text({ color: 'muted' }, 'Private key')
      ),
      Text({ color: 'muted', dim: true }, `  ${k.privateKeyPath.replace(process.env.HOME || '~', '~')}`),
      k.privateKeySize ? Text({ color: 'muted', dim: true }, `  ${formatFileSize(k.privateKeySize)}`) : null
    ) : Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'error' }, '✗'),
      Text({ color: 'muted' }, 'No private key')
    ),
    k.hasPublicKey ? Box(
      { flexDirection: 'column', gap: 0 },
      Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'success' }, '✓'),
        Text({ color: 'muted' }, 'Public key')
      ),
      Text({ color: 'muted', dim: true }, `  ${k.publicKeyPath.replace(process.env.HOME || '~', '~')}`),
      k.publicKeySize ? Text({ color: 'muted', dim: true }, `  ${formatFileSize(k.publicKeySize)}`) : null
    ) : Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'error' }, '✗'),
      Text({ color: 'muted' }, 'No public key')
    ),
    Text({ color: 'muted', dim: true }, '─'.repeat(30)),
    isConfigured ? Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'success' }, '✓'),
      Text({ color: 'muted' }, 'In use by config')
    ) : Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted', dim: true }, '○'),
      Text({ color: 'muted', dim: true }, 'Not in config')
    )
  )
}

/**
 * Check if a key is configured in the current config
 */
function isKeyConfigured(key: KeyInfo, config: VaulterConfig): boolean {
  if (!config.encryption) return false

  const configKeyName = config.encryption.asymmetric?.key_name
  if (configKeyName) {
    const fullName = key.scope === 'global' ? `global:${key.name}` : key.name
    return configKeyName === fullName || configKeyName === key.name
  }

  return false
}

/**
 * Encryption Config Panel
 */
function ConfigPanel(props: { config: VaulterConfig }) {
  const enc = props.config.encryption
  const mode = enc?.mode || 'symmetric'

  return Box(
    { flexDirection: 'column', padding: 1, borderStyle: 'round', borderColor: 'border', gap: 0 },
    Text({ color: 'primary', bold: true }, 'Encryption Config'),
    Text({ color: 'muted', dim: true }, '─'.repeat(25)),
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ color: 'muted' }, 'Mode:'),
      Badge({ label: mode.toUpperCase(), color: mode === 'asymmetric' ? 'success' : 'info' })
    ),
    mode === 'asymmetric' && enc?.asymmetric ? Box(
      { flexDirection: 'column', gap: 0 },
      Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'muted' }, 'Algorithm:'),
        Text({}, enc.asymmetric.algorithm || 'rsa-4096')
      ),
      enc.asymmetric.key_name ? Box(
        { flexDirection: 'row', gap: 1 },
        Text({ color: 'muted' }, 'Key:'),
        Text({ color: 'warning' }, enc.asymmetric.key_name)
      ) : null
    ) : null,
    enc?.key_source && enc.key_source.length > 0 ? Box(
      { flexDirection: 'column', gap: 0 },
      Text({ color: 'muted' }, 'Key sources:'),
      ...enc.key_source.map(src => {
        if ('env' in src) {
          const available = !!process.env[src.env]
          return Box(
            { flexDirection: 'row', gap: 1 },
            Text({ color: available ? 'success' : 'error' }, available ? '✓' : '✗'),
            Text({ color: 'muted', dim: true }, `env: ${src.env}`)
          )
        }
        if ('file' in src) {
          const available = fs.existsSync(path.resolve(src.file))
          return Box(
            { flexDirection: 'row', gap: 1 },
            Text({ color: available ? 'success' : 'error' }, available ? '✓' : '✗'),
            Text({ color: 'muted', dim: true }, `file: ${src.file.replace(process.env.HOME || '~', '~')}`)
          )
        }
        return null
      }).filter(Boolean)
    ) : null
  )
}

/**
 * Main Key Manager component
 * Exported for use in launcher
 */
export function KeyManager(props: KeyManagerProps) {
  const app = useApp()
  const [loading, setLoading] = useState(true)
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showConfig, setShowConfig] = useState(false)

  const project = getProjectName(props.config)

  // Register hotkeys
  useHotkeys('q', () => {
    if (!props.embedded) {
      app.exit()
    }
  }, { description: 'Quit' })
  useHotkeys('r', () => loadKeys(), { description: 'Refresh' })
  useHotkeys('c', () => setShowConfig(v => !v), { description: 'Toggle config' })

  // Navigation
  useHotkeys('j', () => setSelectedIndex(i => Math.min(i + 1, rows().length - 1)), { description: 'Down' })
  useHotkeys('k', () => setSelectedIndex(i => Math.max(i - 1, 0)), { description: 'Up' })
  useHotkeys('down', () => setSelectedIndex(i => Math.min(i + 1, rows().length - 1)), { description: 'Down' })
  useHotkeys('up', () => setSelectedIndex(i => Math.max(i - 1, 0)), { description: 'Up' })

  // Load keys
  async function loadKeys() {
    setLoading(true)

    try {
      const projectKeysDir = getProjectKeysDir(project)
      const globalKeysDir = getGlobalKeysDir()
      const keyList: KeyInfo[] = []

      // Load project keys
      if (fs.existsSync(projectKeysDir)) {
        const files = fs.readdirSync(projectKeysDir)
        const keyNames = new Set<string>()

        for (const file of files) {
          const name = file.replace(/\.pub$/, '').replace(/\.key$/, '')
          keyNames.add(name)
        }

        for (const name of keyNames) {
          const keyInfo = await loadKeyInfo(name, 'project', project)
          if (keyInfo) keyList.push(keyInfo)
        }
      }

      // Load global keys
      if (fs.existsSync(globalKeysDir)) {
        const files = fs.readdirSync(globalKeysDir)
        const keyNames = new Set<string>()

        for (const file of files) {
          const name = file.replace(/\.pub$/, '').replace(/\.key$/, '')
          keyNames.add(name)
        }

        for (const name of keyNames) {
          const keyInfo = await loadKeyInfo(name, 'global', project)
          if (keyInfo) keyList.push(keyInfo)
        }
      }

      // Sort: project keys first, then by name
      keyList.sort((a, b) => {
        if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      setKeys(keyList)
      setRows(keyList.map(keyToRow))
      setSelectedIndex(0)
    } finally {
      setLoading(false)
    }
  }

  // Load info for a single key
  async function loadKeyInfo(
    name: string,
    scope: 'project' | 'global',
    projectName: string
  ): Promise<KeyInfo | null> {
    const fullName = scope === 'global' ? `global:${name}` : name
    const paths = resolveKeyPaths(fullName, projectName)
    const existing = keyExists(fullName, projectName)

    if (!existing.exists) return null

    let type: 'symmetric' | 'asymmetric' = 'symmetric'
    let algorithm = 'aes-256-gcm'
    let privateKeySize: number | undefined
    let publicKeySize: number | undefined

    if (existing.publicKey && fs.existsSync(paths.publicKey)) {
      type = 'asymmetric'
      const content = fs.readFileSync(paths.publicKey, 'utf-8')
      algorithm = detectAlgorithm(content) || 'unknown'
      publicKeySize = fs.statSync(paths.publicKey).size
    }

    if (existing.privateKey && fs.existsSync(paths.privateKey)) {
      const stat = fs.statSync(paths.privateKey)
      if (stat.isFile()) {
        privateKeySize = stat.size
        const content = fs.readFileSync(paths.privateKey, 'utf-8')
        if (content.includes('BEGIN') && content.includes('KEY')) {
          type = 'asymmetric'
          if (algorithm === 'aes-256-gcm') {
            algorithm = detectAlgorithm(content) || 'unknown'
          }
        }
      }
    }

    return {
      name,
      scope,
      type,
      algorithm,
      hasPrivateKey: !!existing.privateKey,
      hasPublicKey: !!existing.publicKey,
      privateKeyPath: paths.privateKey,
      publicKeyPath: paths.publicKey,
      privateKeySize,
      publicKeySize
    }
  }

  // Load on mount - use untrack to ensure this only runs once
  useEffect(() => {
    // The effect has no tracked dependencies, so it runs only on mount
    // Use untrack wrapper for safety in case any signals are added later
    untrack(() => loadKeys())
  })

  // Get selected key
  const selectedKey = keys()[selectedIndex()] || null

  // Status bar content
  const statusBar = StatusBar({
    left: Text({ color: 'muted' }, `${keys().length} keys`),
    center: undefined,
    right: Text({ color: 'muted', dim: true }, 'q:quit  r:refresh  c:config  j/k:nav')
  })

  // Table columns
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'scope', header: '', width: 3 },
    { key: 'type', header: '', width: 3 },
    { key: 'algorithm', header: 'Algorithm', width: 12 },
    { key: 'private', header: 'Priv', width: 5 },
    { key: 'public', header: 'Pub', width: 5 }
  ]

  // Main content
  const content = loading()
    ? Box(
        { justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'row' },
        Spinner({ style: 'dots', color: 'primary' }),
        Text({ color: 'muted' }, '  Loading keys...')
      )
    : keys().length === 0
    ? Box(
        { justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 1 },
        Text({ color: 'muted' }, 'No keys found'),
        Text({ color: 'muted', dim: true }, 'Generate a key: vaulter key generate --name master')
      )
    : Box(
        { flexDirection: 'row', gap: 1, height: '100%' },
        Box(
          { flexGrow: 1 },
          Table({
            columns,
            data: rows(),
            borderStyle: 'round'
          })
        ),
        Box(
          { width: 40, flexDirection: 'column', gap: 1 },
          KeyDetailPanel({ key: selectedKey, config: props.config }),
          showConfig() ? ConfigPanel({ config: props.config }) : null
        )
      )

  if (props.embedded) {
    return content
  }

  return AppShell({
    header: KeyHeader({
      project,
      keyCount: keys().length
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
 * Start the Key Manager TUI
 */
export async function startKeyManager(options: {
  verbose?: boolean
}): Promise<void> {
  // Load config
  const config = loadConfig()
  if (!config || !config.project) {
    throw new Error('No .vaulter/config.yaml found. Run "vaulter init" first.')
  }

  // Set theme
  setTheme(tokyoNightTheme)

  // Render the manager
  render(() =>
    KeyManager({
      config,
      verbose: options.verbose
    })
  )
}
