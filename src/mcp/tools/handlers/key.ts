/**
 * vaulter_key handler — generate | list | show | export | import | rotate
 *
 * Port of keys.ts with action-based dispatch.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { HandlerContext } from '../index.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse, getClientForEnvironment, clearClientCache } from '../config.js'
import {
  getProjectKeysDir,
  getGlobalKeysDir,
  resolveKeyPath,
  resolveKeyPaths,
  keyExists,
  parseKeyName
} from '../../../lib/config-loader.js'
import { generateKeyPair, generatePassphrase, detectAlgorithm } from '../../../lib/crypto.js'
import { DEFAULT_ENVIRONMENTS } from '../../../types.js'
import type { AsymmetricAlgorithm } from '../../../types.js'

function getKeyProjectName(args: Record<string, unknown>, ctx: HandlerContext): string {
  return (args.project as string) || ctx.config?.project || ctx.project || 'default'
}

export async function handleKey(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const action = args.action as string

  switch (action) {
    case 'generate':
      return handleGenerate(ctx, args)
    case 'list':
      return handleList(ctx, args)
    case 'show':
      return handleShow(ctx, args)
    case 'export':
      return handleExportKey(ctx, args)
    case 'import':
      return handleImportKey(ctx, args)
    case 'rotate':
      return handleRotate(ctx, args)
    default:
      return errorResponse(`Unknown action: ${action}. Valid: generate, list, show, export, import, rotate`)
  }
}

function handleGenerate(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  const keyName = args.name as string | undefined
  const environment = args.environment as string | undefined
  const isGlobal = args.global === true
  const isAsymmetric = args.asymmetric === true
  const algorithm = (args.algorithm as AsymmetricAlgorithm) || 'rsa-4096'
  const force = args.force === true
  const projectName = getKeyProjectName(args, ctx)

  if (!keyName && !environment) {
    return errorResponse('name or environment is required')
  }

  const effectiveKeyName = keyName || environment || 'master'
  const fullKeyName = isGlobal ? `global:${effectiveKeyName}` : effectiveKeyName

  const existing = keyExists(fullKeyName, projectName)
  if (existing.exists && !force) {
    return errorResponse(`Key '${effectiveKeyName}' already exists${isGlobal ? ' (global)' : ''}. Use force=true to overwrite`)
  }

  if (isAsymmetric) {
    const paths = resolveKeyPaths(fullKeyName, projectName)
    const keyPair = generateKeyPair(algorithm)
    const dir = path.dirname(paths.privateKey)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(paths.privateKey, keyPair.privateKey, { mode: 0o600 })
    fs.writeFileSync(paths.publicKey, keyPair.publicKey, { mode: 0o644 })
    const { name } = parseKeyName(fullKeyName)
    return textResponse(`✓ Generated ${algorithm} key pair: ${name}${isGlobal ? ' (global)' : ''}\n  Private: ${paths.privateKey}\n  Public:  ${paths.publicKey}`)
  }

  const keyPath = resolveKeyPath(fullKeyName, projectName, false)
  const key = generatePassphrase(32)
  const dir = path.dirname(keyPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(keyPath, key + '\n', { mode: 0o600 })
  const { name } = parseKeyName(fullKeyName)
  return textResponse(`✓ Generated symmetric key: ${name}${isGlobal ? ' (global)' : ''}\n  Path: ${keyPath}`)
}

function handleList(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  const projectName = getKeyProjectName(args, ctx)
  const projectKeysDir = getProjectKeysDir(projectName)
  const globalKeysDir = getGlobalKeysDir()

  const keys: Array<{ name: string; scope: string; type: string; algorithm?: string }> = []

  for (const [dir, scope] of [[projectKeysDir, 'project'], [globalKeysDir, 'global']] as const) {
    if (!fs.existsSync(dir)) continue
    const keyNames = new Set<string>()
    for (const file of fs.readdirSync(dir)) keyNames.add(file.replace(/\.pub$/, ''))

    for (const name of keyNames) {
      const pubPath = path.join(dir, name + '.pub')
      const privPath = path.join(dir, name)
      const hasPublicKey = fs.existsSync(pubPath)
      let type = 'symmetric'
      let algorithm: string | undefined

      if (hasPublicKey) {
        type = 'asymmetric'
        algorithm = detectAlgorithm(fs.readFileSync(pubPath, 'utf-8')) || undefined
      } else if (fs.existsSync(privPath) && fs.statSync(privPath).isFile()) {
        const content = fs.readFileSync(privPath, 'utf-8')
        if (content.includes('BEGIN') && content.includes('KEY')) {
          type = 'asymmetric'
          algorithm = detectAlgorithm(content) || undefined
        }
      }

      keys.push({ name, scope, type, algorithm })
    }
  }

  const lines = [`Keys for project: ${projectName}`, '']
  if (keys.length === 0) {
    lines.push('No keys found. Generate with: vaulter_key({ action: "generate", name: "master" })')
  } else {
    for (const key of keys) {
      const scopeLabel = key.scope === 'global' ? ' (global)' : ''
      const typeLabel = key.type === 'asymmetric' ? ` [${key.algorithm || 'asymmetric'}]` : ' [symmetric]'
      lines.push(`  ${key.name}${scopeLabel}${typeLabel}`)
    }
  }

  return textResponse(lines.join('\n'))
}

function handleShow(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  const keyName = args.name as string
  if (!keyName) return errorResponse('name is required')

  const isGlobal = args.global === true
  const projectName = getKeyProjectName(args, ctx)
  const fullKeyName = isGlobal ? `global:${keyName}` : keyName
  const paths = resolveKeyPaths(fullKeyName, projectName)
  const existing = keyExists(fullKeyName, projectName)

  if (!existing.exists) {
    return errorResponse(`Key '${keyName}' not found${isGlobal ? ' (global)' : ''}`)
  }

  let algorithm: string | null = null
  if (existing.publicKey) algorithm = detectAlgorithm(fs.readFileSync(paths.publicKey, 'utf-8'))
  else if (existing.privateKey) algorithm = detectAlgorithm(fs.readFileSync(paths.privateKey, 'utf-8'))

  return textResponse([
    `Key: ${keyName}${isGlobal ? ' (global)' : ''}`,
    `  Algorithm: ${algorithm || 'symmetric'}`,
    `  Private key: ${existing.privateKey ? paths.privateKey : '(not found)'}`,
    `  Public key:  ${existing.publicKey ? paths.publicKey : '(not found)'}`
  ].join('\n'))
}

function handleExportKey(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  const keyName = args.name as string
  const outputPath = args.output as string
  if (!keyName) return errorResponse('name is required')
  if (!outputPath) return errorResponse('output path is required')

  const isGlobal = args.global === true
  const projectName = getKeyProjectName(args, ctx)
  const fullKeyName = isGlobal ? `global:${keyName}` : keyName
  const paths = resolveKeyPaths(fullKeyName, projectName)
  const existing = keyExists(fullKeyName, projectName)

  if (!existing.exists) return errorResponse(`Key '${keyName}' not found`)

  const bundle: Record<string, unknown> = {
    version: 1, keyName: fullKeyName, projectName, createdAt: new Date().toISOString()
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
    if (!bundle.algorithm) { const alg = detectAlgorithm(content); if (alg) bundle.algorithm = alg }
  }

  const passphrase = process.env.VAULTER_EXPORT_PASSPHRASE || 'vaulter-export-key'
  const salt = crypto.randomBytes(16)
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const output = Buffer.concat([salt, iv, authTag, encrypted])

  const absPath = path.resolve(outputPath)
  fs.writeFileSync(absPath, output)

  return textResponse(`✓ Exported key '${keyName}' to ${absPath}`)
}

function handleImportKey(ctx: HandlerContext, args: Record<string, unknown>): ToolResponse {
  const inputPath = args.file as string
  if (!inputPath) return errorResponse('file path is required')

  const targetName = args.name as string | undefined
  const isGlobal = args.global === true
  const force = args.force === true
  const projectName = getKeyProjectName(args, ctx)

  const absPath = path.resolve(inputPath)
  if (!fs.existsSync(absPath)) return errorResponse(`File not found: ${absPath}`)

  const input = fs.readFileSync(absPath)
  const salt = input.subarray(0, 16)
  const iv = input.subarray(16, 28)
  const authTag = input.subarray(28, 44)
  const encrypted = input.subarray(44)

  const passphrase = process.env.VAULTER_EXPORT_PASSPHRASE || 'vaulter-export-key'
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256')

  let bundle: Record<string, unknown>
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    bundle = JSON.parse(decrypted.toString('utf8'))
  } catch {
    return errorResponse('Failed to decrypt bundle. Check VAULTER_EXPORT_PASSPHRASE')
  }

  let fullKeyName = targetName || parseKeyName(bundle.keyName as string).name
  if (isGlobal) fullKeyName = `global:${fullKeyName}`

  const paths = resolveKeyPaths(fullKeyName, projectName)
  const existing = keyExists(fullKeyName, projectName)
  if (existing.exists && !force) return errorResponse(`Key '${fullKeyName}' already exists. Use force=true to overwrite`)

  const dir = path.dirname(paths.privateKey)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  if (bundle.privateKey) fs.writeFileSync(paths.privateKey, bundle.privateKey as string, { mode: 0o600 })
  if (bundle.publicKey) fs.writeFileSync(paths.publicKey, bundle.publicKey as string, { mode: 0o644 })

  const { name } = parseKeyName(fullKeyName)
  return textResponse(`✓ Imported key: ${name}${isGlobal ? ' (global)' : ''}`)
}

async function handleRotate(ctx: HandlerContext, args: Record<string, unknown>): Promise<ToolResponse> {
  const projectName = getKeyProjectName(args, ctx)
  const service = args.service as string | undefined
  const keyName = (args.name as string) || ctx.config?.encryption?.asymmetric?.key_name || 'master'
  const dryRun = args.dryRun === true

  if (!ctx.config) return errorResponse('No vaulter configuration found. Run vaulter init first.')

  const environments = ctx.config.environments || DEFAULT_ENVIRONMENTS
  const keysDir = getProjectKeysDir(projectName)
  const lines: string[] = [`Key Rotation: ${projectName}`, `Key: ${keyName}`, `Environments: ${environments.join(', ')}`, '']

  // Step 1: Export all vars
  lines.push('Step 1: Exporting all variables...')
  const exportedData = new Map<string, Record<string, string>>()
  let totalVars = 0

  for (const env of environments) {
    try {
      const envClient = await getClientForEnvironment(env, { config: ctx.config, connectionStrings: ctx.connectionStrings, project: projectName })
      await envClient.connect()
      try {
        const vars = await envClient.export(projectName, env, service)
        const count = Object.keys(vars).length
        if (count > 0) { exportedData.set(env, vars); totalVars += count; lines.push(`  [${env}] ${count} variables`) }
      } finally { await envClient.disconnect() }
    } catch (err) { lines.push(`  [${env}] Error: ${(err as Error).message}`) }
  }

  if (totalVars === 0) { lines.push('', 'No variables found.'); return textResponse(lines.join('\n')) }

  if (dryRun) {
    lines.push('', '=== DRY RUN ===', `Would rotate key and re-encrypt ${totalVars} variables.`)
    return textResponse(lines.join('\n'))
  }

  // Step 2: Generate new key
  lines.push('', 'Step 2: Generating new key...')
  const isAsymmetric = ctx.config.encryption?.mode === 'asymmetric'
  const algorithm = ctx.config.encryption?.asymmetric?.algorithm || 'rsa-4096'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  let oldKeyBackupPath: string

  if (isAsymmetric) {
    const { privateKey: privPath, publicKey: pubPath } = resolveKeyPaths(keyName, projectName)
    if (!fs.existsSync(privPath)) return errorResponse(`Private key not found: ${privPath}`)
    oldKeyBackupPath = path.join(keysDir, `${keyName}-backup-${timestamp}`)
    fs.mkdirSync(oldKeyBackupPath, { recursive: true })
    fs.copyFileSync(privPath, path.join(oldKeyBackupPath, `${keyName}.key`))
    fs.copyFileSync(pubPath, path.join(oldKeyBackupPath, `${keyName}.pub`))
    const kp = generateKeyPair(algorithm as AsymmetricAlgorithm)
    fs.writeFileSync(privPath, kp.privateKey, { mode: 0o600 })
    fs.writeFileSync(pubPath, kp.publicKey)
  } else {
    const keyFilePath = resolveKeyPath(keyName, projectName, false)
    oldKeyBackupPath = path.join(keysDir, `${keyName}-backup-${timestamp}.key`)
    if (fs.existsSync(keyFilePath)) fs.copyFileSync(keyFilePath, oldKeyBackupPath)
    fs.mkdirSync(path.dirname(keyFilePath), { recursive: true })
    fs.writeFileSync(keyFilePath, generatePassphrase(), { mode: 0o600 })
  }
  lines.push(`  Old key backed up to: ${oldKeyBackupPath}`)

  // Step 3: Re-encrypt
  lines.push('', 'Step 3: Re-encrypting...')
  clearClientCache()
  let rotatedCount = 0

  for (const [env, vars] of exportedData) {
    try {
      const newClient = await getClientForEnvironment(env, { config: ctx.config, connectionStrings: ctx.connectionStrings, project: projectName, forceNew: true })
      await newClient.connect()
      try {
        for (const [k, v] of Object.entries(vars)) {
          await newClient.set({ key: k, value: v, project: projectName, service, environment: env, metadata: { source: 'rotation' } })
          rotatedCount++
        }
        lines.push(`  [${env}] Re-encrypted ${Object.keys(vars).length} variables`)
      } finally { await newClient.disconnect() }
    } catch (err) { lines.push(`  [${env}] Error: ${(err as Error).message}`) }
  }

  lines.push('', `✓ Key rotation complete. Re-encrypted: ${rotatedCount}`, `Old key backup: ${oldKeyBackupPath}`)
  return textResponse(lines.join('\n'))
}
