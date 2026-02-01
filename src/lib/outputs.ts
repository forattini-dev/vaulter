/**
 * Output Targets - Framework-agnostic .env file generation
 *
 * Generates .env files for each output target defined in config.
 * Supports include/exclude patterns and shared vars inheritance.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  VaulterConfig,
  OutputTargetInput,
  NormalizedOutputTarget,
  Environment
} from '../types.js'
import { compileGlobPatterns } from './pattern-matcher.js'
import { syncVaulterSection, getUserVarsFromEnvFile } from './env-parser.js'
import type { VaulterClient } from '../client.js'

// ============================================================================
// Output Target Normalization
// ============================================================================

/**
 * Normalize an output target input (string or object) to a full OutputTarget
 */
export function normalizeOutputTarget(
  name: string,
  input: OutputTargetInput,
  environment: Environment
): NormalizedOutputTarget {
  // Shorthand: string = just the path
  if (typeof input === 'string') {
    return {
      name,
      path: input,
      filename: '.env',
      service: undefined,
      include: [],
      exclude: [],
      inherit: true
    }
  }

  // Full object
  // Support both 'filename' and 'file' for convenience
  let filename = input.filename || (input as unknown as { file?: string }).file || '.env'

  // Replace {env} placeholder
  filename = filename.replace(/\{env\}/g, environment)

  return {
    name,
    path: input.path,
    filename,
    service: input.service,
    include: input.include || [],
    exclude: input.exclude || [],
    inherit: input.inherit !== false // Default true
  }
}

/**
 * Normalize all output targets from config
 */
export function normalizeOutputTargets(
  config: VaulterConfig,
  environment: Environment
): NormalizedOutputTarget[] {
  const outputs = config.outputs
  if (!outputs) return []

  return Object.entries(outputs).map(([name, input]) =>
    normalizeOutputTarget(name, input, environment)
  )
}

// ============================================================================
// Variable Filtering
// ============================================================================

/**
 * Filter variables by include/exclude patterns
 *
 * Algorithm:
 * 1. If include is empty, include all vars
 * 2. If include is specified, only include matching vars
 * 3. Apply exclude patterns to filter out
 */
export function filterVarsByPatterns(
  vars: Record<string, string>,
  include: string[],
  exclude: string[]
): Record<string, string> {
  const keys = Object.keys(vars)

  // Step 1 & 2: Apply include filter
  let includedKeys: string[]
  if (include.length === 0) {
    // No include filter = include all
    includedKeys = keys
  } else {
    const includeMatch = compileGlobPatterns(include)
    includedKeys = keys.filter(key => includeMatch(key))
  }

  // Step 3: Apply exclude filter
  let finalKeys: string[]
  if (exclude.length === 0) {
    finalKeys = includedKeys
  } else {
    const excludeMatch = compileGlobPatterns(exclude)
    finalKeys = includedKeys.filter(key => !excludeMatch(key))
  }

  // Build result
  const result: Record<string, string> = {}
  for (const key of finalKeys) {
    result[key] = vars[key]
  }

  return result
}

/**
 * Get shared vars from all vars based on config patterns
 *
 * NOTE: This only filters by pattern names (config.shared.include).
 * For vars stored in __shared__ service, use getSharedServiceVars().
 */
export function getSharedVars(
  vars: Record<string, string>,
  config: VaulterConfig
): Record<string, string> {
  const sharedPatterns = config.shared?.include || []

  if (sharedPatterns.length === 0) {
    return {}
  }

  return filterVarsByPatterns(vars, sharedPatterns, [])
}

/**
 * Get shared vars from __shared__ service
 *
 * This fetches vars that are explicitly stored with service='__shared__'
 */
export async function getSharedServiceVars(
  client: VaulterClient,
  project: string,
  environment: Environment
): Promise<Record<string, string>> {
  return client.export(project, environment, '__shared__', { includeShared: false })
}

// ============================================================================
// .env File Generation
// ============================================================================

/**
 * Format variables as .env file content
 */
export function formatEnvFile(vars: Record<string, string>): string {
  const lines: string[] = []

  for (const [key, value] of Object.entries(vars).sort(([a], [b]) => a.localeCompare(b))) {
    // Check if value needs quoting
    const needsQuotes =
      value.includes('\n') ||
      value.includes('\r') ||
      value.includes(' ') ||
      value.includes('#') ||
      value.includes('"') ||
      value.includes("'") ||
      value.includes('$') ||
      value.startsWith(' ') ||
      value.endsWith(' ')

    if (needsQuotes) {
      // Use double quotes and escape special chars
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
      lines.push(`${key}="${escaped}"`)
    } else {
      lines.push(`${key}=${value}`)
    }
  }

  return lines.join('\n') + '\n'
}

// ============================================================================
// Main Pull Function
// ============================================================================

