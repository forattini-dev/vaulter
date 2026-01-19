/**
 * Vaulter CLI - Key Rotate Subcommand
 *
 * Handles encryption key rotation:
 * - Exports all variables (decrypted)
 * - Generates new key
 * - Re-encrypts all variables with new key
 * - Creates backup of old key
 */

import fs from 'node:fs'
import path from 'node:path'
import type { VaulterConfig, AsymmetricAlgorithm, Environment, CLIArgs } from '../../../types.js'
import { generateKeyPair, generatePassphrase } from '../../../lib/crypto.js'
import {
  getProjectKeysDir,
  resolveKeyPath,
  resolveKeyPaths,
  getValidEnvironments
} from '../../../lib/config-loader.js'
import { createClientFromConfig } from '../../lib/create-client.js'
import { createConnectedAuditLogger, disconnectAuditLogger } from '../../lib/audit-helper.js'
import * as ui from '../../ui.js'
import { c, print } from '../../lib/colors.js'

export interface KeyRotateContext {
  args: CLIArgs
  config: VaulterConfig | null
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  getProjectName: () => string
}

/**
 * Run key rotate subcommand
 */
export async function runKeyRotate(context: KeyRotateContext): Promise<void> {
  const { args, config, verbose, dryRun, jsonOutput, getProjectName } = context

  if (!config) {
    print.error('No vaulter configuration found')
    ui.log(`Run "${c.command('vaulter init')}" first`)
    process.exit(1)
  }

  const project = getProjectName()
  const service = args.service || args.s || config?.service
  const environments = getValidEnvironments(config)

  // Validate key configuration
  const keyName = args.name || args.n || config?.encryption?.asymmetric?.key_name || 'master'
  const keysDir = getProjectKeysDir(project)

  ui.verbose(`Key rotation for project: ${project}`, verbose && !jsonOutput)
  ui.verbose(`Key name: ${keyName}`, verbose && !jsonOutput)
  ui.verbose(`Environments: ${environments.join(', ')}`, verbose && !jsonOutput)

  // Step 1: Export all variables from all environments
  if (!jsonOutput) {
    ui.log('Step 1: Exporting all variables (decrypted)...')
  }

  const exportedData: Map<string, Record<string, string>> = new Map()
  const client = await createClientFromConfig({ args, config, project, verbose })

  try {
    await client.connect()

    for (const env of environments) {
      const vars = await client.export(project, env as Environment, service)
      const varCount = Object.keys(vars).length

      if (varCount > 0) {
        exportedData.set(env, vars)
        ui.verbose(`  [${env}] Exported ${varCount} variables`, verbose && !jsonOutput)
      }
    }
  } finally {
    await client.disconnect()
  }

  const totalVars = Array.from(exportedData.values()).reduce(
    (sum, vars) => sum + Object.keys(vars).length,
    0
  )

  if (totalVars === 0) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        message: 'No variables to rotate',
        rotated: 0
      }))
    } else {
      ui.log('No variables found to rotate.')
    }
    return
  }

  if (!jsonOutput) {
    ui.log(`  Found ${totalVars} variables across ${exportedData.size} environments`)
  }

  // Step 2: Generate new key
  if (!jsonOutput) {
    ui.log('')
    ui.log('Step 2: Generating new encryption key...')
  }

  const isAsymmetric = config?.encryption?.mode === 'asymmetric'
  const algorithm = config?.encryption?.asymmetric?.algorithm || 'rsa-4096'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  let oldKeyBackupPath: string

  if (isAsymmetric) {
    // Asymmetric key rotation
    const { privateKey: privateKeyPath, publicKey: publicKeyPath } = resolveKeyPaths(keyName, project)

    if (!fs.existsSync(privateKeyPath)) {
      print.error(`Private key not found: ${privateKeyPath}`)
      process.exit(1)
    }

    oldKeyBackupPath = path.join(keysDir, `${keyName}-backup-${timestamp}`)

    if (!dryRun) {
      // Backup old keys
      fs.mkdirSync(oldKeyBackupPath, { recursive: true })
      fs.copyFileSync(privateKeyPath, path.join(oldKeyBackupPath, `${keyName}.key`))
      fs.copyFileSync(publicKeyPath, path.join(oldKeyBackupPath, `${keyName}.pub`))

      // Generate new key pair
      const { publicKey, privateKey } = generateKeyPair(algorithm as AsymmetricAlgorithm)
      fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 })
      fs.writeFileSync(publicKeyPath, publicKey)

      ui.verbose(`  Old keys backed up to: ${oldKeyBackupPath}`, verbose && !jsonOutput)
      ui.verbose(`  New keys generated: ${keyName}`, verbose && !jsonOutput)
    }
  } else {
    // Symmetric key rotation - use the key file path directly
    const keyFilePath = resolveKeyPath(keyName, project, false)

    oldKeyBackupPath = path.join(keysDir, `${keyName}-backup-${timestamp}.key`)

    if (!dryRun) {
      // Backup old key if exists
      if (fs.existsSync(keyFilePath)) {
        fs.copyFileSync(keyFilePath, oldKeyBackupPath)
      }

      // Generate new passphrase
      const newPassphrase = generatePassphrase()
      fs.mkdirSync(path.dirname(keyFilePath), { recursive: true })
      fs.writeFileSync(keyFilePath, newPassphrase, { mode: 0o600 })

      ui.verbose(`  Old key backed up to: ${oldKeyBackupPath}`, verbose && !jsonOutput)
      ui.verbose(`  New key generated: ${keyFilePath}`, verbose && !jsonOutput)
    }
  }

  if (!jsonOutput) {
    ui.log('  New key generated successfully')
  }

  // Step 3: Re-import all variables with new key
  if (!jsonOutput) {
    ui.log('')
    ui.log('Step 3: Re-encrypting all variables with new key...')
  }

  if (dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        dryRun: true,
        project,
        keyName,
        environments: Array.from(exportedData.keys()),
        totalVariables: totalVars,
        message: 'Would rotate key and re-encrypt all variables'
      }))
    } else {
      ui.log('')
      ui.log('Dry run - changes that would be made:')
      for (const [env, vars] of exportedData) {
        ui.log(`  [${env}] Re-encrypt ${Object.keys(vars).length} variables`)
      }
      ui.log('')
      ui.log('Run without --dry-run to perform the rotation.')
    }
    return
  }

  // Create new client with new key for re-import
  const newClient = await createClientFromConfig({ args, config, project, verbose })
  const auditLogger = await createConnectedAuditLogger(config, verbose)

  try {
    await newClient.connect()

    let rotatedCount = 0

    for (const [env, vars] of exportedData) {
      for (const [key, value] of Object.entries(vars)) {
        await newClient.set({
          key,
          value,
          project,
          service,
          environment: env as Environment,
          metadata: {
            source: 'rotation',
            rotatedAt: new Date().toISOString()
          }
        })
        rotatedCount++
      }

      ui.verbose(`  [${env}] Re-encrypted ${Object.keys(vars).length} variables`, verbose && !jsonOutput)
    }

    // Log rotation to audit
    if (auditLogger) {
      try {
        await auditLogger.log({
          operation: 'rotate',
          key: '*',
          project,
          environment: 'all' as Environment,
          service,
          source: 'cli',
          metadata: {
            keyName,
            keyType: isAsymmetric ? 'asymmetric' : 'symmetric',
            environments: Array.from(exportedData.keys()),
            variablesRotated: rotatedCount,
            backupPath: oldKeyBackupPath
          }
        })
      } catch {
        // Ignore audit errors
      }
    }

    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: true,
        project,
        keyName,
        keyType: isAsymmetric ? 'asymmetric' : 'symmetric',
        environments: Array.from(exportedData.keys()),
        rotated: rotatedCount,
        backupPath: oldKeyBackupPath
      }))
    } else {
      ui.log('')
      ui.success('Key rotation complete')
      ui.log(`  Variables re-encrypted: ${rotatedCount}`)
      ui.log(`  Environments: ${Array.from(exportedData.keys()).join(', ')}`)
      ui.log(`  Old key backup: ${oldKeyBackupPath}`)
      ui.log('')
      ui.log('Important: The old key backup should be securely deleted after')
      ui.log('verifying the rotation was successful.')
    }
  } finally {
    await newClient.disconnect()
    await disconnectAuditLogger(auditLogger)
  }
}
