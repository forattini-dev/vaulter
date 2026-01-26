/**
 * Vaulter CLI - Key Management Commands
 *
 * Generate and manage encryption keys:
 * - Symmetric: AES-256 passphrase (default)
 * - Asymmetric: RSA/EC key pairs for hybrid encryption
 *
 * Keys are stored in ~/.vaulter/ directory:
 * - Project keys: ~/.vaulter/projects/<project>/keys/
 * - Global keys: ~/.vaulter/global/keys/
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { CLIArgs, VaulterConfig, AsymmetricAlgorithm } from '../../types.js'
import { generateKeyPair, generatePassphrase, detectAlgorithm } from '../../lib/crypto.js'
import {
  getProjectKeysDir,
  getGlobalKeysDir,
  resolveKeyPath,
  resolveKeyPaths,
  keyExists,
  parseKeyName,
  getValidEnvironments
} from '../../lib/config-loader.js'
import { runKeyRotate as runKeyRotateImpl } from './key/rotate.js'
import * as ui from '../ui.js'
import { print } from '../lib/colors.js'

interface KeyContext {
  args: CLIArgs
  config: VaulterConfig | null
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

type BackupScope = 'all' | 'project' | 'global'

interface KeyBackupEntry {
  keyName: string
  scope: 'project' | 'global'
  type: 'symmetric' | 'asymmetric'
  algorithm?: string
  publicKey?: string
  privateKey?: string
  symmetricKey?: string
}

interface KeyBackupBundle {
  kind: 'vaulter-key-backup'
  version: number
  projectName: string
  createdAt: string
  keys: KeyBackupEntry[]
}

interface KeyBackupSummary {
  keyName: string
  scope: 'project' | 'global'
  type: 'symmetric' | 'asymmetric'
  algorithm?: string
  hasPrivateKey: boolean
  hasPublicKey: boolean
  hasSymmetricKey: boolean
}

function parseBackupScope(args: CLIArgs): BackupScope {
  const rawScope = typeof args.scope === 'string' ? args.scope.trim().toLowerCase() : ''
  if (rawScope) {
    if (rawScope === 'all' || rawScope === 'project' || rawScope === 'global') {
      return rawScope
    }
    print.error(`Invalid scope: ${args.scope}`)
    ui.log('Valid scopes: all, project, global')
    process.exit(1)
  }

  if (args.global) return 'global'
  return 'all'
}

function listKeyNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const names = new Set<string>()
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const name = entry.name.replace(/\.pub$/, '')
    names.add(name)
  }
  return Array.from(names)
}

function readKeyFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return null
  return fs.readFileSync(filePath, 'utf-8')
}

function collectBackupEntries(
  scope: 'project' | 'global',
  projectName: string
): KeyBackupEntry[] {
  const keysDir = scope === 'global' ? getGlobalKeysDir() : getProjectKeysDir(projectName)
  const keyNames = listKeyNames(keysDir)
  const entries: KeyBackupEntry[] = []

  for (const keyName of keyNames) {
    const fullKeyName = scope === 'global' ? `global:${keyName}` : keyName
    const paths = resolveKeyPaths(fullKeyName, projectName)
    const publicKey = readKeyFile(paths.publicKey)
    const privateKey = readKeyFile(paths.privateKey)

    if (!publicKey && !privateKey) continue

    const isPrivatePem = !!privateKey && privateKey.includes('BEGIN') && privateKey.includes('KEY')
    const isAsymmetric = !!publicKey || isPrivatePem

    const entry: KeyBackupEntry = {
      keyName,
      scope,
      type: isAsymmetric ? 'asymmetric' : 'symmetric'
    }

    if (isAsymmetric) {
      if (publicKey) entry.publicKey = publicKey
      if (privateKey) entry.privateKey = privateKey
      const alg = detectAlgorithm(publicKey || privateKey || '')
      if (alg) entry.algorithm = alg
    } else if (privateKey) {
      entry.symmetricKey = privateKey
    }

    entries.push(entry)
  }

  return entries
}

function summarizeBackupEntries(entries: KeyBackupEntry[]): KeyBackupSummary[] {
  return entries.map(entry => ({
    keyName: entry.keyName,
    scope: entry.scope,
    type: entry.type,
    algorithm: entry.algorithm,
    hasPrivateKey: !!entry.privateKey,
    hasPublicKey: !!entry.publicKey,
    hasSymmetricKey: !!entry.symmetricKey
  }))
}

/**
 * Get project name from config or args, with fallback
 */
function getProjectName(context: KeyContext): string {
  return context.args.project || context.config?.project || 'default'
}

/**
 * Run the key command
 */
