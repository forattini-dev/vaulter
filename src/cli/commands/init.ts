/**
 * MiniEnv CLI - Init Command
 *
 * Initialize a new .minienv configuration in the current directory
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CLIArgs, MiniEnvConfig } from '../../types.js'
import { createDefaultConfig, configExists, findConfigDir } from '../../lib/config-loader.js'

interface InitContext {
  args: CLIArgs
  config: MiniEnvConfig | null
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

  // Check if already initialized
  if (configExists()) {
    const existingDir = findConfigDir()
    if (!args.force) {
      if (jsonOutput) {
        console.log(JSON.stringify({ error: 'already_initialized', path: existingDir }))
      } else {
        console.error(`MiniEnv already initialized at ${existingDir}`)
        console.error('Use --force to reinitialize')
      }
      process.exit(1)
    }
  }

  // Determine project name
  const projectName = args.project || args.p || path.basename(process.cwd())

  // Config directory path
  const configDir = path.join(process.cwd(), '.minienv')

  if (verbose) {
    console.log(`Initializing minienv for project: ${projectName}`)
    console.log(`Config directory: ${configDir}`)
  }

  if (dryRun) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        action: 'init',
        project: projectName,
        configDir,
        dryRun: true
      }))
    } else {
      console.log('Dry run - would create:')
      console.log(`  ${configDir}/config.yaml`)
      console.log(`  ${configDir}/environments/`)
    }
    return
  }

  // Create configuration
  createDefaultConfig(configDir, projectName)

  // Create .gitignore for sensitive files
  const gitignorePath = path.join(configDir, '.gitignore')
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `# MiniEnv sensitive files
.key
*.key
*.pem
`)
  }

  // Create placeholder environment files
  const envDir = path.join(configDir, 'environments')
  const environments = ['dev', 'stg', 'prd', 'sbx', 'dr']

  for (const env of environments) {
    const envFile = path.join(envDir, `${env}.env`)
    if (!fs.existsSync(envFile)) {
      fs.writeFileSync(envFile, `# ${env.toUpperCase()} Environment Variables
# Add your ${env} environment variables here
# Example: DATABASE_URL=postgres://localhost/${env}_db
`)
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({
      success: true,
      project: projectName,
      configDir,
      files: [
        'config.yaml',
        '.gitignore',
        ...environments.map(e => `environments/${e}.env`)
      ]
    }))
  } else {
    console.log(`✓ Initialized minienv for project: ${projectName}`)
    console.log(`  Config: ${configDir}/config.yaml`)
    console.log(`  Environments: ${envDir}/`)
    console.log('')
    console.log('Next steps:')
    console.log('  1. Edit .minienv/config.yaml to configure your backend')
    console.log('  2. Add environment variables to .minienv/environments/*.env')
    console.log('  3. Run "minienv sync -e dev" to sync with backend')
  }
}
