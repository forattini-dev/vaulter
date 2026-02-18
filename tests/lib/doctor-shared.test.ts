/**
 * Tests for doctor-shared.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildRootGitignoreDoctorCheck, isMonorepoConfigMode } from '../../src/lib/doctor-shared.js'
import { getVaulterRootGitignoreEntries } from '../../src/lib/root-gitignore.js'

describe('doctor-shared', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vaulter-doctor-shared-'))
  })

  it('should return skip when project root is missing', () => {
    const result = buildRootGitignoreDoctorCheck({
      projectRoot: null,
      isMonorepo: false,
      applyFixes: false,
      fixHint: 'Run with --fix',
      skipHint: 'Run from project root'
    })

    expect(result).toEqual({
      name: 'gitignore',
      status: 'skip',
      details: 'project root not resolved for .gitignore checks',
      hint: 'Run from project root'
    })
  })

  it('should mark gitignore as ok when entries already exist', () => {
    const gitignore = join(dir, '.gitignore')
    const existing = getVaulterRootGitignoreEntries(false)
    writeFileSync(gitignore, existing.join('\n'))

    const result = buildRootGitignoreDoctorCheck({
      projectRoot: dir,
      isMonorepo: false,
      applyFixes: false,
      fixHint: 'Run with --fix',
      skipHint: 'Run from project root'
    })

    expect(result.name).toBe('gitignore')
    expect(result.status).toBe('ok')
    expect(result.details).toBe('required Vaulter entries present in .gitignore')
  })

  it('should report warning when entries are missing', () => {
    writeFileSync(join(dir, '.gitignore'), '.idea/\n')

    const result = buildRootGitignoreDoctorCheck({
      projectRoot: dir,
      isMonorepo: true,
      applyFixes: false,
      fixHint: 'Run with --fix',
      skipHint: 'Run from project root'
    })

    expect(result.status).toBe('warn')
    expect(result.details).toContain('missing')
    expect(result.hint).toBe('Run with --fix')
  })

  it('should apply updates on dry-run mode with warning message', () => {
    writeFileSync(join(dir, '.gitignore'), '.idea/')

    const result = buildRootGitignoreDoctorCheck({
      projectRoot: dir,
      isMonorepo: true,
      applyFixes: false,
      dryRun: true,
      fixHint: 'Run with --fix',
      skipHint: 'Run from project root'
    })

    expect(result.status).toBe('warn')
    expect(result.details).toContain('would add with --fix')
    expect(result.hint).toBe('Run with --fix')
  })

  it('should report ok after applying and update .gitignore', () => {
    const result = buildRootGitignoreDoctorCheck({
      projectRoot: dir,
      isMonorepo: false,
      applyFixes: true,
      fixHint: 'Run with --fix',
      skipHint: 'Run from project root'
    })

    expect(result.name).toBe('gitignore')
    expect(result.status).toBe('ok')
    expect(result.details).toContain('added')
    expect(result.details).toMatch(/entry|entries/)

    const updatedContent = readFileSync(join(dir, '.gitignore'), 'utf-8')
    const vaulterMarker = '# Vaulter - Gitignore (managed by Vaulter)'
    expect(updatedContent).toContain(vaulterMarker)
    expect(statSync(join(dir, '.gitignore')).isFile()).toBe(true)
  })

  it('should expose monorepo mode detection proxy', () => {
    const result = isMonorepoConfigMode({
      version: '1',
      project: 'p',
      services: ['api'],
      deployments: { mode: 'split' }
    })

    expect(result).toBe(true)
  })
})