export async function runKey(context: KeyContext): Promise<void> {
  const { args } = context

  const subcommand = args._[1]

  switch (subcommand) {
    case 'generate':
    case 'gen':
      await runKeyGenerate(context)
      break

    case 'export':
      await runKeyExport(context)
      break

    case 'import':
      await runKeyImport(context)
      break

    case 'backup':
      await runKeyBackup(context)
      break

    case 'restore':
      await runKeyRestore(context)
      break

    case 'list':
    case 'ls':
      await runKeyList(context)
      break

    case 'show':
      await runKeyShow(context)
      break

    case 'rotate':
      await runKeyRotateImpl({
        ...context,
        getProjectName: () => getProjectName(context)
      })
      break

    default:
      printKeyHelp(subcommand)
      process.exit(1)
  }
}

function printKeyHelp(subcommand?: string): void {
  if (subcommand) {
    print.error(`Unknown key subcommand: ${subcommand}`)
  }
  ui.log('Available subcommands: generate, export, import, backup, restore, list, show, rotate')
  ui.log('')
  ui.log('Generate keys:')
  ui.log('  vaulter key generate --name master              # Symmetric key (default)')
  ui.log('  vaulter key generate --name master --asymmetric # RSA-4096 key pair')
  ui.log('  vaulter key generate --name master --asymmetric --algorithm ec-p256')
  ui.log('  vaulter key generate --name shared --global     # Global key')
  ui.log('')
  ui.log('Export/Import keys:')
  ui.log('  vaulter key export --name master -o keys.enc    # Export encrypted bundle')
  ui.log('  vaulter key import -f keys.enc                  # Import from bundle')
  ui.log('')
  ui.log('Backup/Restore keys:')
  ui.log('  vaulter key backup -o keys-backup.enc           # Backup all keys (project + global)')
  ui.log('  vaulter key restore -f keys-backup.enc          # Restore keys from backup')
  ui.log('  vaulter key backup -o keys.enc --scope project  # Backup project keys only')
  ui.log('')
  ui.log('List and show:')
  ui.log('  vaulter key list                                # List all keys')
  ui.log('  vaulter key show --name master                  # Show key info')
  ui.log('')
  ui.log('Options:')
  ui.log('  --name <name>              Key name (required for generate)')
  ui.log('  --global                   Use global scope instead of project')
  ui.log('  --asymmetric               Generate asymmetric key pair')
  ui.log('  --algorithm <alg>          Algorithm: rsa-4096 (default), rsa-2048, ec-p256, ec-p384')
  ui.log('  -o, --output <path>        Output file for export')
  ui.log('  -f, --file <path>          Input file for import')
  ui.log('  --scope <scope>            Scope for backup/restore: all, project, global')
  ui.log('  --force                    Overwrite existing keys')
  ui.log('')
  ui.log('Per-environment keys:')
  ui.log('  vaulter key generate --env prd             Create key for production')
  ui.log('  vaulter key generate --env dev --asymmetric')
  ui.log('  vaulter key list                           List all keys with environments')
}

/**
 * Generate a new encryption key
 *
 * Supports per-environment keys with --env flag:
 * - vaulter key generate --env prd           # Creates key named "prd"
 * - vaulter key generate --name master       # Creates default key
 * - vaulter key generate --name custom --env prd  # Creates key "custom" for prd
 */
async function runKeyGenerate(context: KeyContext): Promise<void> {
  const { args, config } = context

  const targetEnv = args.env
  const isGlobal = args.global
  const isAsymmetric = args.asymmetric
  const algorithmArg = (args.algorithm || 'rsa-4096') as AsymmetricAlgorithm

  // Key name: explicit --name > --env > error
  const keyName = args.name || targetEnv

  // Validate key name is provided
  if (!keyName) {
    print.error('--name or --env is required')
    ui.log('Examples:')
    ui.log('  vaulter key generate --name master       # Default key for all envs')
    ui.log('  vaulter key generate --env prd           # Key for production')
    ui.log('  vaulter key generate --env dev --asymmetric')
    process.exit(1)
  }

  // Validate environment if specified
  if (targetEnv && config) {
    const validEnvs = getValidEnvironments(config)
    if (!validEnvs.includes(targetEnv)) {
      print.warning(`Environment '${targetEnv}' not in configured environments: ${validEnvs.join(', ')}`)
      ui.log('Proceeding anyway...')
    }
  }

  // Validate algorithm if asymmetric
  const validAlgorithms: AsymmetricAlgorithm[] = ['rsa-4096', 'rsa-2048', 'ec-p256', 'ec-p384']
  if (isAsymmetric && !validAlgorithms.includes(algorithmArg)) {
    print.error(`Invalid algorithm: ${algorithmArg}`)
    ui.log(`Valid algorithms: ${validAlgorithms.join(', ')}`)
    process.exit(1)
  }

  const projectName = getProjectName(context)
  const fullKeyName = isGlobal ? `global:${keyName}` : keyName

  // Check if key already exists
  const existing = keyExists(fullKeyName, projectName)
  if (existing.exists && !args.force) {
    print.error(`Key '${keyName}' already exists${isGlobal ? ' (global)' : ''}`)
    ui.log('Use --force to overwrite')
    process.exit(1)
  }

  if (isAsymmetric) {
    await generateAsymmetricKey(context, fullKeyName, projectName, algorithmArg)
  } else {
    await generateSymmetricKey(context, fullKeyName, projectName)
  }
}

