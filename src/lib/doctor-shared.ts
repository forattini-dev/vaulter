import { ensureRootGitignoreForVaulter } from './root-gitignore.js'
import { isMonorepoFromConfig } from './monorepo.js'

type DoctorStatus = 'ok' | 'warn' | 'fail' | 'skip'

export interface DoctorCheckLike {
  name: string
  status: DoctorStatus
  details: string
  hint?: string
}

export interface RootGitignoreCheckOptions {
  projectRoot: string | null
  isMonorepo: boolean
  applyFixes: boolean
  dryRun?: boolean
  fixHint: string
  skipHint: string
}

export const isMonorepoConfigMode = isMonorepoFromConfig

export function buildRootGitignoreDoctorCheck({
  projectRoot,
  isMonorepo,
  applyFixes,
  dryRun = false,
  fixHint,
  skipHint
}: RootGitignoreCheckOptions): DoctorCheckLike {
  if (!projectRoot) {
    return {
      name: 'gitignore',
      status: 'skip',
      details: 'project root not resolved for .gitignore checks',
      hint: skipHint
    }
  }

  try {
    const rootGitignore = ensureRootGitignoreForVaulter(
      projectRoot,
      isMonorepo,
      !applyFixes || dryRun
    )

    if (rootGitignore.missingEntries.length === 0) {
      return {
        name: 'gitignore',
        status: 'ok',
        details: 'required Vaulter entries present in .gitignore'
      }
    }

    if (applyFixes && rootGitignore.updated) {
      return {
        name: 'gitignore',
        status: 'ok',
        details: `added ${rootGitignore.missingEntries.length} .gitignore ${rootGitignore.missingEntries.length === 1 ? 'entry' : 'entries'}`
      }
    }

    if (dryRun) {
      return {
        name: 'gitignore',
        status: 'warn',
        details: `missing ${rootGitignore.missingEntries.length} required .gitignore ${rootGitignore.missingEntries.length === 1 ? 'entry' : 'entries'} (would add with --fix)`,
        hint: fixHint
      }
    }

    return {
      name: 'gitignore',
      status: 'warn',
      details: `missing ${rootGitignore.missingEntries.length} required .gitignore ${rootGitignore.missingEntries.length === 1 ? 'entry' : 'entries'}`,
      hint: fixHint
    }
  } catch (error) {
    return {
      name: 'gitignore',
      status: 'warn',
      details: `failed to validate .gitignore: ${(error as Error).message}`,
      hint: 'Check filesystem permissions and run from repository root'
    }
  }
}
