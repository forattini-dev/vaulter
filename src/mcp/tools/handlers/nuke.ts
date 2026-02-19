/**
 * vaulter_nuke handler — preview what would be deleted
 *
 * MCP only supports preview/dry-run. Actual deletion requires CLI confirmation.
 */

import type { VaulterClient } from '../../../client.js'
import type { ToolResponse } from '../config.js'
import { textResponse } from '../config.js'

export async function handleNuke(client: VaulterClient): Promise<ToolResponse> {
  const preview = await client.nukePreview()

  if (preview.totalVars === 0) {
    return textResponse('Backend is empty. Nothing to delete.')
  }

  const lines = [
    `Nuke preview — would delete:`,
    '',
    `  Project: ${preview.project || 'unknown'}`,
    `  Environments: ${preview.environments.join(', ') || 'none'}`,
    `  Services: ${preview.services.join(', ') || 'none'}`,
    `  Total: ${preview.totalVars} variable(s)`,
  ]

  if (preview.sampleVars.length > 0) {
    lines.push('', '  Sample variables:')
    for (const v of preview.sampleVars) {
      const scope = v.service ? `${v.environment}/${v.service}` : v.environment
      lines.push(`    ${v.key} [${scope}]`)
    }
  }

  lines.push('', 'To execute, use CLI: vaulter nuke --confirm=<project>')

  return textResponse(lines.join('\n'))
}