/**
 * Generate symmetric key
 */
async function generateSymmetricKey(
  context: KeyContext,
  keyName: string,
  projectName: string
): Promise<void> {
  const { verbose, dryRun, jsonOutput } = context

  const keyPath = resolveKeyPath(keyName, projectName, false)

  ui.verbose('Generating new AES-256 symmetric key...', verbose)
  ui.verbose(`  Path: ${keyPath}`, verbose)

  if (dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        dryRun: true,
        action: 'generate_key',
        mode: 'symmetric',
        keyName,
        outputPath: keyPath,
        algorithm: 'aes-256-gcm'
      }))
    } else {
      ui.log(`Dry run - would generate symmetric key: ${keyPath}`)
    }
    return
  }

  const key = generatePassphrase(32)

  // Ensure directory exists
  const dir = path.dirname(keyPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Write key with restricted permissions
  fs.writeFileSync(keyPath, key + '\n', { mode: 0o600 })

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: true,
      mode: 'symmetric',
      keyName,
      outputPath: keyPath,
      algorithm: 'aes-256-gcm'
    }))
  } else {
    const { scope, name } = parseKeyName(keyName)
    ui.success(`Generated symmetric key: ${name}${scope === 'global' ? ' (global)' : ''}`)
    ui.log(`  Path: ${keyPath}`)
    ui.log('')
    ui.log('To use this key in config.yaml:')
    ui.log('  encryption:')
    ui.log('    mode: symmetric')
    ui.log('    key_source:')
    ui.log(`      - file: ${keyPath}`)
  }
}

/**
 * Generate asymmetric key pair
 */
async function generateAsymmetricKey(
  context: KeyContext,
  keyName: string,
  projectName: string,
  algorithm: AsymmetricAlgorithm
): Promise<void> {
  const { verbose, dryRun, jsonOutput } = context

  const paths = resolveKeyPaths(keyName, projectName)

  ui.verbose(`Generating new ${algorithm} key pair...`, verbose)
  ui.verbose(`  Private: ${paths.privateKey}`, verbose)
  ui.verbose(`  Public:  ${paths.publicKey}`, verbose)

  if (dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        dryRun: true,
        action: 'generate_keypair',
        mode: 'asymmetric',
        keyName,
        algorithm,
        privateKeyPath: paths.privateKey,
        publicKeyPath: paths.publicKey
      }))
    } else {
      ui.log(`Dry run - would generate ${algorithm} key pair:`)
      ui.log(`  Private: ${paths.privateKey}`)
      ui.log(`  Public:  ${paths.publicKey}`)
    }
    return
  }

  // Generate the key pair
  const keyPair = generateKeyPair(algorithm)

  // Ensure directory exists
  const dir = path.dirname(paths.privateKey)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Write private key with restricted permissions (600)
  fs.writeFileSync(paths.privateKey, keyPair.privateKey, { mode: 0o600 })

  // Write public key with standard permissions (644)
  fs.writeFileSync(paths.publicKey, keyPair.publicKey, { mode: 0o644 })

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: true,
      mode: 'asymmetric',
      keyName,
      algorithm,
      privateKeyPath: paths.privateKey,
      publicKeyPath: paths.publicKey
    }))
  } else {
    const { scope, name } = parseKeyName(keyName)
    ui.success(`Generated ${algorithm} key pair: ${name}${scope === 'global' ? ' (global)' : ''}`)
    ui.log(`  Private: ${paths.privateKey} (mode 600 - keep secret!)`)
    ui.log(`  Public:  ${paths.publicKey} (mode 644)`)
    ui.log('')
    ui.log('To use these keys in config.yaml:')
    ui.log('  encryption:')
    ui.log('    mode: asymmetric')
    ui.log('    asymmetric:')
    ui.log(`      algorithm: ${algorithm}`)
    ui.log(`      key_name: ${scope === 'global' ? 'global:' : ''}${name}`)
  }
}

/**
 * Export keys to an encrypted bundle
 */
