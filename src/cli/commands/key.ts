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
  parseKeyName
} from '../../lib/config-loader.js'

interface KeyContext {
  args: CLIArgs
  config: VaulterConfig | null
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

/**
 * Get project name from config or args, with fallback
 */
function getProjectName(context: KeyContext): string {
  return context.args.project || context.args.p || context.config?.project || 'default'
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

    case 'list':
    case 'ls':
      await runKeyList(context)
      break

    case 'show':
      await runKeyShow(context)
      break

    case 'rotate':
      await runKeyRotate(context)
      break

    default:
      printKeyHelp(subcommand)
      process.exit(1)
  }
}

function printKeyHelp(subcommand?: string): void {
  if (subcommand) {
    console.error(`Unknown key subcommand: ${subcommand}`)
  }
  console.error('Available subcommands: generate, export, import, list, show, rotate')
  console.error('')
  console.error('Generate keys:')
  console.error('  vaulter key generate --name master              # Symmetric key (default)')
  console.error('  vaulter key generate --name master --asymmetric # RSA-4096 key pair')
  console.error('  vaulter key generate --name master --asym --alg ec-p256')
  console.error('  vaulter key generate --name shared --global     # Global key')
  console.error('')
  console.error('Export/Import keys:')
  console.error('  vaulter key export --name master -o keys.enc    # Export encrypted bundle')
  console.error('  vaulter key import -f keys.enc                  # Import from bundle')
  console.error('')
  console.error('List and show:')
  console.error('  vaulter key list                                # List all keys')
  console.error('  vaulter key show --name master                  # Show key info')
  console.error('')
  console.error('Options:')
  console.error('  --name <name>              Key name (required for generate)')
  console.error('  --global                   Use global scope instead of project')
  console.error('  --asymmetric, --asym       Generate asymmetric key pair')
  console.error('  --algorithm, --alg <alg>   Algorithm: rsa-4096 (default), rsa-2048, ec-p256, ec-p384')
  console.error('  -o, --output <path>        Output file for export')
  console.error('  -f, --file <path>          Input file for import')
  console.error('  --force                    Overwrite existing keys')
}

/**
 * Generate a new encryption key
 */
