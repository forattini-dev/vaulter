/**
 * Vaulter CLI - Init Command
 *
 * Initialize a new .vaulter configuration in the current directory
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, VaulterConfig } from '../../types.js'
import { createDefaultConfig, configExists, findConfigDir } from '../../lib/config-loader.js'

interface InitContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

/**
 * Run the init command
 */
export async function runInit(context: InitContext): Promise<void> {
  const { args, verbose, dryRun, jsonOutput } = context
  const splitMode = args.split || false
  const splitDirectories = {
    mode: 'split' as const,
    configs: 'deploy/configs',
    secrets: 'deploy/secrets'
  }

  // Check if already initialized
  if (configExists()) {
    const existingDir = findConfigDir()
    if (!args.force) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: 'already_initialized', path: existingDir }))
      } else {
        console.error(`Vaulter already initialized at ${existingDir}`)
        console.error('Use --force to reinitialize')
      }
      process.exit(1)
    }
  }

  // Determine project name
  const projectName = args.project || args.p || path.basename(process.cwd())

  // Config directory path
  const configDir = path.join(process.cwd(), '.vaulter')

  if (verbose) {
    console.log(`Initializing vaulter for project: ${projectName}`)
    console.log(`Config directory: ${configDir}`)
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        action: 'init',
        project: projectName,
        configDir,
        splitMode,
        dryRun: true
      }))
    } else {
      console.log('Dry run - would create:')
      console.log(`  ${configDir}/config.yaml`)
      if (splitMode) {
        console.log(`  ${splitDirectories.configs}/`)
        console.log(`  ${splitDirectories.secrets}/`)
      } else {
        console.log(`  ${configDir}/environments/`)
      }
    }
    return
  }

  // Create configuration
  createDefaultConfig(configDir, projectName, splitMode ? { directories: splitDirectories } : {})

  // Create .gitignore for sensitive files
  const gitignorePath = path.join(configDir, '.gitignore')
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `# Vaulter sensitive files
.key
*.key
*.pem
`)
  }

  // Create placeholder environment files
  const environments = ['dev', 'stg', 'prd', 'sbx', 'dr']

  if (splitMode) {
    const baseDir = path.dirname(configDir)
    const configsDir = path.join(baseDir, splitDirectories.configs)
    const secretsDir = path.join(baseDir, splitDirectories.secrets)

    if (!fs.existsSync(configsDir)) {
      fs.mkdirSync(configsDir, { recursive: true })
    }
    if (!fs.existsSync(secretsDir)) {
      fs.mkdirSync(secretsDir, { recursive: true })
    }

    const secretsGitignore = path.join(secretsDir, '.gitignore')
    if (!fs.existsSync(secretsGitignore)) {
      fs.writeFileSync(secretsGitignore, `# Vaulter secrets (do not commit)
*
!.gitignore
`)
    }

    for (const env of environments) {
      const configsFile = path.join(configsDir, `${env}.env`)
      if (!fs.existsSync(configsFile)) {
        fs.writeFileSync(configsFile, `# ${env.toUpperCase()} Config Variables
# Non-sensitive config values for ${env}
# Example: NODE_ENV=${env}
`)
      }

      const secretsFile = path.join(secretsDir, `${env}.env`)
      if (!fs.existsSync(secretsFile)) {
        fs.writeFileSync(secretsFile, `# ${env.toUpperCase()} Secret Variables
# Sensitive values for ${env} (gitignored)
# Example: DATABASE_URL=postgres://localhost/${env}_db
`)
      }
    }
  } else {
    const envDir = path.join(configDir, 'environments')

    for (const env of environments) {
      const envFile = path.join(envDir, `${env}.env`)
      if (!fs.existsSync(envFile)) {
        fs.writeFileSync(envFile, `# ${env.toUpperCase()} Environment Variables
# Add your ${env} environment variables here
# Example: DATABASE_URL=postgres://localhost/${env}_db
`)
      }
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({
      success: true,
      project: projectName,
      configDir,
      splitMode,
      files: [
        'config.yaml',
        '.gitignore',
        ...(splitMode
          ? [
              `${splitDirectories.secrets}/.gitignore`,
              ...environments.map(e => `${splitDirectories.configs}/${e}.env`),
              ...environments.map(e => `${splitDirectories.secrets}/${e}.env`)
            ]
          : environments.map(e => `environments/${e}.env`))
      ]
    }))
  } else {
    console.log(`✓ Initialized vaulter for project: ${projectName}`)
    console.log(`  Config: ${configDir}/config.yaml`)
    if (splitMode) {
      console.log(`  Configs: ${splitDirectories.configs}/`)
      console.log(`  Secrets: ${splitDirectories.secrets}/`)
    } else {
      console.log(`  Environments: ${path.join(configDir, 'environments')}/`)
    }
    console.log('')
    console.log('Next steps:')
    console.log('  1. Edit .vaulter/config.yaml to configure your backend')
    if (splitMode) {
      console.log('  2. Add non-sensitive vars to deploy/configs/*.env')
      console.log('  3. Add secrets to deploy/secrets/*.env')
      console.log('  4. Run "vaulter sync -e dev" to sync with backend')
    } else {
      console.log('  2. Add environment variables to .vaulter/environments/*.env')
      console.log('  3. Run "vaulter sync -e dev" to sync with backend')
    }
  }
}
