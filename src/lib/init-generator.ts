/**
 * Vaulter Init Generator
 *
 * Shared module for generating vaulter project structure.
 * Used by both CLI and MCP init commands.
 *
 * Generates the recommended structure:
 *
 * Single repo:
 * .vaulter/
 * ├── config.yaml
 * ├── local/
 * │   ├── .env              # Local dev vars (gitignored)
 * │   └── .env.example      # Template (committed)
 * └── deploy/
 *     ├── configs/{env}.env # Non-secrets (committed)
 *     └── secrets/          # Pulled from backend in CI/CD
 *
 * Monorepo:
 * .vaulter/
 * ├── config.yaml
 * ├── local/
 * │   ├── shared.env           # Shared local vars
 * │   ├── shared.env.example   # Template
 * │   └── services/            # Per-service overrides
 * └── deploy/
 *     └── shared/
 *         ├── configs/{env}.env
 *         └── secrets/{env}.env
 */

import fs from 'node:fs'
import path from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default environments for new projects */
export const DEFAULT_ENVIRONMENTS = ['dev', 'sdx', 'prd']

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface InitOptions {
  /** Project name */
  projectName: string
  /** Whether this is a monorepo */
  isMonorepo: boolean
  /** Environments to create */
  environments: string[]
  /** Backend URL */
  backend?: string
  /** Services pattern for monorepo (e.g., "apps/*") */
  servicesPattern?: string
  /** Force overwrite existing files */
  force?: boolean
  /** Dry run - don't write files */
  dryRun?: boolean
}

export interface InitResult {
  /** Whether initialization was successful */
  success: boolean
  /** Project name */
  projectName: string
  /** Mode (single-repo or monorepo) */
  mode: 'single-repo' | 'monorepo'
  /** Detected monorepo tool (if any) */
  detectedTool?: string
  /** List of created files (relative paths) */
  createdFiles: string[]
  /** Path to config.yaml */
  configPath: string
}