async function runKeyExport(context: KeyContext): Promise<void> {
  const { args, verbose, dryRun, jsonOutput } = context

  const keyName = args.name
  const outputPath = args.output
  const isGlobal = args.global

  if (!keyName) {
    print.error('--name is required')
    ui.log('Example: vaulter key export --name master --output keys.enc')
    process.exit(1)
  }

  if (!outputPath) {
    print.error('--output is required')
    ui.log('Example: vaulter key export --name master --output keys.enc')
    process.exit(1)
  }

  const projectName = getProjectName(context)
  const fullKeyName = isGlobal ? `global:${keyName}` : keyName
  const paths = resolveKeyPaths(fullKeyName, projectName)

  // Check if keys exist
  const existing = keyExists(fullKeyName, projectName)
  if (!existing.exists) {
    print.error(`Key '${keyName}' not found${isGlobal ? ' (global)' : ''}`)
    process.exit(1)
  }

  ui.verbose(`Exporting key: ${keyName}`, verbose)
  ui.verbose(`  Private: ${existing.privateKey ? 'found' : 'not found'}`, verbose)
  ui.verbose(`  Public:  ${existing.publicKey ? 'found' : 'not found'}`, verbose)

  if (dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        dryRun: true,
        action: 'export_key',
        keyName: fullKeyName,
        outputPath,
        hasPrivateKey: existing.privateKey,
        hasPublicKey: existing.publicKey
      }))
    } else {
      ui.log(`Dry run - would export key '${keyName}' to ${outputPath}`)
    }
    return
  }

  // Read keys
  const bundle: {
    version: number
    keyName: string
    projectName: string
    algorithm?: string
    publicKey?: string
    privateKey?: string
    createdAt: string
  } = {
    version: 1,
    keyName: fullKeyName,
    projectName,
    createdAt: new Date().toISOString()
  }

  if (existing.publicKey) {
    const content = fs.readFileSync(paths.publicKey, 'utf-8')
    bundle.publicKey = content
    // Try to detect algorithm
    const alg = detectAlgorithm(content)
    if (alg) bundle.algorithm = alg
  }

  if (existing.privateKey) {
    const content = fs.readFileSync(paths.privateKey, 'utf-8')
    bundle.privateKey = content
    // Try to detect algorithm from private key if not already set
    if (!bundle.algorithm) {
      const alg = detectAlgorithm(content)
      if (alg) bundle.algorithm = alg
    }
  }

  // Prompt for passphrase (in real implementation)
  // For now, use a simple encryption
  const passphrase = process.env.VAULTER_EXPORT_PASSPHRASE || 'vaulter-export-key'

  // Encrypt bundle
  const plaintext = JSON.stringify(bundle)
  const salt = crypto.randomBytes(16)
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Package: salt (16) + iv (12) + authTag (16) + encrypted
  const output = Buffer.concat([salt, iv, authTag, encrypted])

  // Write to file
  const absPath = path.resolve(outputPath)
  fs.writeFileSync(absPath, output)

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: true,
      action: 'export_key',
      keyName: fullKeyName,
      outputPath: absPath,
      hasPrivateKey: existing.privateKey,
      hasPublicKey: existing.publicKey
    }))
  } else {
    ui.success(`Exported key '${keyName}' to ${absPath}`)
    ui.log('')
    ui.log('To import on another machine:')
    ui.log(`  vaulter key import -f ${outputPath}`)
    if (process.env.VAULTER_EXPORT_PASSPHRASE) {
      ui.log('')
      ui.log('Note: Set VAULTER_EXPORT_PASSPHRASE to the same value when importing')
    }
  }
}

/**
 * Import keys from an encrypted bundle
 */
