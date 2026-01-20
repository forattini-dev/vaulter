/**
 * Vaulter MCP Tools - Key Management Handlers
 *
 * Handlers for key_generate, key_list, key_show, key_export, key_import
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  getProjectKeysDir,
  getGlobalKeysDir,
  resolveKeyPath,
  resolveKeyPaths,
  keyExists,
  parseKeyName
} from '../../../lib/config-loader.js'
import { generateKeyPair, generatePassphrase, detectAlgorithm } from '../../../lib/crypto.js'
import type { VaulterConfig, AsymmetricAlgorithm } from '../../../types.js'
import type { ToolResponse } from '../config.js'

/**
 * Get project name for key operations
 */
function getKeyProjectName(args: Record<string, unknown>, config: VaulterConfig | null): string {
  return (args.project as string) || config?.project || 'default'
}

/**
 * Handle key generate
 */
export async function handleKeyGenerateCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<ToolResponse> {
  const keyName = args.name as string
  const isGlobal = args.global as boolean || false
  const isAsymmetric = args.asymmetric as boolean || false
  const algorithm = (args.algorithm as AsymmetricAlgorithm) || 'rsa-4096'
  const force = args.force as boolean || false
  const projectName = getKeyProjectName(args, config)

  if (!keyName) {
    return { content: [{ type: 'text', text: 'Error: name is required' }] }
  }

  // Validate algorithm if asymmetric
  const validAlgorithms: AsymmetricAlgorithm[] = ['rsa-4096', 'rsa-2048', 'ec-p256', 'ec-p384']
  if (isAsymmetric && !validAlgorithms.includes(algorithm)) {
    return { content: [{ type: 'text', text: `Error: Invalid algorithm: ${algorithm}. Valid: ${validAlgorithms.join(', ')}` }] }
  }

  const fullKeyName = isGlobal ? `global:${keyName}` : keyName

  // Check if key already exists
  const existing = keyExists(fullKeyName, projectName)
  if (existing.exists && !force) {
    return { content: [{ type: 'text', text: `Error: Key '${keyName}' already exists${isGlobal ? ' (global)' : ''}. Use force=true to overwrite` }] }
  }

  if (isAsymmetric) {
    // Generate asymmetric key pair
    const paths = resolveKeyPaths(fullKeyName, projectName)
    const keyPair = generateKeyPair(algorithm)

    // Ensure directory exists
    const dir = path.dirname(paths.privateKey)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Write keys
    fs.writeFileSync(paths.privateKey, keyPair.privateKey, { mode: 0o600 })
    fs.writeFileSync(paths.publicKey, keyPair.publicKey, { mode: 0o644 })

    const { scope, name } = parseKeyName(fullKeyName)
    return {
      content: [{
        type: 'text',
        text: [
          `✓ Generated ${algorithm} key pair: ${name}${scope === 'global' ? ' (global)' : ''}`,
          `  Private: ${paths.privateKey}`,
          `  Public:  ${paths.publicKey}`,
          '',
          'To use in config.yaml:',
          '  encryption:',
          '    mode: asymmetric',
          '    asymmetric:',
          `      algorithm: ${algorithm}`,
          `      key_name: ${fullKeyName}`
        ].join('\n')
      }]
    }
  } else {
    // Generate symmetric key
    const keyPath = resolveKeyPath(fullKeyName, projectName, false)
    const key = generatePassphrase(32)

    // Ensure directory exists
    const dir = path.dirname(keyPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Write key
    fs.writeFileSync(keyPath, key + '\n', { mode: 0o600 })

    const { scope, name } = parseKeyName(fullKeyName)
    return {
      content: [{
        type: 'text',
        text: [
          `✓ Generated symmetric key: ${name}${scope === 'global' ? ' (global)' : ''}`,
          `  Path: ${keyPath}`,
          '',
          'To use in config.yaml:',
          '  encryption:',
          '    mode: symmetric',
          '    key_source:',
          `      - file: ${keyPath}`
        ].join('\n')
      }]
    }
  }
}

/**
 * Handle key list
 */
export async function handleKeyListCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<ToolResponse> {
  const projectName = getKeyProjectName(args, config)
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

  const lines = [
    `Keys for project: ${projectName}`,
    `  Project keys: ${projectKeysDir}`,
    `  Global keys:  ${globalKeysDir}`,
    ''
  ]

  if (keys.length === 0) {
    lines.push('No keys found')
    lines.push('')
    lines.push('Generate a new key:')
    lines.push('  vaulter_key_generate({ name: "master", asymmetric: true })')
  } else {
    for (const key of keys) {
      const scopeLabel = key.scope === 'global' ? ' (global)' : ''
      const typeLabel = key.type === 'asymmetric' ? ` [${key.algorithm || 'asymmetric'}]` : ' [symmetric]'
      const privLabel = key.hasPrivateKey ? '✓' : '✗'
      const pubLabel = key.hasPublicKey ? '✓' : '✗'
      lines.push(`  ${key.name}${scopeLabel}${typeLabel}`)
      lines.push(`    Private: ${privLabel}  Public: ${pubLabel}`)
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Handle key show
 */
export async function handleKeyShowCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<ToolResponse> {
  const keyName = args.name as string
  const isGlobal = args.global as boolean || false
  const projectName = getKeyProjectName(args, config)

  if (!keyName) {
    return { content: [{ type: 'text', text: 'Error: name is required' }] }
  }

  const fullKeyName = isGlobal ? `global:${keyName}` : keyName
  const paths = resolveKeyPaths(fullKeyName, projectName)
  const existing = keyExists(fullKeyName, projectName)

  if (!existing.exists) {
    return { content: [{ type: 'text', text: `Error: Key '${keyName}' not found${isGlobal ? ' (global)' : ''}` }] }
  }

  let algorithm: string | null = null
  if (existing.publicKey) {
    const content = fs.readFileSync(paths.publicKey, 'utf-8')
    algorithm = detectAlgorithm(content)
  } else if (existing.privateKey) {
    const content = fs.readFileSync(paths.privateKey, 'utf-8')
    algorithm = detectAlgorithm(content)
  }

  const { scope, name } = parseKeyName(fullKeyName)
  const lines = [
    `Key: ${name}${scope === 'global' ? ' (global)' : ''}`,
    `  Algorithm: ${algorithm || 'symmetric'}`,
    `  Private key: ${existing.privateKey ? paths.privateKey : '(not found)'}`,
    `  Public key:  ${existing.publicKey ? paths.publicKey : '(not found)'}`
  ]

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Handle key export
 */
export async function handleKeyExportCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<ToolResponse> {
  const keyName = args.name as string
  const outputPath = args.output as string
  const isGlobal = args.global as boolean || false
  const projectName = getKeyProjectName(args, config)

  if (!keyName) {
    return { content: [{ type: 'text', text: 'Error: name is required' }] }
  }

  if (!outputPath) {
    return { content: [{ type: 'text', text: 'Error: output path is required' }] }
  }

  const fullKeyName = isGlobal ? `global:${keyName}` : keyName
  const paths = resolveKeyPaths(fullKeyName, projectName)
  const existing = keyExists(fullKeyName, projectName)

  if (!existing.exists) {
    return { content: [{ type: 'text', text: `Error: Key '${keyName}' not found${isGlobal ? ' (global)' : ''}` }] }
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
    const alg = detectAlgorithm(content)
    if (alg) bundle.algorithm = alg
  }

  if (existing.privateKey) {
    const content = fs.readFileSync(paths.privateKey, 'utf-8')
    bundle.privateKey = content
    if (!bundle.algorithm) {
      const alg = detectAlgorithm(content)
      if (alg) bundle.algorithm = alg
    }
  }

  // Encrypt bundle
  const passphrase = process.env.VAULTER_EXPORT_PASSPHRASE || 'vaulter-export-key'
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

  return {
    content: [{
      type: 'text',
      text: [
        `✓ Exported key '${keyName}' to ${absPath}`,
        '',
        'To import on another machine:',
        `  vaulter_key_import({ file: "${outputPath}" })`,
        '',
        process.env.VAULTER_EXPORT_PASSPHRASE
          ? 'Note: Set VAULTER_EXPORT_PASSPHRASE to the same value when importing'
          : 'Note: Using default passphrase. Set VAULTER_EXPORT_PASSPHRASE for better security'
      ].join('\n')
    }]
  }
}

/**
 * Handle key import
 */
export async function handleKeyImportCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<ToolResponse> {
  const inputPath = args.file as string
  const targetName = args.name as string | undefined
  const isGlobal = args.global as boolean || false
  const force = args.force as boolean || false
  const projectName = getKeyProjectName(args, config)

  if (!inputPath) {
    return { content: [{ type: 'text', text: 'Error: file path is required' }] }
  }

  const absPath = path.resolve(inputPath)
  if (!fs.existsSync(absPath)) {
    return { content: [{ type: 'text', text: `Error: File not found: ${absPath}` }] }
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
  } catch {
    return { content: [{ type: 'text', text: 'Error: Failed to decrypt bundle. Check VAULTER_EXPORT_PASSPHRASE' }] }
  }

  // Determine target key name
  let fullKeyName = targetName || parseKeyName(bundle.keyName).name
  if (isGlobal) {
    fullKeyName = `global:${fullKeyName}`
  }

  const paths = resolveKeyPaths(fullKeyName, projectName)

  // Check if keys already exist
  const existing = keyExists(fullKeyName, projectName)
  if (existing.exists && !force) {
    return { content: [{ type: 'text', text: `Error: Key '${fullKeyName}' already exists. Use force=true to overwrite` }] }
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

  const { scope, name } = parseKeyName(fullKeyName)
  const lines = [
    `✓ Imported key: ${name}${scope === 'global' ? ' (global)' : ''}`
  ]
  if (bundle.privateKey) {
    lines.push(`  Private: ${paths.privateKey}`)
  }
  if (bundle.publicKey) {
    lines.push(`  Public:  ${paths.publicKey}`)
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Handle key rotate
 *
 * Rotates the encryption key:
 * 1. Exports all variables (decrypted)
 * 2. Generates new key
 * 3. Re-encrypts all variables with new key
 * 4. Creates backup of old key
 */
export async function handleKeyRotateCall(
  args: Record<string, unknown>,
  config: VaulterConfig | null,
  createClient: () => Promise<{ connect: () => Promise<void>; disconnect: () => Promise<void>; export: (project: string, env: string, service?: string) => Promise<Record<string, string>>; set: (input: { key: string; value: string; project: string; environment: string; service?: string; metadata?: Record<string, unknown> }) => Promise<unknown> }>
): Promise<ToolResponse> {
  const projectName = getKeyProjectName(args, config)
  const service = args.service as string | undefined
  const keyName = (args.keyName as string) || config?.encryption?.asymmetric?.key_name || 'master'
  const dryRun = args.dryRun as boolean || false

  if (!config) {
    return { content: [{ type: 'text', text: 'Error: No vaulter configuration found. Run vaulter init first.' }] }
  }

  const environments = config.environments || ['dev', 'stg', 'prd']
  const keysDir = getProjectKeysDir(projectName)

  const lines: string[] = []
  lines.push(`Key Rotation for project: ${projectName}`)
  lines.push(`Key name: ${keyName}`)
  lines.push(`Environments: ${environments.join(', ')}`)
  lines.push('')

  // Step 1: Export all variables from all environments
  lines.push('Step 1: Exporting all variables (decrypted)...')

  const exportedData: Map<string, Record<string, string>> = new Map()
  let totalVars = 0

  try {
    const client = await createClient()
    await client.connect()

    for (const env of environments) {
      try {
        const vars = await client.export(projectName, env, service)
        const varCount = Object.keys(vars).length

        if (varCount > 0) {
          exportedData.set(env, vars)
          totalVars += varCount
          lines.push(`  [${env}] Exported ${varCount} variables`)
        }
      } catch (err) {
        lines.push(`  [${env}] Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    await client.disconnect()
  } catch (err) {
    return { content: [{ type: 'text', text: `Error connecting to backend: ${err instanceof Error ? err.message : String(err)}` }] }
  }

  if (totalVars === 0) {
    lines.push('')
    lines.push('No variables found to rotate.')
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  lines.push('')
  lines.push(`Found ${totalVars} variables across ${exportedData.size} environments`)

  if (dryRun) {
    lines.push('')
    lines.push('=== DRY RUN ===')
    lines.push('Would perform the following actions:')
    lines.push('  1. Backup current key')
    lines.push('  2. Generate new encryption key')
    for (const [env, vars] of exportedData) {
      lines.push(`  3. Re-encrypt ${Object.keys(vars).length} variables in ${env}`)
    }
    lines.push('')
    lines.push('Run without dryRun=true to perform the rotation.')
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  // Step 2: Backup and generate new key
  lines.push('')
  lines.push('Step 2: Generating new encryption key...')

  const isAsymmetric = config?.encryption?.mode === 'asymmetric'
  const algorithm = config?.encryption?.asymmetric?.algorithm || 'rsa-4096'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  let oldKeyBackupPath: string

  if (isAsymmetric) {
    const { privateKey: privateKeyPath, publicKey: publicKeyPath } = resolveKeyPaths(keyName, projectName)

    if (!fs.existsSync(privateKeyPath)) {
      return { content: [{ type: 'text', text: `Error: Private key not found: ${privateKeyPath}` }] }
    }

    oldKeyBackupPath = path.join(keysDir, `${keyName}-backup-${timestamp}`)

    // Backup old keys
    fs.mkdirSync(oldKeyBackupPath, { recursive: true })
    fs.copyFileSync(privateKeyPath, path.join(oldKeyBackupPath, `${keyName}.key`))
    fs.copyFileSync(publicKeyPath, path.join(oldKeyBackupPath, `${keyName}.pub`))

    // Generate new key pair
    const { publicKey, privateKey } = generateKeyPair(algorithm as AsymmetricAlgorithm)
    fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 })
    fs.writeFileSync(publicKeyPath, publicKey)

    lines.push(`  Old keys backed up to: ${oldKeyBackupPath}`)
    lines.push(`  New ${algorithm} keys generated`)
  } else {
    const keyFilePath = resolveKeyPath(keyName, projectName, false)
    oldKeyBackupPath = path.join(keysDir, `${keyName}-backup-${timestamp}.key`)

    // Backup old key if exists
    if (fs.existsSync(keyFilePath)) {
      fs.copyFileSync(keyFilePath, oldKeyBackupPath)
    }

    // Generate new passphrase
    const newPassphrase = generatePassphrase()
    fs.mkdirSync(path.dirname(keyFilePath), { recursive: true })
    fs.writeFileSync(keyFilePath, newPassphrase, { mode: 0o600 })

    lines.push(`  Old key backed up to: ${oldKeyBackupPath}`)
    lines.push(`  New symmetric key generated`)
  }

  // Step 3: Re-import all variables with new key
  lines.push('')
  lines.push('Step 3: Re-encrypting all variables with new key...')

  try {
    const newClient = await createClient()
    await newClient.connect()

    let rotatedCount = 0

    for (const [env, vars] of exportedData) {
      for (const [key, value] of Object.entries(vars)) {
        await newClient.set({
          key,
          value,
          project: projectName,
          service,
          environment: env,
          metadata: {
            source: 'rotation',
            rotatedAt: new Date().toISOString()
          }
        })
        rotatedCount++
      }
      lines.push(`  [${env}] Re-encrypted ${Object.keys(vars).length} variables`)
    }

    await newClient.disconnect()

    lines.push('')
    lines.push('✓ Key rotation complete')
    lines.push(`  Variables re-encrypted: ${rotatedCount}`)
    lines.push(`  Environments: ${Array.from(exportedData.keys()).join(', ')}`)
    lines.push(`  Old key backup: ${oldKeyBackupPath}`)
    lines.push('')
    lines.push('Important: The old key backup should be securely deleted after')
    lines.push('verifying the rotation was successful.')
  } catch (err) {
    lines.push('')
    lines.push(`Error during re-encryption: ${err instanceof Error ? err.message : String(err)}`)
    lines.push('')
    lines.push('⚠️ IMPORTANT: Rotation may be incomplete!')
    lines.push(`Restore old key from: ${oldKeyBackupPath}`)
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}