export interface PullToOutputsOptions {
  /** Vaulter client */
  client: VaulterClient
  /** Vaulter config */
  config: VaulterConfig
  /** Environment to pull from */
  environment: Environment
  /** Project root directory (where .vaulter/ is located) */
  projectRoot: string
  /** Pull all outputs (default: false) */
  all?: boolean
  /** Specific output name to pull */
  output?: string
  /** Dry run - don't write files, just return what would be written */
  dryRun?: boolean
  /** Verbose output */
  verbose?: boolean
  /** Override vars instead of fetching from client.export() */
  varsOverride?: Record<string, string>
  /** Override shared vars instead of fetching from getSharedServiceVars() */
  sharedVarsOverride?: Record<string, string>
  /**
   * Section-aware mode (default: true)
   * When enabled, preserves user-defined variables in a separate section
   * and only updates the Vaulter-managed section.
   * Set to false to overwrite the entire file.
   */
  sectionAware?: boolean
  /**
   * Loader function for local overrides per service.
   * When provided, this function is called for each output target to get
   * service-specific local overrides that should be merged with base vars.
   * This enables --all to apply different overrides per output based on service.
   */
  localOverridesLoader?: (service?: string) => Record<string, string>
}

export interface PullToOutputsResult {
  /** Files that were written (or would be written in dry-run) */
  files: Array<{
    output: string
    path: string
    filename: string
    fullPath: string
    varsCount: number
    vars: Record<string, string>
    /** User-defined vars that were preserved (only in sectionAware mode) */
    userVars?: Record<string, string>
    /** Total vars including user-defined (only in sectionAware mode) */
    totalVarsCount?: number
  }>
  /** Warnings (e.g., vars not included in any output) */
  warnings: string[]
  /** Whether section-aware mode was used */
  sectionAware?: boolean
}

/**
 * Pull environment variables and write .env files to output targets
 *
 * This is the main function for generating .env files based on config.
 * This is an integration function that writes to the filesystem, best tested
 * through integration tests rather than unit tests.
 *
 * @example
 * ```typescript
 * const result = await pullToOutputs({
 *   client,
 *   config,
 *   environment: 'dev',
 *   projectRoot: '/path/to/project',
 *   all: true
 * })
 * ```
 */
/* v8 ignore start */
export async function pullToOutputs(options: PullToOutputsOptions): Promise<PullToOutputsResult> {
  const {
    client,
    config,
    environment,
    projectRoot,
    all = false,
    output: specificOutput,
    dryRun = false,
    verbose = false,
    varsOverride,
    sharedVarsOverride,
    sectionAware = true, // Default to section-aware mode
    localOverridesLoader
  } = options

  const result: PullToOutputsResult = {
    files: [],
    warnings: [],
    sectionAware
  }

  // Get all output targets
  const allTargets = normalizeOutputTargets(config, environment)

  if (allTargets.length === 0) {
    result.warnings.push('No outputs defined in config. Add an "outputs" section.')
    return result
  }

  // Filter targets based on options
  let targets: NormalizedOutputTarget[]
  if (specificOutput) {
    const target = allTargets.find(t => t.name === specificOutput)
    if (!target) {
      const available = allTargets.map(t => t.name).join(', ')
      throw new Error(`Output "${specificOutput}" not found. Available: ${available}`)
    }
    targets = [target]
  } else if (all) {
    targets = allTargets
  } else {
    throw new Error('Either --all or --output <name> is required')
  }

  // Fetch all vars for this project/environment (or use overrides)
  const allVars = varsOverride ?? await client.export(config.project, environment)

  // Get shared vars from TWO sources (or use overrides):
  // 1. Vars stored in __shared__ service (explicit shared vars)
  // 2. Vars matching config.shared.include patterns (pattern-based shared vars)
  const sharedServiceVars = sharedVarsOverride ?? await getSharedServiceVars(client, config.project, environment)
  const sharedPatternVars = getSharedVars(allVars, config)

  // Merge: pattern-based vars can override __shared__ service vars
  const sharedVars = { ...sharedServiceVars, ...sharedPatternVars }

  if (verbose) {
    const serviceCount = Object.keys(sharedServiceVars).length
    const patternCount = Object.keys(sharedPatternVars).length
    const totalCount = Object.keys(sharedVars).length
    console.log(`Fetched ${Object.keys(allVars).length} vars, ${totalCount} shared (${serviceCount} from __shared__ service, ${patternCount} from patterns)`)
  }

  // Track which vars are used (for warnings)
  const usedVars = new Set<string>()

  // Process each target
  for (const target of targets) {
    // Start with inherited shared vars if enabled
    let targetVars: Record<string, string> = {}

    if (target.inherit && Object.keys(sharedVars).length > 0) {
      targetVars = { ...sharedVars }
      for (const key of Object.keys(sharedVars)) {
        usedVars.add(key)
      }
    }

    // Get vars for this target
    // If target has a specific service, fetch vars for that service
    // Otherwise, use the global allVars
    let sourceVars = allVars
    if (target.service && !varsOverride) {
      // Fetch vars for this specific service
      try {
        const serviceVars = await client.export(config.project, environment, target.service)
        // Merge shared + service-specific (service overrides shared)
        sourceVars = { ...sharedServiceVars, ...serviceVars }
      } catch {
        // If service doesn't exist, fall back to allVars
        sourceVars = allVars
      }
    }

    // Apply local overrides for this target's service (if loader provided)
    // This enables --all to use different overrides per output based on service
    if (localOverridesLoader) {
      const localOverrides = localOverridesLoader(target.service)
      if (Object.keys(localOverrides).length > 0) {
        sourceVars = { ...sourceVars, ...localOverrides }
      }
    }

    // Filter and merge target-specific vars
    const filteredVars = filterVarsByPatterns(sourceVars, target.include, target.exclude)

    // Merge: target-specific overrides shared
    targetVars = { ...targetVars, ...filteredVars }

    for (const key of Object.keys(filteredVars)) {
      usedVars.add(key)
    }

    // Generate file content
    const fullPath = join(projectRoot, target.path, target.filename)

    // Get user-defined vars if section-aware mode
    let userVars: Record<string, string> = {}
    if (sectionAware) {
      try {
        userVars = getUserVarsFromEnvFile(fullPath)
      } catch {
        // File doesn't exist yet, no user vars
      }
    }

    // Add to result
    result.files.push({
      output: target.name,
      path: target.path,
      filename: target.filename,
      fullPath,
      varsCount: Object.keys(targetVars).length,
      vars: targetVars,
      userVars: sectionAware ? userVars : undefined,
      totalVarsCount: sectionAware ? Object.keys(targetVars).length + Object.keys(userVars).length : undefined
    })

    // Write file (unless dry-run)
    if (!dryRun) {
      await mkdir(dirname(fullPath), { recursive: true })

      if (sectionAware) {
        // Section-aware: preserve user-defined vars, only update Vaulter section
        syncVaulterSection(fullPath, targetVars)

        if (verbose) {
          const userCount = Object.keys(userVars).length
          console.log(`Synced ${fullPath} (${Object.keys(targetVars).length} vaulter vars${userCount > 0 ? `, ${userCount} user vars preserved` : ''})`)
        }
      } else {
        // Overwrite mode: replace entire file
        const content = formatEnvFile(targetVars)
        await writeFile(fullPath, content, 'utf-8')

        if (verbose) {
          console.log(`Wrote ${fullPath} (${Object.keys(targetVars).length} vars)`)
        }
      }
    }
  }

  // Generate warnings for unused vars (only in verbose mode and when pulling all)
  if (verbose && all) {
    const unusedVars = Object.keys(allVars).filter(key => !usedVars.has(key))
    if (unusedVars.length > 0) {
      result.warnings.push(
        `${unusedVars.length} vars not included in any output: ${unusedVars.slice(0, 5).join(', ')}${unusedVars.length > 5 ? '...' : ''}`
      )
    }
  }

  return result
}
/* v8 ignore stop */