async function runKeyImport(context: KeyContext): Promise<void> {
  const { args, verbose, dryRun, jsonOutput } = context

  const inputPath = args.file
  const isGlobal = args.global

  if (!inputPath) {
    print.error('--file is required')
    ui.log('Example: vaulter key import --file keys.enc')
    process.exit(1)
  }

  const absPath = path.resolve(inputPath)
  if (!fs.existsSync(absPath)) {
    print.error(`File not found: ${absPath}`)
    process.exit(1)
  }

  // Read and decrypt bundle
  const input = fs.readFileSync(absPath)

  // Extract: salt (16) + iv (12) + authTag (16) + encrypted
  const salt = input.subarray(0, 16)
  const iv = input.subarray(16, 28)
  const authTag = input.subarray(28, 44)
  const encrypted = input.subarray(44)

  const passphrase = process.env.VAULTER_EXPORT_PASSPHRASE || 'vaulter-export-key'
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256')

  let bundle: {
    version: number
    keyName: string
    projectName: string
    algorithm?: string
    publicKey?: string
    privateKey?: string
    createdAt: string
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    bundle = JSON.parse(decrypted.toString('utf8'))
  } catch (err) {
    print.error('Failed to decrypt bundle')
    ui.log('  Check that VAULTER_EXPORT_PASSPHRASE is correct')
    process.exit(1)
  }

  ui.verbose('Bundle contents:', verbose)
  ui.verbose(`  Key name: ${bundle.keyName}`, verbose)
  ui.verbose(`  Project: ${bundle.projectName}`, verbose)
  ui.verbose(`  Algorithm: ${bundle.algorithm || 'symmetric'}`, verbose)
  ui.verbose(`  Has private key: ${!!bundle.privateKey}`, verbose)
  ui.verbose(`  Has public key: ${!!bundle.publicKey}`, verbose)

  // Determine target key name
  const projectName = getProjectName(context)
  let targetKeyName = args.name || parseKeyName(bundle.keyName).name
  if (isGlobal) {
    targetKeyName = `global:${targetKeyName}`
  }

  const paths = resolveKeyPaths(targetKeyName, projectName)

  // Check if keys already exist
  const existing = keyExists(targetKeyName, projectName)
  if (existing.exists && !args.force) {
    print.error(`Key '${targetKeyName}' already exists`)
    ui.log('Use --force to overwrite')
    process.exit(1)
  }

  if (dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        dryRun: true,
        action: 'import_key',
        sourceKeyName: bundle.keyName,
        targetKeyName,
        hasPrivateKey: !!bundle.privateKey,
        hasPublicKey: !!bundle.publicKey,
        privateKeyPath: paths.privateKey,
        publicKeyPath: paths.publicKey
      }))
    } else {
      ui.log(`Dry run - would import key '${targetKeyName}'`)
      ui.log(`  Private: ${paths.privateKey}`)
      ui.log(`  Public:  ${paths.publicKey}`)
    }
    return
  }

  // Ensure directory exists
  const dir = path.dirname(paths.privateKey)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Write keys
  if (bundle.privateKey) {
    fs.writeFileSync(paths.privateKey, bundle.privateKey, { mode: 0o600 })
  }
  if (bundle.publicKey) {
    fs.writeFileSync(paths.publicKey, bundle.publicKey, { mode: 0o644 })
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: true,
      action: 'import_key',
      keyName: targetKeyName,
      hasPrivateKey: !!bundle.privateKey,
      hasPublicKey: !!bundle.publicKey,
      privateKeyPath: bundle.privateKey ? paths.privateKey : null,
      publicKeyPath: bundle.publicKey ? paths.publicKey : null
    }))
  } else {
    const { scope, name } = parseKeyName(targetKeyName)
    ui.success(`Imported key: ${name}${scope === 'global' ? ' (global)' : ''}`)
    if (bundle.privateKey) {
      ui.log(`  Private: ${paths.privateKey}`)
    }
    if (bundle.publicKey) {
      ui.log(`  Public:  ${paths.publicKey}`)
    }
  }
}

/**
 * Backup keys to an encrypted bundle
 */
async function runKeyBackup(context: KeyContext): Promise<void> {
  const { args, verbose, dryRun, jsonOutput } = context

  const outputPath = args.output
  if (!outputPath) {
    print.error('--output is required')
    ui.log('Example: vaulter key backup --output keys-backup.enc')
    process.exit(1)
  }

  const scope = parseBackupScope(args)
  const includeProject = scope === 'all' || scope === 'project'
  const includeGlobal = scope === 'all' || scope === 'global'

  const projectName = getProjectName(context)
  const entries: KeyBackupEntry[] = []

  if (includeProject) {
    entries.push(...collectBackupEntries('project', projectName))
  }
  if (includeGlobal) {
    entries.push(...collectBackupEntries('global', projectName))
  }

  const scopeOrder: Record<'project' | 'global', number> = { project: 0, global: 1 }
  entries.sort((a, b) => {
    const scopeDiff = scopeOrder[a.scope] - scopeOrder[b.scope]
    return scopeDiff !== 0 ? scopeDiff : a.keyName.localeCompare(b.keyName)
  })

  const bundle: KeyBackupBundle = {
    kind: 'vaulter-key-backup',
    version: 1,
    projectName,
    createdAt: new Date().toISOString(),
    keys: entries
  }

  const absPath = path.resolve(outputPath)
  const summaries = summarizeBackupEntries(entries)

  if (dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        dryRun: true,
        action: 'backup_keys',
        outputPath: absPath,
        projectName,
        scope,
        keyCount: entries.length,
        keys: summaries
      }))
    } else {
      ui.log(`Dry run - would backup ${entries.length} keys to ${absPath}`)
      if (verbose && summaries.length > 0) {
        for (const entry of summaries) {
          ui.log(`  ${entry.keyName} (${entry.scope}, ${entry.type}${entry.algorithm ? ` ${entry.algorithm}` : ''})`)
        }
      }
    }
    return
  }

  const passphrase = process.env.VAULTER_EXPORT_PASSPHRASE || 'vaulter-export-key'
  const plaintext = JSON.stringify(bundle)
  const salt = crypto.randomBytes(16)
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const output = Buffer.concat([salt, iv, authTag, encrypted])

  fs.writeFileSync(absPath, output)

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: true,
      action: 'backup_keys',
      outputPath: absPath,
      projectName,
      scope,
      keyCount: entries.length,
      keys: summaries
    }))
  } else {
    ui.success(`Backed up ${entries.length} keys to ${absPath}`)
    ui.log(`  Project: ${projectName}`)
    ui.log(`  Scope: ${scope}`)
    if (process.env.VAULTER_EXPORT_PASSPHRASE) {
      ui.log('  Note: VAULTER_EXPORT_PASSPHRASE was used to encrypt this backup')
    }
  }
}

