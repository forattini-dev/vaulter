/**
 * Vaulter Output Generator
 *
 * Generates .env files in apps from local .vaulter/{env}/ files.
 *
 * For each output target:
 *   output.env = shared (configs + secrets) + service-specific (configs + secrets)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { VaulterConfig, Environment } from '../types.js'
import { loadFlat } from './fs-store.js'

// =============================================================================
// Types
// =============================================================================

export interface OutputTarget {
  name: string
  path: string
  filename: string
  service?: string
}

export interface OutputResult {
  target: string
  path: string
  varsCount: number
  vars: Record<string, string>
}

export interface GenerateOutputsOptions {
  vaulterDir: string
  projectRoot: string
  config: VaulterConfig
  env: Environment
  targets?: string[]  // specific targets, or all if undefined
  dryRun?: boolean
}

export interface GenerateOutputsResult {
  outputs: OutputResult[]
  errors: string[]
}

// =============================================================================
// Config Parsing
// =============================================================================

/**
 * Normalize output targets from config
 */
export function normalizeOutputTargets(config: VaulterConfig): OutputTarget[] {
  const outputs = config.outputs
  if (!outputs) return []

  return Object.entries(outputs).map(([name, input]) => {
    if (typeof input === 'string') {
      return {
        name,
        path: input,
        filename: '.env',
        service: undefined
      }
    }

    return {
      name,
      path: input.path,
      filename: input.filename || (input as any).file || '.env',
      service: input.service
    }
  })
}

// =============================================================================
// Output Generation
// =============================================================================

/**
 * Format vars as .env content
 */
function formatEnvContent(vars: Record<string, string>): string {
  const lines: string[] = []
  const sortedKeys = Object.keys(vars).sort()

  for (const key of sortedKeys) {
    const value = vars[key]

    const needsQuotes =
      value.includes('\n') ||
      value.includes(' ') ||
      value.includes('#') ||
      value.includes('"') ||
      value.includes("'")

    if (needsQuotes) {
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
      lines.push(`${key}="${escaped}"`)
    } else {
      lines.push(`${key}=${value}`)
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Generate .env files for all output targets
 */
function resolveFilename(filename: string, env: Environment): string {
  return filename.replace('{env}', env)
}

export function generateOutputs(options: GenerateOutputsOptions): GenerateOutputsResult {
  const { vaulterDir, projectRoot, config, env, targets: targetNames, dryRun = false } = options

  const allTargets = normalizeOutputTargets(config)
  const result: GenerateOutputsResult = {
    outputs: [],
    errors: []
  }

  // Filter targets if specific ones requested
  const targets = targetNames
    ? allTargets.filter(t => targetNames.includes(t.name))
    : allTargets

  if (targets.length === 0) {
    result.errors.push('No output targets found')
    return result
  }

  for (const target of targets) {
    try {
      // Load merged vars (shared + service-specific)
      const vars = loadFlat(vaulterDir, env, target.service)

      if (Object.keys(vars).length === 0) {
        result.errors.push(`No variables found for ${target.name} (env: ${env})`)
        continue
      }

      const resolvedFilename = resolveFilename(target.filename, env)
      const outputPath = join(projectRoot, target.path, resolvedFilename)

      if (!dryRun) {
        mkdirSync(dirname(outputPath), { recursive: true })
        const content = formatEnvContent(vars)
        writeFileSync(outputPath, content, 'utf-8')
      }

      result.outputs.push({
        target: target.name,
        path: outputPath,
        varsCount: Object.keys(vars).length,
        vars
      })
    } catch (error) {
      result.errors.push(`Error generating ${target.name}: ${(error as Error).message}`)
    }
  }

  return result
}

/**
 * Generate output for a single target
 */
export function generateOutput(
  vaulterDir: string,
  projectRoot: string,
  target: OutputTarget,
  env: Environment,
  dryRun = false
): OutputResult {
  const vars = loadFlat(vaulterDir, env, target.service)
  const outputPath = join(projectRoot, target.path, resolveFilename(target.filename, env))

  if (!dryRun) {
    mkdirSync(dirname(outputPath), { recursive: true })
    const content = formatEnvContent(vars)
    writeFileSync(outputPath, content, 'utf-8')
  }

  return {
    target: target.name,
    path: outputPath,
    varsCount: Object.keys(vars).length,
    vars
  }
}
