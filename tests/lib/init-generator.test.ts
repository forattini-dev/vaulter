/**
 * Tests for init-generator.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  detectMonorepo,
  generateVaulterStructure,
  getDefaultProjectName,
  type InitOptions
} from '../../src/lib/init-generator.js'

describe('init-generator', () => {
  let tempDir: string

  beforeEach(() => {
    // Create temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-init-test-'))
  })

  afterEach(() => {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('detectMonorepo', () => {
    it('should detect NX monorepo', () => {
      fs.writeFileSync(path.join(tempDir, 'nx.json'), '{}')
      const result = detectMonorepo(tempDir)
      expect(result.isMonorepo).toBe(true)
      expect(result.tool).toBe('nx')
      expect(result.servicesPattern).toBe('apps/*')
    })

    it('should detect Turborepo', () => {
      fs.writeFileSync(path.join(tempDir, 'turbo.json'), '{}')
      const result = detectMonorepo(tempDir)
      expect(result.isMonorepo).toBe(true)
      expect(result.tool).toBe('turborepo')
      expect(result.servicesPattern).toBe('apps/*')
    })

    it('should detect pnpm workspaces', () => {
      fs.writeFileSync(path.join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*')
      const result = detectMonorepo(tempDir)
      expect(result.isMonorepo).toBe(true)
      expect(result.tool).toBe('pnpm')
      expect(result.servicesPattern).toBe('packages/*')
    })

    it('should detect Lerna', () => {
      fs.writeFileSync(path.join(tempDir, 'lerna.json'), '{}')
      const result = detectMonorepo(tempDir)
      expect(result.isMonorepo).toBe(true)
      expect(result.tool).toBe('lerna')
      expect(result.servicesPattern).toBe('packages/*')
    })

    it('should detect Yarn workspaces', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      )
      const result = detectMonorepo(tempDir)
      expect(result.isMonorepo).toBe(true)
      expect(result.tool).toBe('yarn')
      expect(result.servicesPattern).toBe('packages/*')
    })

    it('should return false for regular package.json without workspaces', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'my-app' })
      )
      const result = detectMonorepo(tempDir)
      expect(result.isMonorepo).toBe(false)
      expect(result.tool).toBeUndefined()
    })

    it('should return false when no monorepo markers exist', () => {
      const result = detectMonorepo(tempDir)
      expect(result.isMonorepo).toBe(false)
      expect(result.tool).toBeUndefined()
    })

    it('should handle invalid package.json gracefully', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), 'not valid json')
      const result = detectMonorepo(tempDir)
      expect(result.isMonorepo).toBe(false)
    })

    it('should prioritize NX over other monorepo markers', () => {
      // If multiple markers exist, first detected wins
      fs.writeFileSync(path.join(tempDir, 'nx.json'), '{}')
      fs.writeFileSync(path.join(tempDir, 'turbo.json'), '{}')
      const result = detectMonorepo(tempDir)
      expect(result.tool).toBe('nx')
    })
  })

  describe('generateVaulterStructure', () => {
    describe('single repo', () => {
      it('should create basic structure', () => {
        const options: InitOptions = {
          projectName: 'test-project',
          isMonorepo: false,
          environments: ['dev', 'prd']
        }

        const result = generateVaulterStructure(tempDir, options)

        expect(result.success).toBe(true)
        expect(result.projectName).toBe('test-project')
        expect(result.mode).toBe('single-repo')
        expect(result.createdFiles.length).toBeGreaterThan(0)

        // Verify directories exist
        expect(fs.existsSync(path.join(tempDir, '.vaulter'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'local'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy', 'configs'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy', 'secrets'))).toBe(true)
      })

      it('should create config.yaml', () => {
        const options: InitOptions = {
          projectName: 'my-app',
          isMonorepo: false,
          environments: ['dev', 'stg', 'prd']
        }

        generateVaulterStructure(tempDir, options)

        const configPath = path.join(tempDir, '.vaulter', 'config.yaml')
        expect(fs.existsSync(configPath)).toBe(true)

        const content = fs.readFileSync(configPath, 'utf-8')
        expect(content).toContain('project: my-app')
        expect(content).toContain('- dev')
        expect(content).toContain('- stg')
        expect(content).toContain('- prd')
      })

      it('should create local .env files', () => {
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['dev']
        }

        generateVaulterStructure(tempDir, options)

        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'local', '.env'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'local', '.env.example'))).toBe(true)
      })

      it('should create deploy config files for each environment', () => {
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['dev', 'stg', 'prd']
        }

        generateVaulterStructure(tempDir, options)

        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy', 'configs', 'dev.env'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy', 'configs', 'stg.env'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy', 'configs', 'prd.env'))).toBe(true)
      })

      it('should create secrets .gitignore', () => {
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['dev']
        }

        generateVaulterStructure(tempDir, options)

        const gitignore = fs.readFileSync(
          path.join(tempDir, '.vaulter', 'deploy', 'secrets', '.gitignore'),
          'utf-8'
        )
        expect(gitignore).toContain('*')
        expect(gitignore).toContain('!.gitignore')
      })

      it('should create .vaulter/.gitignore', () => {
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['dev']
        }

        generateVaulterStructure(tempDir, options)

        const gitignore = fs.readFileSync(
          path.join(tempDir, '.vaulter', '.gitignore'),
          'utf-8'
        )
        expect(gitignore).toContain('local/.env')
        expect(gitignore).toContain('deploy/secrets/*.env')
      })

      it('should include backend URL in config', () => {
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['dev'],
          backend: 's3://my-bucket/vaulter'
        }

        generateVaulterStructure(tempDir, options)

        const config = fs.readFileSync(
          path.join(tempDir, '.vaulter', 'config.yaml'),
          'utf-8'
        )
        expect(config).toContain('s3://my-bucket/vaulter')
      })
    })

    describe('monorepo', () => {
      it('should create monorepo structure', () => {
        const options: InitOptions = {
          projectName: 'mono-app',
          isMonorepo: true,
          environments: ['dev', 'prd'],
          servicesPattern: 'apps/*'
        }

        const result = generateVaulterStructure(tempDir, options)

        expect(result.success).toBe(true)
        expect(result.mode).toBe('monorepo')

        // Verify monorepo-specific directories
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'local', 'services'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy', 'shared', 'configs'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy', 'shared', 'secrets'))).toBe(true)
      })

      it('should create shared.env files', () => {
        const options: InitOptions = {
          projectName: 'mono',
          isMonorepo: true,
          environments: ['dev']
        }

        generateVaulterStructure(tempDir, options)

        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'local', 'shared.env'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'local', 'shared.env.example'))).toBe(true)
      })

      it('should create services .gitkeep', () => {
        const options: InitOptions = {
          projectName: 'mono',
          isMonorepo: true,
          environments: ['dev']
        }

        generateVaulterStructure(tempDir, options)

        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'local', 'services', '.gitkeep'))).toBe(true)
      })

      it('should create shared deploy configs', () => {
        const options: InitOptions = {
          projectName: 'mono',
          isMonorepo: true,
          environments: ['dev', 'prd']
        }

        generateVaulterStructure(tempDir, options)

        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy', 'shared', 'configs', 'dev.env'))).toBe(true)
        expect(fs.existsSync(path.join(tempDir, '.vaulter', 'deploy', 'shared', 'configs', 'prd.env'))).toBe(true)
      })

      it('should include monorepo section in config', () => {
        const options: InitOptions = {
          projectName: 'mono',
          isMonorepo: true,
          environments: ['dev'],
          servicesPattern: 'packages/*'
        }

        generateVaulterStructure(tempDir, options)

        const config = fs.readFileSync(
          path.join(tempDir, '.vaulter', 'config.yaml'),
          'utf-8'
        )
        expect(config).toContain('MONOREPO CONFIGURATION')
        expect(config).toContain('services_pattern: "packages/*"')
      })

      it('should create monorepo-specific gitignore', () => {
        const options: InitOptions = {
          projectName: 'mono',
          isMonorepo: true,
          environments: ['dev']
        }

        generateVaulterStructure(tempDir, options)

        const gitignore = fs.readFileSync(
          path.join(tempDir, '.vaulter', '.gitignore'),
          'utf-8'
        )
        expect(gitignore).toContain('local/shared.env')
        expect(gitignore).toContain('local/services/*.env')
        expect(gitignore).toContain('deploy/shared/secrets/*.env')
      })
    })

    describe('options', () => {
      it('should respect dryRun option', () => {
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['dev'],
          dryRun: true
        }

        const result = generateVaulterStructure(tempDir, options)

        expect(result.success).toBe(true)
        expect(result.createdFiles.length).toBeGreaterThan(0)

        // Files should NOT be created
        expect(fs.existsSync(path.join(tempDir, '.vaulter'))).toBe(false)
      })

      it('should not overwrite existing files without force', () => {
        // Create initial structure
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['dev']
        }
        generateVaulterStructure(tempDir, options)

        // Modify a file
        const envPath = path.join(tempDir, '.vaulter', 'local', '.env')
        fs.writeFileSync(envPath, 'CUSTOM=value')

        // Run again without force
        generateVaulterStructure(tempDir, options)

        // File should not be overwritten
        const content = fs.readFileSync(envPath, 'utf-8')
        expect(content).toBe('CUSTOM=value')
      })

      it('should overwrite existing files with force', () => {
        // Create initial structure
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['dev']
        }
        generateVaulterStructure(tempDir, options)

        // Modify a file
        const envPath = path.join(tempDir, '.vaulter', 'local', '.env')
        fs.writeFileSync(envPath, 'CUSTOM=value')

        // Run again with force
        const forceOptions = { ...options, force: true }
        generateVaulterStructure(tempDir, forceOptions)

        // File should be overwritten
        const content = fs.readFileSync(envPath, 'utf-8')
        expect(content).not.toBe('CUSTOM=value')
        expect(content).toContain('NODE_ENV=development')
      })
    })

    describe('deploy config content', () => {
      it('should set NODE_ENV=production for prd', () => {
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['prd']
        }

        generateVaulterStructure(tempDir, options)

        const content = fs.readFileSync(
          path.join(tempDir, '.vaulter', 'deploy', 'configs', 'prd.env'),
          'utf-8'
        )
        expect(content).toContain('NODE_ENV=production')
        expect(content).toContain('LOG_LEVEL=info')
      })

      it('should set NODE_ENV=development for non-prd', () => {
        const options: InitOptions = {
          projectName: 'test',
          isMonorepo: false,
          environments: ['dev', 'stg']
        }

        generateVaulterStructure(tempDir, options)

        const devContent = fs.readFileSync(
          path.join(tempDir, '.vaulter', 'deploy', 'configs', 'dev.env'),
          'utf-8'
        )
        expect(devContent).toContain('NODE_ENV=development')
        expect(devContent).toContain('LOG_LEVEL=debug')

        const stgContent = fs.readFileSync(
          path.join(tempDir, '.vaulter', 'deploy', 'configs', 'stg.env'),
          'utf-8'
        )
        expect(stgContent).toContain('NODE_ENV=development')
      })
    })
  })

  describe('getDefaultProjectName', () => {
    it('should return directory name', () => {
      const name = getDefaultProjectName(tempDir)
      expect(name).toBe(path.basename(tempDir))
    })

    it('should use process.cwd() when no baseDir provided', () => {
      const name = getDefaultProjectName()
      expect(name).toBe(path.basename(process.cwd()))
    })
  })

})