async function runKeyGenerate(context: KeyContext): Promise<void> {
  const { args } = context

  const keyName = args.name
  const isGlobal = args.global
  const isAsymmetric = args.asymmetric || args.asym
  const algorithmArg = (args.algorithm || args.alg || 'rsa-4096') as AsymmetricAlgorithm

  // Validate key name is provided
  if (!keyName) {
    console.error('Error: --name is required')
    console.error('Example: vaulter key generate --name master')
    process.exit(1)
  }

  // Validate algorithm if asymmetric
  const validAlgorithms: AsymmetricAlgorithm[] = ['rsa-4096', 'rsa-2048', 'ec-p256', 'ec-p384']
  if (isAsymmetric && !validAlgorithms.includes(algorithmArg)) {
    console.error(`Error: Invalid algorithm: ${algorithmArg}`)
    console.error(`Valid algorithms: ${validAlgorithms.join(', ')}`)
    process.exit(1)
  }

  const projectName = getProjectName(context)
  const fullKeyName = isGlobal ? `global:${keyName}` : keyName

  // Check if key already exists
  const existing = keyExists(fullKeyName, projectName)
  if (existing.exists && !args.force) {
    console.error(`Error: Key '${keyName}' already exists${isGlobal ? ' (global)' : ''}`)
    console.error('Use --force to overwrite')
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

  if (verbose) {
    console.error('Generating new AES-256 symmetric key...')
    console.error(`  Path: ${keyPath}`)
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        dryRun: true,
        action: 'generate_key',
        mode: 'symmetric',
        keyName,
        outputPath: keyPath,
        algorithm: 'aes-256-gcm'
      }))
    } else {
      console.log(`Dry run - would generate symmetric key: ${keyPath}`)
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
    console.log(JSON.stringify({
      success: true,
      mode: 'symmetric',
      keyName,
      outputPath: keyPath,
      algorithm: 'aes-256-gcm'
    }))
  } else {
    const { scope, name } = parseKeyName(keyName)
    console.log(`✓ Generated symmetric key: ${name}${scope === 'global' ? ' (global)' : ''}`)
    console.log(`  Path: ${keyPath}`)
    console.log('')
    console.log('To use this key in config.yaml:')
    console.log('  encryption:')
    console.log('    mode: symmetric')
    console.log('    key_source:')
    console.log(`      - file: ${keyPath}`)
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

  if (verbose) {
    console.error(`Generating new ${algorithm} key pair...`)
    console.error(`  Private: ${paths.privateKey}`)
    console.error(`  Public:  ${paths.publicKey}`)
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        dryRun: true,
        action: 'generate_keypair',
        mode: 'asymmetric',
        keyName,
        algorithm,
        privateKeyPath: paths.privateKey,
        publicKeyPath: paths.publicKey
      }))
    } else {
      console.log(`Dry run - would generate ${algorithm} key pair:`)
      console.log(`  Private: ${paths.privateKey}`)
      console.log(`  Public:  ${paths.publicKey}`)
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
    console.log(JSON.stringify({
      success: true,
      mode: 'asymmetric',
      keyName,
      algorithm,
      privateKeyPath: paths.privateKey,
      publicKeyPath: paths.publicKey
    }))
  } else {
    const { scope, name } = parseKeyName(keyName)
    console.log(`✓ Generated ${algorithm} key pair: ${name}${scope === 'global' ? ' (global)' : ''}`)
    console.log(`  Private: ${paths.privateKey} (mode 600 - keep secret!)`)
    console.log(`  Public:  ${paths.publicKey} (mode 644)`)
    console.log('')
    console.log('To use these keys in config.yaml:')
    console.log('  encryption:')
    console.log('    mode: asymmetric')
    console.log('    asymmetric:')
    console.log(`      algorithm: ${algorithm}`)
    console.log(`      key_name: ${scope === 'global' ? 'global:' : ''}${name}`)
  }
}

/**
 * Export keys to an encrypted bundle
 */
async function runKeyExport(context: KeyContext): Promise<void> {
  const { args, verbose, dryRun, jsonOutput } = context

  const keyName = args.name
  const outputPath = args.output || args.o
  const isGlobal = args.global

  if (!keyName) {
    console.error('Error: --name is required')
    console.error('Example: vaulter key export --name master -o keys.enc')
    process.exit(1)
  }

  if (!outputPath) {
    console.error('Error: -o/--output is required')
    console.error('Example: vaulter key export --name master -o keys.enc')
    process.exit(1)
  }

  const projectName = getProjectName(context)
  const fullKeyName = isGlobal ? `global:${keyName}` : keyName
  const paths = resolveKeyPaths(fullKeyName, projectName)

  // Check if keys exist
  const existing = keyExists(fullKeyName, projectName)
  if (!existing.exists) {
    console.error(`Error: Key '${keyName}' not found${isGlobal ? ' (global)' : ''}`)
    process.exit(1)
  }

  if (verbose) {
    console.error(`Exporting key: ${keyName}`)
    console.error(`  Private: ${existing.privateKey ? 'found' : 'not found'}`)
    console.error(`  Public:  ${existing.publicKey ? 'found' : 'not found'}`)
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        dryRun: true,
        action: 'export_key',
        keyName: fullKeyName,
        outputPath,
        hasPrivateKey: existing.privateKey,
        hasPublicKey: existing.publicKey
      }))
    } else {
      console.log(`Dry run - would export key '${keyName}' to ${outputPath}`)
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
    console.log(JSON.stringify({
      success: true,
      action: 'export_key',
      keyName: fullKeyName,
      outputPath: absPath,
      hasPrivateKey: existing.privateKey,
      hasPublicKey: existing.publicKey
    }))
  } else {
    console.log(`✓ Exported key '${keyName}' to ${absPath}`)
    console.log('')
    console.log('To import on another machine:')
    console.log(`  vaulter key import -f ${outputPath}`)
    if (process.env.VAULTER_EXPORT_PASSPHRASE) {
      console.log('')
      console.log('Note: Set VAULTER_EXPORT_PASSPHRASE to the same value when importing')
    }
  }
}

