/**
 * Vaulter MCP Tools - Analysis Handlers
 *
 * Handlers for compare, search, scan, services operations
 */

import { VaulterClient } from '../../../client.js'
import { getValidEnvironments } from '../../../lib/config-loader.js'
import { discoverServices } from '../../../lib/monorepo.js'
import { scanMonorepo, formatScanResult } from '../../../lib/monorepo-detect.js'
import type { VaulterConfig, Environment } from '../../../types.js'
import { DEFAULT_ENVIRONMENTS } from '../../../types.js'
import type { ToolResponse } from '../config.js'

export async function handleCompareCall(
  client: VaulterClient,
  project: string,
  service: string | undefined,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const source = args.source as Environment
  const target = args.target as Environment
  const showValues = args.showValues as boolean || false

  const [sourceVars, targetVars] = await Promise.all([
    client.export(project, source, service),
    client.export(project, target, service)
  ])

  const sourceKeys = new Set(Object.keys(sourceVars))
  const targetKeys = new Set(Object.keys(targetVars))

  const onlyInSource: string[] = []
  const onlyInTarget: string[] = []
  const different: string[] = []
  const same: string[] = []

  for (const key of sourceKeys) {
    if (!targetKeys.has(key)) {
      onlyInSource.push(key)
    } else if (sourceVars[key] !== targetVars[key]) {
      different.push(key)
    } else {
      same.push(key)
    }
  }

  for (const key of targetKeys) {
    if (!sourceKeys.has(key)) {
      onlyInTarget.push(key)
    }
  }

  const lines = [`Comparing ${project}: ${source} → ${target}\n`]

  if (onlyInSource.length > 0) {
    lines.push(`Only in ${source} (${onlyInSource.length}):`)
    for (const key of onlyInSource) {
      lines.push(showValues ? `  - ${key}=${sourceVars[key]}` : `  - ${key}`)
    }
    lines.push('')
  }

  if (onlyInTarget.length > 0) {
    lines.push(`Only in ${target} (${onlyInTarget.length}):`)
    for (const key of onlyInTarget) {
      lines.push(showValues ? `  + ${key}=${targetVars[key]}` : `  + ${key}`)
    }
    lines.push('')
  }

  if (different.length > 0) {
    lines.push(`Different values (${different.length}):`)
    for (const key of different) {
      if (showValues) {
        lines.push(`  ~ ${key}:`)
        lines.push(`      ${source}: ${sourceVars[key]}`)
        lines.push(`      ${target}: ${targetVars[key]}`)
      } else {
        lines.push(`  ~ ${key}`)
      }
    }
    lines.push('')
  }

  lines.push(`Summary: ${same.length} identical, ${different.length} different, ${onlyInSource.length} only in ${source}, ${onlyInTarget.length} only in ${target}`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

export async function handleSearchCall(
  client: VaulterClient,
  project: string,
  service: string | undefined,
  args: Record<string, unknown>,
  config: VaulterConfig | null
): Promise<ToolResponse> {
  const pattern = args.pattern as string
  // Use args.environments, config environments, or default
  const environments = (args.environments as string[]) || (config ? getValidEnvironments(config) : DEFAULT_ENVIRONMENTS)

  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i')
  const results: Array<{ env: string; key: string; found: boolean }> = []

  for (const env of environments) {
    try {
      const vars = await client.list({ project, environment: env, service })
      for (const v of vars) {
        if (regex.test(v.key)) {
          results.push({ env, key: v.key, found: true })
        }
      }
    } catch {
      // Environment might not exist
    }
  }

  if (results.length === 0) {
    return { content: [{ type: 'text', text: `No variables matching "${pattern}" found in any environment` }] }
  }

  // Group by key
  const byKey = new Map<string, string[]>()
  for (const r of results) {
    const envs = byKey.get(r.key) || []
    envs.push(r.env)
    byKey.set(r.key, envs)
  }

  const lines = [`Search results for "${pattern}":\n`]
  for (const [key, envs] of byKey) {
    lines.push(`  ${key}: [${envs.join(', ')}]`)
  }
  lines.push(`\nFound ${byKey.size} unique variable(s) across ${environments.length} environment(s)`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

export async function handleScanCall(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const scanPath = (args.path as string) || process.cwd()
  const format = (args.format as string) || 'text'

  try {
    const result = await scanMonorepo(scanPath)

    if (format === 'json') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            monorepo: {
              tool: result.monorepo.tool,
              root: result.monorepo.root,
              configFile: result.monorepo.configFile,
              workspacePatterns: result.monorepo.workspacePatterns
            },
            summary: {
              total: result.packages.length,
              initialized: result.initialized.length,
              uninitialized: result.uninitialized.length,
              withEnvFiles: result.withEnvFiles.length
            },
            packages: result.packages.map(p => ({
              name: p.name,
              path: p.relativePath,
              type: p.type,
              hasVaulterConfig: p.hasVaulterConfig,
              hasEnvFiles: p.hasEnvFiles,
              hasDeployDir: p.hasDeployDir
            }))
          }, null, 2)
        }]
      }
    }

    // Text format
    return { content: [{ type: 'text', text: formatScanResult(result) }] }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error scanning monorepo: ${(error as Error).message}`
      }]
    }
  }
}

export async function handleServicesCall(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const detailed = args.detailed as boolean || false

  try {
    const services = await discoverServices()

    if (services.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No services found. Run from a monorepo root with .vaulter directories in subdirectories.'
        }]
      }
    }

    const lines = [`Discovered ${services.length} service(s):\n`]

    for (const svc of services) {
      if (detailed) {
        lines.push(`${svc.name}:`)
        lines.push(`  Path: ${svc.path}`)
        lines.push(`  Project: ${svc.config.project || '(inherit)'}`)
        if (svc.config.environments) {
          lines.push(`  Environments: ${svc.config.environments.join(', ')}`)
        }
        lines.push('')
      } else {
        lines.push(`  - ${svc.name}`)
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error discovering services: ${(error as Error).message}`
      }]
    }
  }
}
