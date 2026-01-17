/**
 * Tests for monorepo-detect.ts - Monorepo detection module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import type { ScanResult, PackageInfo, MonorepoInfo } from '../../src/lib/monorepo-detect.js'

// Mock fs
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn()
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn()
}))

// Mock tinyglobby
vi.mock('tinyglobby', () => ({
  glob: vi.fn()
}))

// Mock yaml
vi.mock('yaml', () => ({
  default: {
    parse: vi.fn()
  }
}))

import fs from 'node:fs'
import YAML from 'yaml'
import { glob } from 'tinyglobby'
import {
  extractEnvironmentName,
  detectMonorepoTool,
  scanMonorepo,
  formatScanResult
} from '../../src/lib/monorepo-detect.js'

const mockedFs = vi.mocked(fs)
const mockedGlob = vi.mocked(glob)
const mockedYaml = vi.mocked(YAML)

describe('monorepo-detect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no files exist
    mockedFs.existsSync.mockReturnValue(false)
  })

  describe('extractEnvironmentName', () => {
    it('should extract env from name.env pattern', () => {
      expect(extractEnvironmentName('dev.env')).toBe('dev')
      expect(extractEnvironmentName('production.env')).toBe('production')
      expect(extractEnvironmentName('staging.env')).toBe('staging')
    })

    it('should extract env from .env.name pattern', () => {
      expect(extractEnvironmentName('.env.dev')).toBe('dev')
      expect(extractEnvironmentName('.env.production')).toBe('production')
      expect(extractEnvironmentName('.env.local')).toBe('local')
    })

    it('should return null for generic .env', () => {
      expect(extractEnvironmentName('.env')).toBeNull()
    })

    it('should return null for invalid patterns', () => {
      expect(extractEnvironmentName('config.yaml')).toBeNull()
      expect(extractEnvironmentName('readme.md')).toBeNull()
    })

    it('should handle edge cases', () => {
      expect(extractEnvironmentName('.env.')).toBeNull()
    })
  })

  describe('detectMonorepoTool', () => {
    const testRoot = '/test/project'

    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(false)
    })

    describe('NX detection', () => {
      it('should detect NX project with nx.json', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'nx.json')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({}))

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('nx')
        expect(result.configFile).toBe(path.join(testRoot, 'nx.json'))
        expect(result.workspacePatterns).toContain('apps/*')
      })

      it('should read workspaceLayout from nx.json', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'nx.json')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({
          workspaceLayout: {
            appsDir: 'applications',
            libsDir: 'libraries'
          }
        }))

        const result = detectMonorepoTool(testRoot)

        expect(result.workspacePatterns).toContain('applications/*')
        expect(result.workspacePatterns).toContain('libraries/*')
      })

      it('should read workspace.json for older NX', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'nx.json')) return true
          if (p === path.join(testRoot, 'workspace.json')) return true
          return false
        })
        mockedFs.readFileSync.mockImplementation((p) => {
          if (String(p).includes('nx.json')) return JSON.stringify({})
          if (String(p).includes('workspace.json')) {
            return JSON.stringify({
              projects: {
                'app1': 'apps/app1',
                'lib1': 'libs/lib1'
              }
            })
          }
          return ''
        })

        const result = detectMonorepoTool(testRoot)

        expect(result.workspacePatterns).toContain('apps/app1')
        expect(result.workspacePatterns).toContain('libs/lib1')
      })
    })

    describe('Turborepo detection', () => {
      it('should detect Turborepo with turbo.json', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'turbo.json')) return true
          return false
        })

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('turborepo')
        expect(result.configFile).toBe(path.join(testRoot, 'turbo.json'))
      })

      it('should use pnpm workspaces for Turborepo', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'turbo.json')) return true
          if (p === path.join(testRoot, 'pnpm-workspace.yaml')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue('')
        mockedYaml.parse.mockReturnValue({ packages: ['services/*', 'tools/*'] })

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('turborepo')
        expect(result.workspacePatterns).toContain('services/*')
        expect(result.workspacePatterns).toContain('tools/*')
      })
    })

    describe('Rush detection', () => {
      it('should detect Rush with rush.json', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'rush.json')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({
          projects: [
            { projectFolder: 'apps/frontend' },
            { projectFolder: 'libs/common' }
          ]
        }))

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('rush')
        expect(result.configFile).toBe(path.join(testRoot, 'rush.json'))
        expect(result.workspacePatterns).toContain('apps/frontend')
        expect(result.workspacePatterns).toContain('libs/common')
      })
    })

    describe('Lerna detection', () => {
      it('should detect Lerna with lerna.json', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'lerna.json')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({
          packages: ['modules/*', 'core/*']
        }))

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('lerna')
        expect(result.configFile).toBe(path.join(testRoot, 'lerna.json'))
        expect(result.workspacePatterns).toContain('modules/*')
        expect(result.workspacePatterns).toContain('core/*')
      })

      it('should use default packages/* if not specified', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'lerna.json')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({}))

        const result = detectMonorepoTool(testRoot)

        expect(result.workspacePatterns).toContain('packages/*')
      })
    })

    describe('pnpm workspaces detection', () => {
      it('should detect pnpm with pnpm-workspace.yaml', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'pnpm-workspace.yaml')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue('')
        mockedYaml.parse.mockReturnValue({ packages: ['packages/*', 'apps/*'] })

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('pnpm')
        expect(result.configFile).toBe(path.join(testRoot, 'pnpm-workspace.yaml'))
        expect(result.workspacePatterns).toContain('packages/*')
        expect(result.workspacePatterns).toContain('apps/*')
      })
    })

    describe('Yarn workspaces detection', () => {
      it('should detect Yarn from package.json workspaces array', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'package.json')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({
          workspaces: ['packages/*', 'apps/*']
        }))

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('yarn')
        expect(result.configFile).toBe(path.join(testRoot, 'package.json'))
        expect(result.workspacePatterns).toContain('packages/*')
        expect(result.workspacePatterns).toContain('apps/*')
      })

      it('should detect Yarn from package.json workspaces.packages', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'package.json')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue(JSON.stringify({
          workspaces: { packages: ['components/*'] }
        }))

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('yarn')
        expect(result.workspacePatterns).toContain('components/*')
      })
    })

    describe('Unknown tool', () => {
      it('should return unknown with guessed patterns', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'apps')) return true
          if (p === path.join(testRoot, 'packages')) return true
          return false
        })
        mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as any)

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('unknown')
        expect(result.configFile).toBeNull()
        expect(result.workspacePatterns).toContain('apps/*')
        expect(result.workspacePatterns).toContain('packages/*')
      })

      it('should use wildcard if no common dirs found', () => {
        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('unknown')
        expect(result.workspacePatterns).toContain('*')
      })
    })

    describe('Error handling', () => {
      it('should handle JSON parse errors gracefully', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'nx.json')) return true
          return false
        })
        mockedFs.readFileSync.mockImplementation(() => {
          throw new Error('Invalid JSON')
        })

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('nx')
        expect(result.workspacePatterns).toContain('apps/*')
      })

      it('should handle YAML parse errors', () => {
        mockedFs.existsSync.mockImplementation((p) => {
          if (p === path.join(testRoot, 'pnpm-workspace.yaml')) return true
          return false
        })
        mockedFs.readFileSync.mockReturnValue('')
        mockedYaml.parse.mockImplementation(() => {
          throw new Error('Invalid YAML')
        })

        const result = detectMonorepoTool(testRoot)

        expect(result.tool).toBe('pnpm')
        expect(result.workspacePatterns).toContain('packages/*')
      })
    })
  })

  describe('scanMonorepo', () => {
    const testRoot = '/test/project'

    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(false)
      mockedGlob.mockResolvedValue([])
    })

    it('should scan packages with glob patterns', async () => {
      // Setup NX project
      mockedFs.existsSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === path.join(testRoot, 'nx.json')) return true
        if (pathStr === path.join(testRoot, 'apps/app1')) return true
        if (pathStr === path.join(testRoot, 'apps/app1/package.json')) return true
        if (pathStr === path.join(testRoot, 'apps/app1/deploy')) return false
        if (pathStr.includes('.vaulter/config.yaml')) return false
        return false
      })
      mockedFs.readFileSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr.includes('nx.json')) return JSON.stringify({})
        if (pathStr.includes('package.json')) return JSON.stringify({ name: '@test/app1' })
        return ''
      })
      mockedFs.readdirSync.mockReturnValue([])

      mockedGlob.mockImplementation(async (pattern, opts) => {
        if (String(pattern).includes('apps')) {
          return [path.join(testRoot, 'apps/app1')]
        }
        return []
      })

      const result = await scanMonorepo(testRoot)

      expect(result.monorepo.tool).toBe('nx')
      expect(result.packages).toHaveLength(1)
      expect(result.packages[0].name).toBe('@test/app1')
      expect(result.packages[0].hasPackageJson).toBe(true)
    })

    it('should detect env files in packages', async () => {
      mockedFs.existsSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === path.join(testRoot, 'nx.json')) return true
        if (pathStr === path.join(testRoot, 'apps/api')) return true
        if (pathStr === path.join(testRoot, 'apps/api/package.json')) return true
        return false
      })
      mockedFs.readFileSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr.includes('nx.json')) return JSON.stringify({})
        if (pathStr.includes('package.json')) return JSON.stringify({ name: 'api' })
        return ''
      })
      mockedFs.readdirSync.mockReturnValue([
        { name: '.env', isFile: () => true },
        { name: '.env.dev', isFile: () => true },
        { name: 'src', isFile: () => false }
      ] as any)

      mockedGlob.mockResolvedValue([path.join(testRoot, 'apps/api')])

      const result = await scanMonorepo(testRoot)

      expect(result.packages[0].envFiles).toHaveLength(2)
      expect(result.packages[0].hasEnvFiles).toContain('.env')
      expect(result.packages[0].hasEnvFiles).toContain('.env.dev')
      expect(result.packages[0].detectedEnvironments).toContain('dev')
    })

    it('should detect vaulter initialized packages', async () => {
      mockedFs.existsSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === path.join(testRoot, 'nx.json')) return true
        if (pathStr === path.join(testRoot, 'apps/web')) return true
        if (pathStr === path.join(testRoot, 'apps/web/package.json')) return true
        if (pathStr === path.join(testRoot, 'apps/web/.vaulter/config.yaml')) return true
        return false
      })
      mockedFs.readFileSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr.includes('nx.json')) return JSON.stringify({})
        if (pathStr.includes('package.json')) return JSON.stringify({ name: 'web' })
        if (pathStr.includes('config.yaml')) return ''
        return ''
      })
      mockedFs.readdirSync.mockReturnValue([])
      mockedYaml.parse.mockReturnValue({ environments: ['dev', 'prd'] })

      mockedGlob.mockResolvedValue([path.join(testRoot, 'apps/web')])

      const result = await scanMonorepo(testRoot)

      expect(result.initialized).toHaveLength(1)
      expect(result.uninitialized).toHaveLength(0)
      expect(result.packages[0].hasVaulterConfig).toBe(true)
      expect(result.packages[0].configuredEnvironments).toEqual(['dev', 'prd'])
    })

    it('should detect package type from path', async () => {
      mockedFs.existsSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === path.join(testRoot, 'nx.json')) return true
        if (pathStr === path.join(testRoot, 'apps/app1')) return true
        if (pathStr === path.join(testRoot, 'libs/lib1')) return true
        if (pathStr === path.join(testRoot, 'packages/pkg1')) return true
        if (pathStr.includes('package.json')) return false
        return false
      })
      mockedFs.readFileSync.mockImplementation((p) => {
        if (String(p).includes('nx.json')) return JSON.stringify({})
        return ''
      })
      mockedFs.readdirSync.mockReturnValue([])

      mockedGlob.mockImplementation(async (pattern) => {
        const patternStr = String(pattern)
        if (patternStr.includes('apps')) return [path.join(testRoot, 'apps/app1')]
        if (patternStr.includes('libs')) return [path.join(testRoot, 'libs/lib1')]
        if (patternStr.includes('packages')) return [path.join(testRoot, 'packages/pkg1')]
        return []
      })

      const result = await scanMonorepo(testRoot)

      const app = result.packages.find(p => p.relativePath.includes('app1'))
      const lib = result.packages.find(p => p.relativePath.includes('lib1'))
      const pkg = result.packages.find(p => p.relativePath.includes('pkg1'))

      expect(app?.type).toBe('app')
      expect(lib?.type).toBe('lib')
      expect(pkg?.type).toBe('package')
    })

    it('should handle direct paths (Rush style)', async () => {
      mockedFs.existsSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === path.join(testRoot, 'rush.json')) return true
        if (pathStr === path.join(testRoot, 'apps/frontend')) return true
        return false
      })
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({
        projects: [{ projectFolder: 'apps/frontend' }]
      }))
      mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as any)
      mockedFs.readdirSync.mockReturnValue([])

      const result = await scanMonorepo(testRoot)

      expect(result.monorepo.tool).toBe('rush')
      expect(result.packages).toHaveLength(1)
    })

    it('should handle glob errors gracefully', async () => {
      mockedFs.existsSync.mockImplementation((p) => {
        if (String(p) === path.join(testRoot, 'nx.json')) return true
        return false
      })
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({}))

      mockedGlob.mockRejectedValue(new Error('Glob error'))

      const result = await scanMonorepo(testRoot)

      expect(result.packages).toHaveLength(0)
    })

    it('should find env files in deploy/configs and deploy/secrets', async () => {
      mockedFs.existsSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr === path.join(testRoot, 'nx.json')) return true
        if (pathStr === path.join(testRoot, 'apps/api')) return true
        if (pathStr === path.join(testRoot, 'apps/api/package.json')) return false
        if (pathStr === path.join(testRoot, 'apps/api/deploy')) return true
        if (pathStr === path.join(testRoot, 'apps/api/deploy/configs')) return true
        if (pathStr === path.join(testRoot, 'apps/api/deploy/secrets')) return true
        return false
      })
      mockedFs.readFileSync.mockImplementation((p) => {
        if (String(p).includes('nx.json')) return JSON.stringify({})
        return ''
      })
      mockedFs.readdirSync.mockImplementation((p) => {
        const pathStr = String(p)
        if (pathStr.includes('deploy/configs')) return ['dev.env', 'prd.env']
        if (pathStr.includes('deploy/secrets')) return ['dev.env', 'prd.env']
        return []
      })

      mockedGlob.mockResolvedValue([path.join(testRoot, 'apps/api')])

      const result = await scanMonorepo(testRoot)

      const pkg = result.packages[0]
      expect(pkg.hasDeployDir).toBe(true)
      expect(pkg.envFiles.filter(f => f.location === 'deploy/configs')).toHaveLength(2)
      expect(pkg.envFiles.filter(f => f.location === 'deploy/secrets')).toHaveLength(2)
    })
  })

  describe('formatScanResult', () => {
    it('should format scan result for display', () => {
      const result: ScanResult = {
        monorepo: {
          tool: 'nx',
          root: '/test/project',
          configFile: '/test/project/nx.json',
          workspacePatterns: ['apps/*', 'libs/*']
        },
        packages: [
          {
            name: 'app1',
            path: '/test/project/apps/app1',
            relativePath: 'apps/app1',
            hasPackageJson: true,
            hasEnvFiles: ['.env.dev'],
            envFiles: [{ path: '.env.dev', environment: 'dev', location: 'root' }],
            detectedEnvironments: ['dev'],
            configuredEnvironments: null,
            hasDeployDir: false,
            hasVaulterConfig: false,
            type: 'app'
          },
          {
            name: 'lib1',
            path: '/test/project/libs/lib1',
            relativePath: 'libs/lib1',
            hasPackageJson: true,
            hasEnvFiles: [],
            envFiles: [],
            detectedEnvironments: [],
            configuredEnvironments: ['dev', 'prd'],
            hasDeployDir: false,
            hasVaulterConfig: true,
            type: 'lib'
          }
        ],
        initialized: [],
        uninitialized: [],
        withEnvFiles: []
      }

      // Properly categorize
      result.initialized = result.packages.filter(p => p.hasVaulterConfig)
      result.uninitialized = result.packages.filter(p => !p.hasVaulterConfig)
      result.withEnvFiles = result.packages.filter(p => p.hasEnvFiles.length > 0)

      const formatted = formatScanResult(result)

      expect(formatted).toContain('Monorepo: NX')
      expect(formatted).toContain('Root: /test/project')
      expect(formatted).toContain('Config: nx.json')
      expect(formatted).toContain('apps/*, libs/*')
      expect(formatted).toContain('Found 2 package(s)')
      expect(formatted).toContain('Vaulter initialized: 1')
      expect(formatted).toContain('Not initialized: 1')
      expect(formatted).toContain('With .env files: 1')
    })

    it('should show environment info', () => {
      const result: ScanResult = {
        monorepo: {
          tool: 'pnpm',
          root: '/project',
          configFile: '/project/pnpm-workspace.yaml',
          workspacePatterns: ['packages/*']
        },
        packages: [
          {
            name: 'api',
            path: '/project/packages/api',
            relativePath: 'packages/api',
            hasPackageJson: true,
            hasEnvFiles: ['.env.dev', '.env.prd'],
            envFiles: [
              { path: '.env.dev', environment: 'dev', location: 'root' },
              { path: '.env.prd', environment: 'prd', location: 'root' }
            ],
            detectedEnvironments: ['dev', 'prd'],
            configuredEnvironments: ['dev', 'stg', 'prd'],
            hasDeployDir: false,
            hasVaulterConfig: true,
            type: 'package'
          }
        ],
        initialized: [],
        uninitialized: [],
        withEnvFiles: []
      }

      result.initialized = result.packages.filter(p => p.hasVaulterConfig)

      const formatted = formatScanResult(result)

      expect(formatted).toContain('Detected environments: dev, prd')
      expect(formatted).toContain('missing: stg')
    })

    it('should handle no config file', () => {
      const result: ScanResult = {
        monorepo: {
          tool: 'unknown',
          root: '/project',
          configFile: null,
          workspacePatterns: ['*']
        },
        packages: [],
        initialized: [],
        uninitialized: [],
        withEnvFiles: []
      }

      const formatted = formatScanResult(result)

      expect(formatted).toContain('Monorepo: UNKNOWN')
      expect(formatted).not.toContain('Config:')
    })

    it('should show deploy dir indicator', () => {
      const result: ScanResult = {
        monorepo: {
          tool: 'nx',
          root: '/project',
          configFile: '/project/nx.json',
          workspacePatterns: ['apps/*']
        },
        packages: [
          {
            name: 'app',
            path: '/project/apps/app',
            relativePath: 'apps/app',
            hasPackageJson: true,
            hasEnvFiles: [],
            envFiles: [],
            detectedEnvironments: [],
            configuredEnvironments: null,
            hasDeployDir: true,
            hasVaulterConfig: false,
            type: 'app'
          }
        ],
        initialized: [],
        uninitialized: [],
        withEnvFiles: []
      }

      result.uninitialized = result.packages

      const formatted = formatScanResult(result)

      expect(formatted).toContain('[deploy/]')
    })
  })
})
