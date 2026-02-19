/**
 * vaulter_services handler — discover and list monorepo services
 *
 * Delegates to lib/monorepo.ts.
 */

import type { ToolResponse } from '../config.js'
import { textResponse } from '../config.js'
import {
  discoverServicesWithFallback,
  formatServiceList
} from '../../../lib/monorepo.js'
import { loadConfig } from '../../../lib/config-loader.js'
import path from 'node:path'

export function handleServices(args: Record<string, unknown>): ToolResponse {
  const rootPath = (args.path as string) || process.cwd()
  const detailed = args.detailed === true

  let config
  try {
    config = loadConfig(rootPath)
  } catch {
    return textResponse('No vaulter configuration found. Run vaulter init first.')
  }

  const services = discoverServicesWithFallback(config, rootPath)

  if (!detailed) {
    return textResponse(formatServiceList(services))
  }

  if (services.length === 0) {
    return textResponse('No services found in this directory.')
  }

  const lines = [`Services (${services.length}):`, '']
  for (const svc of services) {
    const relativePath = path.relative(process.cwd(), svc.path)
    lines.push(`  ${svc.name}`)
    lines.push(`    Path: ${relativePath || '.'}`)
    lines.push(`    Config: ${path.relative(process.cwd(), svc.configDir)}`)
    if (svc.config.project) lines.push(`    Project: ${svc.config.project}`)
    lines.push('')
  }

  return textResponse(lines.join('\n'))
}
