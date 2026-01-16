/**
 * Monorepo Detection
 *
 * Detects monorepo tools and discovers packages/apps
 * Supports: NX, Turborepo, Lerna, pnpm workspaces, Yarn workspaces, Rush
 */

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { glob } from 'tinyglobby'

export type MonorepoTool = 'nx' | 'turborepo' | 'lerna' | 'pnpm' | 'yarn' | 'rush' | 'unknown'

export interface MonorepoInfo {
  tool: MonorepoTool
  root: string
  configFile: string | null
  workspacePatterns: string[]
}

export interface PackageInfo {
  name: string
  path: string
  relativePath: string
  hasPackageJson: boolean
  hasEnvFiles: string[]
  hasDeployDir: boolean
  hasVaulterConfig: boolean
  type: 'app' | 'lib' | 'package' | 'unknown'
}

export interface ScanResult {
  monorepo: MonorepoInfo
  packages: PackageInfo[]
  initialized: PackageInfo[]
  uninitialized: PackageInfo[]
  withEnvFiles: PackageInfo[]
}

/**
 * Detect which monorepo tool is being used
 */
export function detectMonorepoTool(rootDir: string = process.cwd()): MonorepoInfo {
  const root = path.resolve(rootDir)

  // 1. NX - nx.json
  const nxJson = path.join(root, 'nx.json')
  if (fs.existsSync(nxJson)) {
    return {
      tool: 'nx',
      root,
      configFile: nxJson,
      workspacePatterns: getNxWorkspacePatterns(root)
    }
  }

  // 2. Turborepo - turbo.json
  const turboJson = path.join(root, 'turbo.json')
  if (fs.existsSync(turboJson)) {
    // Turborepo uses pnpm/yarn/npm workspaces
    const patterns = getPnpmWorkspacePatterns(root) || getYarnWorkspacePatterns(root) || ['packages/*', 'apps/*']
    return {
      tool: 'turborepo',
      root,
      configFile: turboJson,
      workspacePatterns: patterns
    }
  }

  // 3. Rush - rush.json
  const rushJson = path.join(root, 'rush.json')
  if (fs.existsSync(rushJson)) {
    return {
      tool: 'rush',
      root,
      configFile: rushJson,
      workspacePatterns: getRushProjectFolders(root)
    }
  }

  // 4. Lerna - lerna.json
  const lernaJson = path.join(root, 'lerna.json')
  if (fs.existsSync(lernaJson)) {
    return {
      tool: 'lerna',
      root,
      configFile: lernaJson,
      workspacePatterns: getLernaPackages(root)
    }
  }

  // 5. pnpm workspaces - pnpm-workspace.yaml
  const pnpmWorkspace = path.join(root, 'pnpm-workspace.yaml')
  if (fs.existsSync(pnpmWorkspace)) {
    return {
      tool: 'pnpm',
      root,
      configFile: pnpmWorkspace,
      workspacePatterns: getPnpmWorkspacePatterns(root) || ['packages/*']
    }
  }

  // 6. Yarn/npm workspaces - package.json with workspaces
  const patterns = getYarnWorkspacePatterns(root)
  if (patterns) {
    return {
      tool: 'yarn',
      root,
      configFile: path.join(root, 'package.json'),
      workspacePatterns: patterns
    }
  }

  // Unknown - try common patterns
  return {
    tool: 'unknown',
    root,
    configFile: null,
    workspacePatterns: guessWorkspacePatterns(root)
  }
}

/**
 * Get NX workspace patterns
 */