export interface MonorepoDetection {
  isMonorepo: boolean
  tool?: string
  servicesPattern?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Monorepo Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect if current directory is a monorepo
 */
export function detectMonorepo(baseDir: string = process.cwd()): MonorepoDetection {
  // Check for NX
  if (fs.existsSync(path.join(baseDir, 'nx.json'))) {
    return { isMonorepo: true, tool: 'nx', servicesPattern: 'apps/*' }
  }

  // Check for Turborepo
  if (fs.existsSync(path.join(baseDir, 'turbo.json'))) {
    return { isMonorepo: true, tool: 'turborepo', servicesPattern: 'apps/*' }
  }

  // Check for pnpm workspaces
  if (fs.existsSync(path.join(baseDir, 'pnpm-workspace.yaml'))) {
    return { isMonorepo: true, tool: 'pnpm', servicesPattern: 'packages/*' }
  }

  // Check for Lerna
  if (fs.existsSync(path.join(baseDir, 'lerna.json'))) {
    return { isMonorepo: true, tool: 'lerna', servicesPattern: 'packages/*' }
  }

  // Check for Yarn workspaces in package.json
  const pkgPath = path.join(baseDir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      if (pkg.workspaces) {
        return { isMonorepo: true, tool: 'yarn', servicesPattern: 'packages/*' }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return { isMonorepo: false }
}

// ─────────────────────────────────────────────────────────────────────────────
// File Writers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create directory if it doesn't exist
 */
function ensureDir(dirPath: string, dryRun: boolean): void {
  if (dryRun) return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Write file if it doesn't exist (or force)
 */
function writeFile(filePath: string, content: string, dryRun: boolean, force: boolean = false): boolean {
  if (dryRun) return true
  if (fs.existsSync(filePath) && !force) return false
  fs.writeFileSync(filePath, content)
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Generators
// ─────────────────────────────────────────────────────────────────────────────

function generateLocalSharedEnv(): string {
  return `# =============================================================================
# SHARED ENVIRONMENT VARIABLES - LOCAL DEVELOPMENT
# =============================================================================
# This file is NOT committed - contains real secrets!
# Copy from shared.env.example and fill in your values.
# =============================================================================

# ============================================
# GENERAL
# ============================================
NODE_ENV=development
LOG_LEVEL=debug

# ============================================
# DATABASE
# ============================================
# DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# ============================================
# AUTH & JWT
# ============================================
# JWT_SECRET=your-dev-secret-key

# ============================================
# EXTERNAL SERVICES
# ============================================
# Add your API keys here
`
}

function generateLocalSharedEnvExample(): string {
  return `# =============================================================================
# SHARED ENVIRONMENT VARIABLES - TEMPLATE
# =============================================================================
# Copy this file to shared.env and fill in your values:
#   cp shared.env.example shared.env
# =============================================================================

# ============================================
# GENERAL
# ============================================
NODE_ENV=development
LOG_LEVEL=debug

# ============================================
# DATABASE
# ============================================
DATABASE_URL=postgres://user:password@localhost:5432/dbname

# ============================================
# AUTH & JWT
# ============================================
JWT_SECRET=replace-with-your-secret
JWT_ACCESS_TOKEN_EXPIRES_IN=15m
JWT_REFRESH_TOKEN_EXPIRES_IN=7d

# ============================================
# EXTERNAL SERVICES
# ============================================
# STRIPE_SECRET_KEY=sk_test_xxx
# GITHUB_TOKEN=ghp_xxx
`
}

function generateLocalEnv(): string {
  return `# =============================================================================
# LOCAL DEVELOPMENT ENVIRONMENT
# =============================================================================
# This file is NOT committed - contains your local secrets!
# Copy from .env.example and fill in your values.
# =============================================================================

NODE_ENV=development
LOG_LEVEL=debug

# DATABASE_URL=postgres://user:pass@localhost:5432/mydb
# JWT_SECRET=your-dev-secret-key
`
}

function generateLocalEnvExample(): string {
  return `# =============================================================================
# LOCAL DEVELOPMENT - TEMPLATE
# =============================================================================
# Copy this file to .env and fill in your values:
#   cp .env.example .env
# =============================================================================

NODE_ENV=development
LOG_LEVEL=debug

DATABASE_URL=postgres://user:password@localhost:5432/dbname
JWT_SECRET=replace-with-your-secret
`
}

function generateDeployConfigEnv(env: string, isMonorepo: boolean): string {
  const envUpper = env.toUpperCase()
  const secretsPath = isMonorepo
    ? `deploy/shared/secrets/${env}.env`
    : `deploy/secrets/${env}.env`

  return `# =============================================================================
# ${isMonorepo ? 'SHARED ' : ''}CONFIGS - ${envUpper} ENVIRONMENT
# =============================================================================
# Non-sensitive configuration${isMonorepo ? ' shared by all services' : ''} in ${envUpper}.
# This file IS committed to the repository.
#
# For secrets, use: ${secretsPath} (pulled from backend)
# =============================================================================

# ============================================
# ENVIRONMENT
# ============================================
NODE_ENV=${env === 'prd' ? 'production' : 'development'}
LOG_LEVEL=${env === 'prd' ? 'info' : 'debug'}

# ============================================
# SERVICE URLS
# ============================================
# Add your service URLs here (internal K8s DNS, external URLs, etc.)
# Example:
# API_URL=https://api.${env}.example.com
`
}

function generateSecretsGitignore(): string {
  return `# Secrets are pulled from backend - never commit!
*
!.gitignore
`
}

function generateVaulterGitignore(isMonorepo: boolean): string {
  if (isMonorepo) {
    return `# Vaulter - Gitignore
# =============================================================================

# Local development secrets (never commit!)
local/shared.env
local/services/*.env
!local/*.env.example

# Deploy secrets (pulled from backend in CI/CD)
deploy/shared/secrets/*.env
deploy/services/*/secrets/*.env

# Encryption keys
*.key
*.pem
.key
`
  }

  return `# Vaulter - Gitignore
# =============================================================================

# Local development secrets (never commit!)
local/.env
local/*.env
!local/.env.example

# Deploy secrets (pulled from backend in CI/CD)
deploy/secrets/*.env

# Encryption keys
*.key
*.pem
.key
`
}

function generateConfigYaml(options: InitOptions): string {
  const { projectName, isMonorepo, environments, backend, servicesPattern } = options

  const envList = environments.map(e => `  - ${e}`).join('\n')

  const monorepoSection = isMonorepo ? `
# =============================================================================
# MONOREPO CONFIGURATION
# =============================================================================
monorepo:
  root: .
  services_pattern: "${servicesPattern || 'apps/*'}"
` : ''

  const localSection = isMonorepo ? `
# =============================================================================
# LOCAL DEVELOPMENT
# =============================================================================
# Files for running services locally on developer machine
local:
  # Shared vars for all local services
  shared: .vaulter/local/shared.env           # Secrets+configs (NOT committed)
  shared_example: .vaulter/local/shared.env.example  # Template (committed)

  # Per-service overrides (optional)
  # Pattern: .vaulter/local/services/{service}.env
` : `
# =============================================================================
# LOCAL DEVELOPMENT
# =============================================================================
local:
  file: .vaulter/local/.env           # Secrets+configs (NOT committed)
  example: .vaulter/local/.env.example # Template (committed)
`

  const deploySection = isMonorepo ? `
# =============================================================================
# DEPLOYED ENVIRONMENTS (CI/CD → K8s)
# =============================================================================
# Files generated/used in deploy pipeline
deploy:
  # Shared vars for all services in the environment
  shared:
    configs: .vaulter/deploy/shared/configs/{env}.env   # Committed (URLs, ports)
    secrets: .vaulter/deploy/shared/secrets/{env}.env   # Generated in CI/CD

  # Per-service configs/secrets (optional)
  services:
    configs: .vaulter/deploy/services/{service}/configs/{env}.env  # Committed
    secrets: .vaulter/deploy/services/{service}/secrets/{env}.env  # Generated
` : `
# =============================================================================
# DEPLOYED ENVIRONMENTS (CI/CD)
# =============================================================================
deploy:
  configs: .vaulter/deploy/configs/{env}.env   # Committed (non-sensitive)
  secrets: .vaulter/deploy/secrets/{env}.env   # Generated in CI/CD
`

  const backendUrl = backend || `file://\${HOME}/.vaulter/projects/${projectName}/store`

  return `# =============================================================================
# Vaulter Configuration
# =============================================================================
# https://github.com/forattini-dev/vaulter

version: "1"
project: ${projectName}
default_environment: dev

environments:
${envList}

# =============================================================================
# BACKEND CONFIGURATION
# =============================================================================
# SECURITY: Use environment variables for credentials!
# Supports: \${VAR}, \${VAR:-default}, $VAR
backend:
  # AWS S3 (recommended for production)
  # url: s3://bucket/envs?region=us-east-1

  # Local filesystem (development)
  url: ${backendUrl}
${monorepoSection}${localSection}${deploySection}
# =============================================================================
# ENCRYPTION
# =============================================================================
encryption:
  key_source:
    - env: VAULTER_KEY        # 1. Environment variable
    - file: .vaulter/.key     # 2. Local file (gitignored)

# =============================================================================
# SYNC BEHAVIOR
# =============================================================================
sync:
  conflict: local  # local | remote | error

# =============================================================================
# SECURITY
# =============================================================================
security:
  confirm_production: true
  auto_encrypt:
    patterns:
      - "*_KEY"
      - "*_SECRET"
      - "*_TOKEN"
      - "*_PASSWORD"
      - "DATABASE_URL"
`
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the vaulter project structure
 */
export function generateVaulterStructure(baseDir: string, options: InitOptions): InitResult {
  const { projectName, isMonorepo, environments, dryRun = false, force = false } = options
  const createdFiles: string[] = []

  const vaulterDir = path.join(baseDir, '.vaulter')
  const localDir = path.join(vaulterDir, 'local')
  const deployDir = path.join(vaulterDir, 'deploy')

  // Create base directories
  ensureDir(vaulterDir, dryRun)
  ensureDir(localDir, dryRun)
  ensureDir(deployDir, dryRun)

  if (isMonorepo) {
    // Monorepo structure
    const servicesDir = path.join(localDir, 'services')
    const sharedConfigsDir = path.join(deployDir, 'shared', 'configs')
    const sharedSecretsDir = path.join(deployDir, 'shared', 'secrets')

    ensureDir(servicesDir, dryRun)
    ensureDir(sharedConfigsDir, dryRun)
    ensureDir(sharedSecretsDir, dryRun)

    // local/shared.env
    if (writeFile(path.join(localDir, 'shared.env'), generateLocalSharedEnv(), dryRun, force)) {
      createdFiles.push('.vaulter/local/shared.env')
    }

    // local/shared.env.example
    if (writeFile(path.join(localDir, 'shared.env.example'), generateLocalSharedEnvExample(), dryRun, force)) {
      createdFiles.push('.vaulter/local/shared.env.example')
    }

    // local/services/.gitkeep
    if (writeFile(path.join(servicesDir, '.gitkeep'), '', dryRun, force)) {
      createdFiles.push('.vaulter/local/services/.gitkeep')
    }

    // deploy/shared/configs/{env}.env
    for (const env of environments) {
      if (writeFile(path.join(sharedConfigsDir, `${env}.env`), generateDeployConfigEnv(env, true), dryRun, force)) {
        createdFiles.push(`.vaulter/deploy/shared/configs/${env}.env`)
      }
    }

    // deploy/shared/secrets/.gitignore
    if (writeFile(path.join(sharedSecretsDir, '.gitignore'), generateSecretsGitignore(), dryRun, force)) {
      createdFiles.push('.vaulter/deploy/shared/secrets/.gitignore')
    }
  } else {
    // Single repo structure
    const configsDir = path.join(deployDir, 'configs')
    const secretsDir = path.join(deployDir, 'secrets')

    ensureDir(configsDir, dryRun)
    ensureDir(secretsDir, dryRun)

    // local/.env
    if (writeFile(path.join(localDir, '.env'), generateLocalEnv(), dryRun, force)) {
      createdFiles.push('.vaulter/local/.env')
    }

    // local/.env.example
    if (writeFile(path.join(localDir, '.env.example'), generateLocalEnvExample(), dryRun, force)) {
      createdFiles.push('.vaulter/local/.env.example')
    }

    // deploy/configs/{env}.env
    for (const env of environments) {
      if (writeFile(path.join(configsDir, `${env}.env`), generateDeployConfigEnv(env, false), dryRun, force)) {
        createdFiles.push(`.vaulter/deploy/configs/${env}.env`)
      }
    }

    // deploy/secrets/.gitignore
    if (writeFile(path.join(secretsDir, '.gitignore'), generateSecretsGitignore(), dryRun, force)) {
      createdFiles.push('.vaulter/deploy/secrets/.gitignore')
    }
  }

  // .vaulter/.gitignore
  if (writeFile(path.join(vaulterDir, '.gitignore'), generateVaulterGitignore(isMonorepo), dryRun, force)) {
    createdFiles.push('.vaulter/.gitignore')
  }

  // config.yaml
  const configPath = path.join(vaulterDir, 'config.yaml')
  if (writeFile(configPath, generateConfigYaml(options), dryRun, force)) {
    createdFiles.unshift('.vaulter/config.yaml')
  }

  return {
    success: true,
    projectName,
    mode: isMonorepo ? 'monorepo' : 'single-repo',
    createdFiles,
    configPath
  }
}

/**
 * Get default project name from directory
 */
export function getDefaultProjectName(baseDir: string = process.cwd()): string {
  return path.basename(baseDir)
}