/**
 * Restore keys from an encrypted backup
 */
async function runKeyRestore(context: KeyContext): Promise<void> {
  const { args, verbose, dryRun, jsonOutput } = context

  const inputPath = args.file
  if (!inputPath) {
    print.error('--file is required')
    ui.log('Example: vaulter key restore --file keys-backup.enc')
    process.exit(1)
  }

  const absPath = path.resolve(inputPath)
  if (!fs.existsSync(absPath)) {
    print.error(`File not found: ${absPath}`)
    process.exit(1)
  }

  const scope = parseBackupScope(args)
  const projectName = getProjectName(context)
  const input = fs.readFileSync(absPath)

  const passphrase = process.env.VAULTER_EXPORT_PASSPHRASE || 'vaulter-export-key'
  const salt = input.subarray(0, 16)
  const iv = input.subarray(16, 28)
  const authTag = input.subarray(28, 44)
  const encrypted = input.subarray(44)
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256')

  let bundle: KeyBackupBundle
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    bundle = JSON.parse(decrypted.toString('utf8')) as KeyBackupBundle
  } catch (err) {
    print.error('Failed to decrypt backup')
    ui.log('  Check that VAULTER_EXPORT_PASSPHRASE is correct')
    process.exit(1)
  }

  if (bundle.kind !== 'vaulter-key-backup' || !Array.isArray(bundle.keys)) {
    print.error('Invalid backup bundle')
    ui.log('  Use "vaulter key import" to restore a single key export')
    process.exit(1)
  }

  const filteredKeys = bundle.keys.filter(entry => scope === 'all' || entry.scope === scope)
  const summaries = summarizeBackupEntries(filteredKeys)

  if (filteredKeys.length === 0) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        action: 'restore_keys',
        restored: 0,
        scope,
        message: 'No keys to restore for requested scope'
      }))
    } else {
      ui.log('No keys to restore for requested scope.')
    }
    return
  }

  const conflicts: string[] = []
  const targets = filteredKeys.map(entry => {
    const fullKeyName = entry.scope === 'global' ? `global:${entry.keyName}` : entry.keyName
    const paths = resolveKeyPaths(fullKeyName, projectName)
    const symmetricKey = entry.symmetricKey || (entry.type === 'symmetric' ? entry.privateKey : undefined)
    const writePrivate = entry.type === 'asymmetric' ? !!entry.privateKey : !!symmetricKey
    const writePublic = entry.type === 'asymmetric' && !!entry.publicKey

    if (!args.force) {
      if (writePrivate && fs.existsSync(paths.privateKey)) {
        conflicts.push(`${fullKeyName} (private)`)
      }
      if (writePublic && fs.existsSync(paths.publicKey)) {
        conflicts.push(`${fullKeyName} (public)`)
      }
    }

    return { entry, fullKeyName, paths, symmetricKey, writePrivate, writePublic }
  })

  if (conflicts.length > 0 && !args.force) {
    print.error('Some keys already exist')
    for (const conflict of conflicts) {
      ui.log(`  ${conflict}`)
    }
    ui.log('Use --force to overwrite')
    process.exit(1)
  }

  if (dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        dryRun: true,
        action: 'restore_keys',
        inputPath: absPath,
        projectName,
        scope,
        keyCount: filteredKeys.length,
        keys: summaries
      }))
    } else {
      ui.log(`Dry run - would restore ${filteredKeys.length} keys from ${absPath}`)
      if (verbose && summaries.length > 0) {
        for (const entry of summaries) {
          ui.log(`  ${entry.keyName} (${entry.scope}, ${entry.type}${entry.algorithm ? ` ${entry.algorithm}` : ''})`)
        }
      }
    }
    return
  }

  let restoredCount = 0
  let skippedCount = 0

  for (const target of targets) {
    const dir = path.dirname(target.paths.privateKey)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    if (target.entry.type === 'symmetric') {
      if (!target.symmetricKey) {
        skippedCount++
        continue
      }
      fs.writeFileSync(target.paths.privateKey, target.symmetricKey, { mode: 0o600 })
      restoredCount++
      continue
    }

    let wrote = false
    if (target.entry.privateKey) {
      fs.writeFileSync(target.paths.privateKey, target.entry.privateKey, { mode: 0o600 })
      wrote = true
    }
    if (target.entry.publicKey) {
      fs.writeFileSync(target.paths.publicKey, target.entry.publicKey, { mode: 0o644 })
      wrote = true
    }

    if (wrote) {
      restoredCount++
    } else {
      skippedCount++
    }
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: true,
      action: 'restore_keys',
      inputPath: absPath,
      projectName,
      scope,
      restored: restoredCount,
      skipped: skippedCount,
      keys: summaries
    }))
  } else {
    ui.success(`Restored ${restoredCount} keys from ${absPath}`)
    if (skippedCount > 0) {
      ui.log(`  Skipped: ${skippedCount} (missing key material)`)
    }
  }
}