function getNxWorkspacePatterns(root: string): string[] {
  const patterns: string[] = []

  // Check nx.json for project patterns
  const nxJsonPath = path.join(root, 'nx.json')
  if (fs.existsSync(nxJsonPath)) {
    try {
      const nxJson = JSON.parse(fs.readFileSync(nxJsonPath, 'utf-8'))

      // NX 17+ uses workspaceLayout
      if (nxJson.workspaceLayout) {
        if (nxJson.workspaceLayout.appsDir) {
          patterns.push(`${nxJson.workspaceLayout.appsDir}/*`)
        }
        if (nxJson.workspaceLayout.libsDir) {
          patterns.push(`${nxJson.workspaceLayout.libsDir}/*`)
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check workspace.json (older NX)
  const workspaceJsonPath = path.join(root, 'workspace.json')
  if (fs.existsSync(workspaceJsonPath)) {
    try {
      const workspaceJson = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'))
      if (workspaceJson.projects) {
        // Projects can be paths directly
        for (const [, projectPath] of Object.entries(workspaceJson.projects)) {
          if (typeof projectPath === 'string') {
            patterns.push(projectPath)
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  // Default NX patterns
  if (patterns.length === 0) {
    patterns.push('apps/*', 'libs/*', 'packages/*')
  }

  return [...new Set(patterns)]
}

/**
 * Get pnpm workspace patterns
 */
function getPnpmWorkspacePatterns(root: string): string[] | null {
  const workspacePath = path.join(root, 'pnpm-workspace.yaml')
  if (!fs.existsSync(workspacePath)) return null

  try {
    const content = fs.readFileSync(workspacePath, 'utf-8')
    const workspace = YAML.parse(content)
    return workspace.packages || null
  } catch {
    return null
  }
}

/**
 * Get Yarn/npm workspace patterns from package.json
 */
function getYarnWorkspacePatterns(root: string): string[] | null {
  const pkgPath = path.join(root, 'package.json')
  if (!fs.existsSync(pkgPath)) return null

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    if (pkg.workspaces) {
      // Can be array or object with packages
      if (Array.isArray(pkg.workspaces)) {
        return pkg.workspaces
      }
      if (pkg.workspaces.packages) {
        return pkg.workspaces.packages
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get Lerna package patterns
 */
function getLernaPackages(root: string): string[] {
  const lernaPath = path.join(root, 'lerna.json')
  if (!fs.existsSync(lernaPath)) return ['packages/*']

  try {
    const lerna = JSON.parse(fs.readFileSync(lernaPath, 'utf-8'))
    return lerna.packages || ['packages/*']
  } catch {
    return ['packages/*']
  }
}

/**
 * Get Rush project folders
 */
function getRushProjectFolders(root: string): string[] {
  const rushPath = path.join(root, 'rush.json')
  if (!fs.existsSync(rushPath)) return []

  try {
    const rush = JSON.parse(fs.readFileSync(rushPath, 'utf-8'))
    if (rush.projects) {
      return rush.projects.map((p: { projectFolder: string }) => p.projectFolder)
    }
    return []
  } catch {
    return []
  }
}

/**
 * Guess workspace patterns from directory structure
 */
function guessWorkspacePatterns(root: string): string[] {
  const patterns: string[] = []
  const commonDirs = ['apps', 'packages', 'libs', 'services', 'modules']

  for (const dir of commonDirs) {
    const dirPath = path.join(root, dir)
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      patterns.push(`${dir}/*`)
    }
  }

  return patterns.length > 0 ? patterns : ['*']
}

/**
 * Detect package type from path
 */
function detectPackageType(relativePath: string): 'app' | 'lib' | 'package' | 'unknown' {
  const pathLower = relativePath.toLowerCase()

  if (pathLower.startsWith('apps/') || pathLower.includes('/apps/')) return 'app'
  if (pathLower.startsWith('app-') || pathLower.includes('/app-')) return 'app'
  if (pathLower.startsWith('svc-') || pathLower.includes('/svc-')) return 'app'

  if (pathLower.startsWith('libs/') || pathLower.includes('/libs/')) return 'lib'
  if (pathLower.startsWith('lib-') || pathLower.includes('/lib-')) return 'lib'
  if (pathLower.startsWith('libraries/') || pathLower.includes('/libraries/')) return 'lib'

  if (pathLower.startsWith('packages/') || pathLower.includes('/packages/')) return 'package'

  return 'unknown'
}

/**
 * Find .env files in a directory
 */
function findEnvFiles(dir: string): string[] {
  const envFiles: string[] = []

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.startsWith('.env') || entry.name.endsWith('.env'))) {
        envFiles.push(entry.name)
      }
    }

    // Also check deploy/configs and deploy/secrets (apps-lair pattern)
    const deployConfigs = path.join(dir, 'deploy', 'configs')
    const deploySecrets = path.join(dir, 'deploy', 'secrets')

    if (fs.existsSync(deployConfigs)) {
      const configFiles = fs.readdirSync(deployConfigs).filter(f => f.endsWith('.env'))
      envFiles.push(...configFiles.map(f => `deploy/configs/${f}`))
    }

    if (fs.existsSync(deploySecrets)) {
      const secretFiles = fs.readdirSync(deploySecrets).filter(f => f.endsWith('.env'))
      envFiles.push(...secretFiles.map(f => `deploy/secrets/${f}`))
    }
  } catch {
    // Permission denied or other errors
  }

  return envFiles
}

/**
 * Scan monorepo for packages
 */
export async function scanMonorepo(rootDir: string = process.cwd()): Promise<ScanResult> {
  const monorepo = detectMonorepoTool(rootDir)
  const packages: PackageInfo[] = []

  // Expand glob patterns to find packages
  const matchedPaths = new Set<string>()

  for (const pattern of monorepo.workspacePatterns) {
    // Handle direct paths (Rush style)
    if (!pattern.includes('*') && !pattern.includes('!')) {
      const fullPath = path.join(monorepo.root, pattern)
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        matchedPaths.add(fullPath)
      }
      continue
    }

    // Use glob for patterns
    try {
      const matches = await glob(pattern, {
        cwd: monorepo.root,
        onlyDirectories: true,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
      })

      for (const match of matches) {
        matchedPaths.add(match)
      }
    } catch {
      // Glob error, skip
    }
  }

  // Analyze each matched path
  for (const pkgPath of matchedPaths) {
    const relativePath = path.relative(monorepo.root, pkgPath)
    const pkgJsonPath = path.join(pkgPath, 'package.json')
    const hasPackageJson = fs.existsSync(pkgJsonPath)

    // Get package name from package.json or directory name
    let name = path.basename(pkgPath)
    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
        name = pkg.name || name
      } catch {
        // Use directory name
      }
    }

    const envFiles = findEnvFiles(pkgPath)
    const hasDeployDir = fs.existsSync(path.join(pkgPath, 'deploy'))
    const hasVaulterConfig = fs.existsSync(path.join(pkgPath, '.vaulter', 'config.yaml'))

    packages.push({
      name,
      path: pkgPath,
      relativePath,
      hasPackageJson,
      hasEnvFiles: envFiles,
      hasDeployDir,
      hasVaulterConfig,
      type: detectPackageType(relativePath)
    })
  }

  // Sort by path
  packages.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  return {
    monorepo,
    packages,
    initialized: packages.filter(p => p.hasVaulterConfig),
    uninitialized: packages.filter(p => !p.hasVaulterConfig),
    withEnvFiles: packages.filter(p => p.hasEnvFiles.length > 0)
  }
}

/**
 * Format scan result for display
 */
export function formatScanResult(result: ScanResult): string {
  const lines: string[] = []

  // Header
  lines.push(`Monorepo: ${result.monorepo.tool.toUpperCase()}`)
  lines.push(`Root: ${result.monorepo.root}`)
  if (result.monorepo.configFile) {
    lines.push(`Config: ${path.basename(result.monorepo.configFile)}`)
  }
  lines.push(`Patterns: ${result.monorepo.workspacePatterns.join(', ')}`)
  lines.push('')

  // Summary
  lines.push(`Found ${result.packages.length} package(s):`)
  lines.push(`  ✓ Vaulter initialized: ${result.initialized.length}`)
  lines.push(`  ○ Not initialized: ${result.uninitialized.length}`)
  lines.push(`  📄 With .env files: ${result.withEnvFiles.length}`)
  lines.push('')

  // Uninitialized packages (priority)
  if (result.uninitialized.length > 0) {
    lines.push('Packages needing vaulter init:')
    for (const pkg of result.uninitialized) {
      const envInfo = pkg.hasEnvFiles.length > 0 ? ` (has ${pkg.hasEnvFiles.length} .env files)` : ''
      const deployInfo = pkg.hasDeployDir ? ' [deploy/]' : ''
      lines.push(`  ○ ${pkg.relativePath}${envInfo}${deployInfo}`)
    }
    lines.push('')
  }

  // Initialized packages
  if (result.initialized.length > 0) {
    lines.push('Already initialized:')
    for (const pkg of result.initialized) {
      lines.push(`  ✓ ${pkg.relativePath}`)
    }
  }

  return lines.join('\n')
}
