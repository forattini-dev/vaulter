/**
 * MiniEnv CLI - Key Management Commands
 *
 * Generate and manage encryption keys
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, MiniEnvConfig } from '../../types.js'
import { findConfigDir } from '../../lib/config-loader.js'

interface KeyContext {
  args: CLIArgs
  config: MiniEnvConfig | null
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

/**
 * Generate a new AES-256 encryption key
 */
function generateKey(): string {
  // Generate 32 bytes (256 bits) for AES-256
  const key = crypto.randomBytes(32)
  return key.toString('base64')
}

/**
 * Run the key command
 */
export async function runKey(context: KeyContext): Promise<void> {
  const { args, config, verbose, dryRun, jsonOutput } = context

  const subcommand = args._[1]

  switch (subcommand) {
    case 'generate':
    case 'gen':
      await runKeyGenerate(context)
      break

    case 'show':
      await runKeyShow(context)
      break

    case 'rotate':
      await runKeyRotate(context)
      break

    default:
      console.error(`Unknown key subcommand: ${subcommand || '(none)'}`)
      console.error('Available subcommands: generate, show, rotate')
      console.error('')
      console.error('Examples:')
      console.error('  minienv key generate              # Generate new key to stdout')
      console.error('  minienv key generate -o .key      # Generate key to file')
      console.error('  minienv key show                  # Show current key source')
      process.exit(1)
  }
}

/**
 * Generate a new encryption key
 */
async function runKeyGenerate(context: KeyContext): Promise<void> {
  const { args, verbose, dryRun, jsonOutput } = context

  const outputPath = args.output || args.o

  if (verbose) {
    console.error('Generating new AES-256 encryption key...')
  }

  const key = generateKey()

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        dryRun: true,
        action: 'generate_key',
        outputPath: outputPath || 'stdout',
        keyLength: 32,
        algorithm: 'aes-256-gcm'
      }))
    } else {
      console.log('Dry run - would generate new encryption key')
      if (outputPath) {
        console.log(`  Output: ${outputPath}`)
      } else {
        console.log('  Output: stdout')
      }
    }
    return
  }

  if (outputPath) {
    // Write to file
    const absPath = path.resolve(outputPath)

    // Check if file exists
    if (fs.existsSync(absPath) && !args.force) {
      console.error(`Error: File exists: ${absPath}`)
      console.error('Use --force to overwrite')
      process.exit(1)
    }

    // Ensure directory exists
    const dir = path.dirname(absPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Write key with restricted permissions
    fs.writeFileSync(absPath, key + '\n', { mode: 0o600 })

    if (jsonOutput) {
      console.log(JSON.stringify({
        success: true,
        outputPath: absPath,
        keyLength: 32,
        algorithm: 'aes-256-gcm'
      }))
    } else {
      console.log(`✓ Generated encryption key: ${absPath}`)
      console.log('  Store this key securely - it cannot be recovered!')
      console.log('')
      console.log('To use this key:')
      console.log(`  1. Set environment variable: export MINIENV_KEY=$(cat ${absPath})`)
      console.log(`  2. Or configure in .minienv/config.yaml:`)
      console.log(`     encryption:`)
      console.log(`       key_source:`)
      console.log(`         - file: ${outputPath}`)
    }
  } else {
    // Output to stdout (for piping)
    if (jsonOutput) {
      console.log(JSON.stringify({
        key,
        keyLength: 32,
        algorithm: 'aes-256-gcm'
      }))
    } else {
      console.log(key)
    }
  }
}

/**
 * Show current key configuration
 */
async function runKeyShow(context: KeyContext): Promise<void> {
  const { config, jsonOutput } = context

  if (!config) {
    console.error('Error: No minienv configuration found')
    console.error('Run "minienv init" first')
    process.exit(1)
  }

  const keySources = config.encryption?.key_source || []

  // Check each source
  const sources: Array<{ type: string; source: string; available: boolean }> = []

  for (const source of keySources) {
    if ('env' in source) {
      sources.push({
        type: 'env',
        source: source.env,
        available: !!process.env[source.env]
      })
    } else if ('file' in source) {
      sources.push({
        type: 'file',
        source: source.file,
        available: fs.existsSync(path.resolve(source.file))
      })
    } else if ('s3' in source) {
      sources.push({
        type: 's3',
        source: source.s3,
        available: false // Would need to check S3
      })
    }
  }

  // Also check MINIENV_KEY env var
  if (!sources.some(s => s.type === 'env' && s.source === 'MINIENV_KEY')) {
    sources.push({
      type: 'env',
      source: 'MINIENV_KEY',
      available: !!process.env.MINIENV_KEY
    })
  }

  if (jsonOutput) {
    console.log(JSON.stringify({
      configured: keySources.length > 0,
      sources,
      activeSource: sources.find(s => s.available)?.source || null
    }))
  } else {
    console.log('Key Sources:')
    if (sources.length === 0) {
      console.log('  (none configured)')
    } else {
      for (const source of sources) {
        const status = source.available ? '✓' : '✗'
        console.log(`  ${status} ${source.type}: ${source.source}`)
      }
    }

    const active = sources.find(s => s.available)
    if (active) {
      console.log('')
      console.log(`Active key source: ${active.type}:${active.source}`)
    } else {
      console.log('')
      console.log('Warning: No encryption key available')
      console.log('Run "minienv key generate -o .minienv/.key" to create one')
    }
  }
}

/**
 * Rotate encryption key (re-encrypt all values with new key)
 */
async function runKeyRotate(context: KeyContext): Promise<void> {
  const { config, dryRun, jsonOutput } = context

  if (!config) {
    console.error('Error: No minienv configuration found')
    console.error('Run "minienv init" first')
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
    console.log('   minienv key generate -o .minienv/.key.new')
    console.log('')
    console.log('2. Export current values (with old key):')
    console.log('   minienv export -e <env> > vars.env')
    console.log('')
    console.log('3. Update to new key:')
    console.log('   mv .minienv/.key.new .minienv/.key')
    console.log('')
    console.log('4. Re-import values (with new key):')
    console.log('   cat vars.env | minienv sync -e <env>')
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