/**
 * List all keys
 */
async function runKeyList(context: KeyContext): Promise<void> {
  const { jsonOutput } = context
  const projectName = getProjectName(context)

  const projectKeysDir = getProjectKeysDir(projectName)
  const globalKeysDir = getGlobalKeysDir()

  const keys: Array<{
    name: string
    scope: 'project' | 'global'
    type: 'symmetric' | 'asymmetric'
    algorithm?: string
    hasPrivateKey: boolean
    hasPublicKey: boolean
  }> = []

  // List project keys
  if (fs.existsSync(projectKeysDir)) {
    const files = fs.readdirSync(projectKeysDir)
    const keyNames = new Set<string>()

    for (const file of files) {
      const name = file.replace(/\.pub$/, '')
      keyNames.add(name)
    }

    for (const name of keyNames) {
      const pubPath = path.join(projectKeysDir, name + '.pub')
      const privPath = path.join(projectKeysDir, name)
      const hasPublicKey = fs.existsSync(pubPath)
      const hasPrivateKey = fs.existsSync(privPath) && !privPath.endsWith('.pub')

      let type: 'symmetric' | 'asymmetric' = 'symmetric'
      let algorithm: string | undefined

      if (hasPublicKey) {
        type = 'asymmetric'
        const content = fs.readFileSync(pubPath, 'utf-8')
        algorithm = detectAlgorithm(content) || undefined
      } else if (hasPrivateKey) {
        const content = fs.readFileSync(privPath, 'utf-8')
        if (content.includes('BEGIN') && content.includes('KEY')) {
          type = 'asymmetric'
          algorithm = detectAlgorithm(content) || undefined
        }
      }

      keys.push({
        name,
        scope: 'project',
        type,
        algorithm,
        hasPrivateKey: fs.existsSync(privPath) && fs.statSync(privPath).isFile(),
        hasPublicKey
      })
    }
  }

  // List global keys
  if (fs.existsSync(globalKeysDir)) {
    const files = fs.readdirSync(globalKeysDir)
    const keyNames = new Set<string>()

    for (const file of files) {
      const name = file.replace(/\.pub$/, '')
      keyNames.add(name)
    }

    for (const name of keyNames) {
      const pubPath = path.join(globalKeysDir, name + '.pub')
      const privPath = path.join(globalKeysDir, name)
      const hasPublicKey = fs.existsSync(pubPath)
      const hasPrivateKey = fs.existsSync(privPath) && !privPath.endsWith('.pub')

      let type: 'symmetric' | 'asymmetric' = 'symmetric'
      let algorithm: string | undefined

      if (hasPublicKey) {
        type = 'asymmetric'
        const content = fs.readFileSync(pubPath, 'utf-8')
        algorithm = detectAlgorithm(content) || undefined
      } else if (hasPrivateKey) {
        const content = fs.readFileSync(privPath, 'utf-8')
        if (content.includes('BEGIN') && content.includes('KEY')) {
          type = 'asymmetric'
          algorithm = detectAlgorithm(content) || undefined
        }
      }

      keys.push({
        name,
        scope: 'global',
        type,
        algorithm,
        hasPrivateKey: fs.existsSync(privPath) && fs.statSync(privPath).isFile(),
        hasPublicKey
      })
    }
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({ keys, projectName, projectKeysDir, globalKeysDir }))
  } else {
    ui.log(`Keys for project: ${projectName}`)
    ui.log(`  Project keys: ${projectKeysDir}`)
    ui.log(`  Global keys:  ${globalKeysDir}`)
    ui.log('')

    if (keys.length === 0) {
      ui.log('No keys found')
      ui.log('')
      ui.log('Generate a new key:')
      ui.log('  vaulter key generate --name master --asymmetric')
    } else {
      for (const key of keys) {
        const scopeLabel = key.scope === 'global' ? ' (global)' : ''
        const typeLabel = key.type === 'asymmetric' ? ` [${key.algorithm || 'asymmetric'}]` : ' [symmetric]'
        const privLabel = key.hasPrivateKey ? '✓' : '✗'
        const pubLabel = key.hasPublicKey ? '✓' : '✗'
        ui.log(`  ${key.name}${scopeLabel}${typeLabel}`)
        ui.log(`    Private: ${privLabel}  Public: ${pubLabel}`)
      }
    }
  }
}

