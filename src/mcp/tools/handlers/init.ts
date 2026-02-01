/**
 * Vaulter MCP Tools - Init Handler
 *
 * Handles vaulter_init tool using the shared init-generator module
 */

import { configExists } from '../../../lib/config-loader.js'
import {
  generateVaulterStructure,
  detectMonorepo,
  getDefaultProjectName,
  DEFAULT_ENVIRONMENTS,
  type InitOptions
} from '../../../lib/init-generator.js'
import type { ToolResponse } from '../config.js'
import { textResponse, errorResponse } from '../config.js'

/**
 * Handle vaulter_init tool call
 */
export async function handleInitCall(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  // Check if already initialized
  if (configExists()) {
    return errorResponse('Vaulter already initialized in this directory. Use a different directory or delete .vaulter/ first.')
  }

  // Determine project name
  const projectName = (args.project as string) || getDefaultProjectName()

  // Detect or force monorepo mode
  const monorepoDetection = detectMonorepo()
  const isMonorepo = (args.monorepo as boolean) || monorepoDetection.isMonorepo
  const servicesPattern = monorepoDetection.servicesPattern

  // Build options
  const options: InitOptions = {
    projectName,
    isMonorepo,
    environments: (args.environments as string[]) || DEFAULT_ENVIRONMENTS,
    backend: args.backend as string | undefined,
    servicesPattern,
    force: false,
    dryRun: false
  }

  // Generate structure
  const result = generateVaulterStructure(process.cwd(), options)

  // Build response
  const lines: string[] = [
    `✓ Initialized vaulter project: ${result.projectName}`,
    ''
  ]

  if (isMonorepo) {
    if (monorepoDetection.tool) {
      lines.push(`  Detected: ${monorepoDetection.tool} monorepo`)
    }
    lines.push('  Mode: monorepo (with services/)')
  } else {
    lines.push('  Mode: single-repo')
  }

  lines.push('')
  lines.push('Created files:')
  for (const file of result.createdFiles.slice(0, 8)) {
    lines.push(`  ${file}`)
  }
  if (result.createdFiles.length > 8) {
    lines.push(`  ... and ${result.createdFiles.length - 8} more`)
  }

  lines.push('')
  lines.push('Next steps:')
  lines.push('')

  if (isMonorepo) {
    lines.push('  1. Edit local secrets in:')
    lines.push('     .vaulter/local/shared/secrets.env')
    lines.push('')
    lines.push('  2. Configure backend in .vaulter/config.yaml')
    lines.push('')
    lines.push('  3. Generate encryption key:')
    lines.push('     vaulter key generate --name master')
    lines.push('')
    lines.push('  4. Run with env vars loaded:')
    lines.push('     vaulter run -s api -- pnpm dev')
  } else {
    lines.push('  1. Edit local secrets in:')
    lines.push('     .vaulter/local/secrets.env')
    lines.push('')
    lines.push('  2. Configure backend in .vaulter/config.yaml')
    lines.push('')
    lines.push('  3. Generate encryption key:')
    lines.push('     vaulter key generate --name master')
    lines.push('')
    lines.push('  4. Run with env vars loaded:')
    lines.push('     vaulter run -- pnpm dev')
  }

  return textResponse(lines.join('\n'))
}