// ============================================================================
// Validation
// ============================================================================

/** Known fields for OutputTarget */
const KNOWN_OUTPUT_FIELDS = new Set(['path', 'filename', 'file', 'service', 'include', 'exclude', 'inherit'])

/** Common typos/mistakes and their corrections */
const FIELD_SUGGESTIONS: Record<string, string> = {
  name: 'service',
  target: 'path',
  dir: 'path',
  directory: 'path',
  folder: 'path',
  pattern: 'include',
  patterns: 'include',
  filter: 'include',
  ignore: 'exclude',
  shared: 'inherit'
}

/**
 * Validate outputs configuration
 */
export function validateOutputsConfig(config: VaulterConfig): string[] {
  const errors: string[] = []

  // Validate shared config first (doesn't depend on outputs)
  if (config.shared) {
    if (config.shared.include && !Array.isArray(config.shared.include)) {
      errors.push('shared.include must be an array')
    }
  }

  const outputs = config.outputs
  if (!outputs) return errors

  for (const [name, input] of Object.entries(outputs)) {
    // Validate name
    if (!name || typeof name !== 'string') {
      errors.push(`Invalid output name: ${name}`)
      continue
    }

    // Shorthand string
    if (typeof input === 'string') {
      if (!input.trim()) {
        errors.push(`Output "${name}": path cannot be empty`)
      }
      continue
    }

    // Full object
    if (typeof input !== 'object' || input === null) {
      errors.push(`Output "${name}": must be a string or object`)
      continue
    }

    if (!input.path || typeof input.path !== 'string') {
      errors.push(`Output "${name}": path is required`)
    }

    if (input.include && !Array.isArray(input.include)) {
      errors.push(`Output "${name}": include must be an array`)
    }

    if (input.exclude && !Array.isArray(input.exclude)) {
      errors.push(`Output "${name}": exclude must be an array`)
    }

    if (input.inherit !== undefined && typeof input.inherit !== 'boolean') {
      errors.push(`Output "${name}": inherit must be a boolean`)
    }

    // Check for unknown/typo fields and suggest corrections
    for (const field of Object.keys(input)) {
      if (!KNOWN_OUTPUT_FIELDS.has(field)) {
        const suggestion = FIELD_SUGGESTIONS[field]
        if (suggestion) {
          errors.push(`Output "${name}": unknown field "${field}". Did you mean "${suggestion}"?`)
        } else {
          errors.push(`Output "${name}": unknown field "${field}". Valid fields: ${[...KNOWN_OUTPUT_FIELDS].join(', ')}`)
        }
      }
    }
  }

  return errors
}