/**
 * Import keys from an encrypted bundle
 */
async function runKeyImport(context: KeyContext): Promise<void> {
  const { args, verbose, dryRun, jsonOutput } = context

  const inputPath = args.file || args.f
  const isGlobal = args.global

  if (!inputPath) {
    console.error('Error: -f/--file is required')
    console.error('Example: vaulter key import -f keys.enc')
    process.exit(1)
  }

  const absPath = path.resolve(inputPath)
  if (!fs.existsSync(absPath)) {
    console.error(`Error: File not found: ${absPath}`)
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
    console.error('Error: Failed to decrypt bundle')
    console.error('  Check that VAULTER_EXPORT_PASSPHRASE is correct')
    process.exit(1)
  }

  if (verbose) {
    console.error('Bundle contents:')
    console.error(`  Key name: ${bundle.keyName}`)
    console.error(`  Project: ${bundle.projectName}`)
    console.error(`  Algorithm: ${bundle.algorithm || 'symmetric'}`)
    console.error(`  Has private key: ${!!bundle.privateKey}`)
    console.error(`  Has public key: ${!!bundle.publicKey}`)
  }

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
    console.error(`Error: Key '${targetKeyName}' already exists`)
    console.error('Use --force to overwrite')
    process.exit(1)
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
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
      console.log(`Dry run - would import key '${targetKeyName}'`)
      console.log(`  Private: ${paths.privateKey}`)
      console.log(`  Public:  ${paths.publicKey}`)
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
    console.log(JSON.stringify({
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
    console.log(`✓ Imported key: ${name}${scope === 'global' ? ' (global)' : ''}`)
    if (bundle.privateKey) {
      console.log(`  Private: ${paths.privateKey}`)
    }
    if (bundle.publicKey) {
      console.log(`  Public:  ${paths.publicKey}`)
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
    console.log(JSON.stringify({ keys, projectName, projectKeysDir, globalKeysDir }))
  } else {
    console.log(`Keys for project: ${projectName}`)
    console.log(`  Project keys: ${projectKeysDir}`)
    console.log(`  Global keys:  ${globalKeysDir}`)
    console.log('')

    if (keys.length === 0) {
      console.log('No keys found')
      console.log('')
      console.log('Generate a new key:')
      console.log('  vaulter key generate --name master --asymmetric')
    } else {
      for (const key of keys) {
        const scopeLabel = key.scope === 'global' ? ' (global)' : ''
        const typeLabel = key.type === 'asymmetric' ? ` [${key.algorithm || 'asymmetric'}]` : ' [symmetric]'
        const privLabel = key.hasPrivateKey ? '✓' : '✗'
        const pubLabel = key.hasPublicKey ? '✓' : '✗'
        console.log(`  ${key.name}${scopeLabel}${typeLabel}`)
        console.log(`    Private: ${privLabel}  Public: ${pubLabel}`)
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
      console.error(`Error: Key '${keyName}' not found${isGlobal ? ' (global)' : ''}`)
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
      console.log(JSON.stringify({
        keyName: fullKeyName,
        algorithm,
        hasPrivateKey: existing.privateKey,
        hasPublicKey: existing.publicKey,
        privateKeyPath: existing.privateKey ? paths.privateKey : null,
        publicKeyPath: existing.publicKey ? paths.publicKey : null
      }))
    } else {
      const { scope, name } = parseKeyName(fullKeyName)
      console.log(`Key: ${name}${scope === 'global' ? ' (global)' : ''}`)
      console.log(`  Algorithm: ${algorithm || 'symmetric'}`)
      console.log(`  Private key: ${existing.privateKey ? paths.privateKey : '(not found)'}`)
      console.log(`  Public key:  ${existing.publicKey ? paths.publicKey : '(not found)'}`)
    }
    return
  }

  // Show config info
  if (!config) {
    console.error('Error: No vaulter configuration found')
    console.error('Run "vaulter init" first')
    process.exit(1)
  }

  const encryptionConfig = config.encryption || {}
  const mode = encryptionConfig.mode || 'symmetric'

  if (jsonOutput) {
    console.log(JSON.stringify({
      mode,
      keyName: encryptionConfig.asymmetric?.key_name || null,
      algorithm: encryptionConfig.asymmetric?.algorithm || null,
      keySources: encryptionConfig.key_source || [],
      asymmetricConfig: encryptionConfig.asymmetric || null
    }))
  } else {
    console.log('Encryption Configuration:')
    console.log(`  Mode: ${mode}`)

    if (mode === 'asymmetric' && encryptionConfig.asymmetric) {
      const asymConfig = encryptionConfig.asymmetric
      console.log(`  Algorithm: ${asymConfig.algorithm || 'rsa-4096'}`)
      if (asymConfig.key_name) {
        console.log(`  Key name: ${asymConfig.key_name}`)
        const existing = keyExists(asymConfig.key_name, projectName)
        console.log(`    Private: ${existing.privateKey ? '✓' : '✗'}  Public: ${existing.publicKey ? '✓' : '✗'}`)
      }
    }

    if (encryptionConfig.key_source && encryptionConfig.key_source.length > 0) {
      console.log('  Key sources:')
      for (const source of encryptionConfig.key_source) {
        if ('env' in source) {
          const available = !!process.env[source.env]
          console.log(`    ${available ? '✓' : '✗'} env: ${source.env}`)
        } else if ('file' in source) {
          const available = fs.existsSync(path.resolve(source.file))
          console.log(`    ${available ? '✓' : '✗'} file: ${source.file}`)
        } else if ('s3' in source) {
          console.log(`    ? s3: ${source.s3}`)
        }
      }
    }
  }
}

/**
 * Rotate encryption key (re-encrypt all values with new key)
 */
async function runKeyRotate(context: KeyContext): Promise<void> {
  const { config, dryRun, jsonOutput } = context

  if (!config) {
    console.error('Error: No vaulter configuration found')
    console.error('Run "vaulter init" first')
    process.exit(1)
  }

  // Key rotation is a complex operation that would need to:
  // 1. Generate new key
  // 2. Decrypt all values with old key
  // 3. Re-encrypt all values with new key
  // 4. Update key storage

  // For now, show a message about manual rotation
  if (jsonOutput) {
    console.log(JSON.stringify({
      error: 'not_implemented',
      message: 'Key rotation is not yet fully automated'
    }))
  } else {
    console.log('Key rotation steps:')
    console.log('')
    console.log('1. Generate a new key:')
    console.log('   vaulter key generate --name master-new --asymmetric')
    console.log('')
    console.log('2. Export current values (with old key):')
    console.log('   vaulter export -e <env> > vars.env')
    console.log('')
    console.log('3. Update config to use new key:')
    console.log('   # Edit .vaulter/config.yaml')
    console.log('   # Change key_name: master to key_name: master-new')
    console.log('')
    console.log('4. Re-import values (with new key):')
    console.log('   cat vars.env | vaulter sync -e <env>')
    console.log('')
    console.log('5. Clean up:')
    console.log('   rm vars.env')
    console.log('')
    console.log('Note: Repeat steps 2-4 for each environment.')

    if (dryRun) {
      console.log('')
      console.log('(dry-run mode - no changes made)')
    }
  }
}