/**
 * Show current key configuration
 */
async function runKeyShow(context: KeyContext): Promise<void> {
  const { args, config, jsonOutput } = context

  const keyName = args.name
  const isGlobal = args.global
  const projectName = getProjectName(context)

  if (keyName) {
    // Show specific key info
    const fullKeyName = isGlobal ? `global:${keyName}` : keyName
    const paths = resolveKeyPaths(fullKeyName, projectName)
    const existing = keyExists(fullKeyName, projectName)

    if (!existing.exists) {
      print.error(`Key '${keyName}' not found${isGlobal ? ' (global)' : ''}`)
      process.exit(1)
    }

    let algorithm: string | null = null
    if (existing.publicKey) {
      const content = fs.readFileSync(paths.publicKey, 'utf-8')
      algorithm = detectAlgorithm(content)
    } else if (existing.privateKey) {
      const content = fs.readFileSync(paths.privateKey, 'utf-8')
      algorithm = detectAlgorithm(content)
    }

    if (jsonOutput) {
      ui.output(JSON.stringify({
        keyName: fullKeyName,
        algorithm,
        hasPrivateKey: existing.privateKey,
        hasPublicKey: existing.publicKey,
        privateKeyPath: existing.privateKey ? paths.privateKey : null,
        publicKeyPath: existing.publicKey ? paths.publicKey : null
      }))
    } else {
      const { scope, name } = parseKeyName(fullKeyName)
      ui.log(`Key: ${name}${scope === 'global' ? ' (global)' : ''}`)
      ui.log(`  Algorithm: ${algorithm || 'symmetric'}`)
      ui.log(`  Private key: ${existing.privateKey ? paths.privateKey : '(not found)'}`)
      ui.log(`  Public key:  ${existing.publicKey ? paths.publicKey : '(not found)'}`)
    }
    return
  }

  // Show config info
  if (!config) {
    print.error('No vaulter configuration found')
    ui.log('Run "vaulter init" first')
    process.exit(1)
  }

  const encryptionConfig = config.encryption || {}
  const mode = encryptionConfig.mode || 'symmetric'

  if (jsonOutput) {
    ui.output(JSON.stringify({
      mode,
      keyName: encryptionConfig.asymmetric?.key_name || null,
      algorithm: encryptionConfig.asymmetric?.algorithm || null,
      keySources: encryptionConfig.key_source || [],
      asymmetricConfig: encryptionConfig.asymmetric || null
    }))
  } else {
    ui.log('Encryption Configuration:')
    ui.log(`  Mode: ${mode}`)

    if (mode === 'asymmetric' && encryptionConfig.asymmetric) {
      const asymConfig = encryptionConfig.asymmetric
      ui.log(`  Algorithm: ${asymConfig.algorithm || 'rsa-4096'}`)
      if (asymConfig.key_name) {
        ui.log(`  Key name: ${asymConfig.key_name}`)
        const existing = keyExists(asymConfig.key_name, projectName)
        ui.log(`    Private: ${existing.privateKey ? '✓' : '✗'}  Public: ${existing.publicKey ? '✓' : '✗'}`)
      }
    }

    if (encryptionConfig.key_source && encryptionConfig.key_source.length > 0) {
      ui.log('  Key sources:')
      for (const source of encryptionConfig.key_source) {
        if ('env' in source) {
          const available = !!process.env[source.env]
          ui.log(`    ${available ? '✓' : '✗'} env: ${source.env}`)
        } else if ('file' in source) {
          const available = fs.existsSync(path.resolve(source.file))
          ui.log(`    ${available ? '✓' : '✗'} file: ${source.file}`)
        } else if ('s3' in source) {
          ui.log(`    ? s3: ${source.s3}`)
        }
      }
    }
  }
}
