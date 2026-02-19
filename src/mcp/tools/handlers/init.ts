/**
 * vaulter_init handler — initialize a vaulter project
 *
 * Delegates to lib/init-generator.ts.
 */

import type { ToolResponse } from '../config.js'
import { textResponse } from '../config.js'
import {
  detectMonorepo,
  generateVaulterStructure,
  getDefaultProjectName
} from '../../../lib/init-generator.js'

export function handleInit(args: Record<string, unknown>): ToolResponse {
  const baseDir = process.cwd()
  const detection = detectMonorepo(baseDir)
  const isMonorepo = (args.monorepo as boolean | undefined) ?? detection.isMonorepo
  const projectName = (args.project as string) || getDefaultProjectName(baseDir)
  const environments = (args.environments as string[]) || ['dev', 'sdx', 'prd']
  const backend = args.backend as string | undefined

  const result = generateVaulterStructure(baseDir, {
    projectName,
    isMonorepo,
    environments,
    backend,
    servicesPattern: detection.servicesPattern
  })

  const lines = [
    `✓ Initialized vaulter project: ${result.projectName}`,
    `  Mode: ${result.mode}${detection.tool ? ` (detected: ${detection.tool})` : ''}`,
    `  Config: ${result.configPath}`,
    ''
  ]

  if (result.createdFiles.length > 0) {
    lines.push('Created files:')
    for (const file of result.createdFiles) {
      lines.push(`  ${file}`)
    }
  }

  return textResponse(lines.join('\n'))
}
