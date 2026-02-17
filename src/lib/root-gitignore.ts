/**
 * Root .gitignore helpers for Vaulter repositories
 */

import fs from 'node:fs'
import path from 'node:path'

export interface RootGitignoreSyncResult {
  /** Whether the file was actually changed */
  updated: boolean
  /** Entries that should be in root .gitignore for Vaulter */
  missingEntries: string[]
  /** Whether .gitignore was created */
  created: boolean
}

export function getVaulterRootGitignoreEntries(isMonorepo: boolean): string[] {
  const singleRepoEntries = [
    '# Vaulter generated files',
    '.vaulter/local/configs.env',
    '.vaulter/local/secrets.env',
    '.vaulter/deploy/secrets/*.env'
  ]

  const monorepoExtraEntries = [
    '.vaulter/local/services/*/configs.env',
    '.vaulter/local/services/*/secrets.env',
    '.vaulter/deploy/shared/secrets/*.env',
    '.vaulter/deploy/services/*/secrets/*.env'
  ]

  return isMonorepo
    ? [...singleRepoEntries, ...monorepoExtraEntries]
    : singleRepoEntries
}

export function ensureRootGitignoreForVaulter(
  projectRoot: string,
  isMonorepo: boolean,
  dryRun: boolean
): RootGitignoreSyncResult {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const requiredEntries = getVaulterRootGitignoreEntries(isMonorepo)
  const existed = fs.existsSync(gitignorePath)
  const existing = existed ? fs.readFileSync(gitignorePath, 'utf-8') : ''
  const existingLines = new Set(existing.split(/\r?\n/).map(line => line.trim()))

  const missingEntries = requiredEntries.filter(entry => !existingLines.has(entry))

  if (missingEntries.length === 0 || dryRun) {
    return {
      updated: false,
      created: false,
      missingEntries
    }
  }

  const normalizedEntries = missingEntries
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .join('\n')

  const block = `\n# Vaulter - Gitignore (managed by Vaulter)\n${normalizedEntries}\n`
  const toWrite = existing.length > 0
    ? `${existing.replace(/\r?\n$/, '')}\n${block}`
    : `# Vaulter - Gitignore (managed by Vaulter)\n${normalizedEntries}\n`

  fs.writeFileSync(gitignorePath, toWrite)

  return {
    updated: true,
    created: !existed,
    missingEntries
  }
}
