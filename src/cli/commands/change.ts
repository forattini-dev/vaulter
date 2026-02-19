/**
 * `change` Command — Primary Mutation Entrypoint
 *
 * All local mutations flow through here:
 *   change set    → domain/state.writeLocalVariable() (local-first)
 *   change delete → domain/state.deleteLocalVariable()
 *   change move   → domain/state.moveLocalVariable()
 *   change import → batch import from .env file
 *
 * Governance checks run before every write.
 * Provenance is recorded automatically.
 */

import fs from 'node:fs'
import type { CLIArgs, VaulterConfig, Environment } from '../../types.js'
import { findConfigDir } from '../../lib/config-loader.js'
import {
  writeLocalVariable,
  deleteLocalVariable,
  moveLocalVariable,
  readLocalState
} from '../../domain/state.js'
import { checkSingleVariable } from '../../domain/governance.js'
import {
  parseScope,
  sharedScope,
  serviceScope,
  formatScope,
  scopesEqual
} from '../../domain/types.js'
import type { Scope } from '../../domain/types.js'
import { checkValuesForEncoding, formatEncodingWarning } from '../../lib/encoding-detection.js'
import { parseEnvFile } from '../../lib/env-parser.js'
import { c, symbols, colorEnv, print } from '../lib/colors.js'
import * as ui from '../ui.js'

export interface VarContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
  shared?: boolean
  override?: boolean
  secrets?: Record<string, string | number | boolean | null>
  configs?: Record<string, string | number | boolean | null>
  meta?: Record<string, string | number | boolean | null>
}

// ============================================================================
// Scope Resolution
// ============================================================================

/**
 * Resolve the target scope from CLI flags.
 *
 * Priority:
 *   1. --scope flag (explicit: "shared" or "service:<name>" or bare "<name>")
 *   2. --shared flag → shared scope
 *   3. --service / -s → service scope
 *   4. null (no scope specified — caller must decide default)
 */
interface ScopeResolution {
  scope: Scope
  implicit: boolean
}

function resolveTargetScope(context: VarContext): ScopeResolution | null {
  const { args, service } = context

  // Conflicting flags detection
  if (args.shared && args.service) {
    print.error('Conflicting scope: --shared and --service cannot be used together')
    process.exit(1)
  }

  // 1. Explicit --scope flag
  if (args.scope) {
    const parsed = parseScope(args.scope)
    if (parsed) return { scope: parsed, implicit: false }
    print.error(`Invalid scope: '${args.scope}'. Use 'shared' or 'service:<name>' or '<name>'`)
    process.exit(1)
  }

  // 2. --shared flag
  if (args.shared) {
    return { scope: sharedScope(), implicit: false }
  }

  // 3. --service / -s flag or inferred service
  if (service) {
    return { scope: serviceScope(service), implicit: false }
  }

  return null
}

/** Emit non-blocking warning when scope was implicitly defaulted to shared */
function warnImplicitScope(): void {
  print.warning('No scope specified — writing to shared scope. Use --scope shared to suppress this warning, or --scope service:<name> for a specific service.')
}

// ============================================================================
// change set
// ============================================================================

async function runChangeSet(context: VarContext): Promise<void> {
  const { config, environment, jsonOutput } = context
  const secrets = context.secrets ?? {}
  const configs = context.configs ?? {}

  // Build variables list from separator buckets
  const variables: Array<{ key: string; value: string; sensitive: boolean }> = []

  for (const [key, value] of Object.entries(secrets)) {
    variables.push({ key, value: String(value), sensitive: true })
  }
  for (const [key, value] of Object.entries(configs)) {
    variables.push({ key, value: String(value), sensitive: false })
  }

  if (variables.length === 0) {
    print.error('No variables specified')
    ui.log('')
    ui.log(c.header('Usage:'))
    ui.log(`  ${c.command('vaulter change set')} ${c.key('KEY')}${c.secret('=')}${c.value('value')} ${c.highlight('-e')} ${colorEnv('dev')}      ${c.muted('# secret (local)')}`)
    ui.log(`  ${c.command('vaulter change set')} ${c.key('KEY')}${c.config('::')}${c.value('value')} ${c.highlight('-e')} ${colorEnv('dev')}     ${c.muted('# config (local)')}`)
    ui.log(`  ${c.command('vaulter change set')} ${c.key('K1')}${c.secret('=')}${c.value('v1')} ${c.key('K2')}${c.config('::')}${c.value('v2')} ${c.highlight('-e')} ${colorEnv('dev')}  ${c.muted('# batch')}`)
    ui.log(`  ${c.command('vaulter change set')} ${c.muted('--scope shared')} ${c.key('KEY')}${c.secret('=')}${c.value('val')} ${c.muted('# explicit scope')}`)
    ui.log('')
    ui.log(`After making changes, run ${c.command('vaulter plan')} to preview and ${c.command('vaulter apply')} to push.`)
    process.exit(1)
  }

  // Find config dir
  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found')
    ui.log(`Run "${c.command('vaulter init')}" to create one`)
    process.exit(1)
  }

  // Resolve scope
  const resolution = resolveTargetScope(context)
  const scope = resolution?.scope ?? sharedScope()
  if (!resolution && !jsonOutput) {
    warnImplicitScope()
  }

  // Check for encoding warnings
  if (!jsonOutput) {
    const encodingWarnings = checkValuesForEncoding(
      variables.map(v => ({ key: v.key, value: v.value }))
    )
    for (const { key, result } of encodingWarnings) {
      const warning = formatEncodingWarning(result, key)
      if (warning) {
        print.warning(warning)
        ui.log(c.muted('  Vaulter automatically encrypts all values. Pre-encoding is usually unnecessary.'))
      }
    }
  }

  // Dry run
  if (context.dryRun) {
    const result = {
      action: 'set',
      scope: formatScope(scope),
      environment,
      variables: variables.map(v => ({
        key: v.key,
        type: v.sensitive ? 'secret' : 'config'
      })),
      dryRun: true
    }

    if (jsonOutput) {
      ui.output(JSON.stringify(result))
    } else {
      ui.log(`${c.muted('Dry run')} — would set ${c.value(String(variables.length))} variable(s) in local state:`)
      for (const v of variables) {
        const type = v.sensitive ? c.secretType('secret') : c.configType('config')
        ui.log(`  ${c.key(v.key)} ${symbols.arrow} ${type} ${c.muted(`(${formatScope(scope)})`)}`)
      }
    }
    return
  }

  // Execute
  const results: Array<{ key: string; type: string; success: boolean; warnings: string[]; blocked?: boolean; blockReason?: string; suggestions?: string[] }> = []

  for (const v of variables) {
    // Governance pre-check
    const check = checkSingleVariable({
      key: v.key,
      value: v.value,
      scope,
      sensitive: v.sensitive,
      environment,
      config
    })

    if (check.blocked) {
      results.push({
        key: v.key,
        type: check.effectiveSensitive ? 'secret' : 'config',
        success: false,
        warnings: check.warnings,
        blocked: true,
        blockReason: check.blockReason
      })

      if (!jsonOutput) {
        ui.log(`${symbols.error} ${c.key(v.key)}: blocked by scope policy`)
        if (check.blockReason) {
          ui.log(`  ${c.muted(check.blockReason)}`)
        }
      }
      continue
    }

    // Show auto-correct note
    if (!jsonOutput && check.sensitiveAutoCorrect) {
      print.warning(`${v.key}: auto-set sensitive=true (name suggests secret material)`)
    }

    // Show warnings
    if (!jsonOutput && check.warnings.length > 0) {
      for (const w of check.warnings) {
        print.warning(`${v.key}: ${w}`)
      }
    }

    // Write to local state
    const writeResult = writeLocalVariable(configDir, environment, {
      key: v.key,
      value: v.value,
      scope,
      sensitive: check.effectiveSensitive
    }, { source: 'cli' })

    results.push({
      key: v.key,
      type: check.effectiveSensitive ? 'secret' : 'config',
      success: writeResult.success,
      warnings: [...check.warnings, ...writeResult.warnings],
      suggestions: check.suggestions
    })

    if (!jsonOutput && writeResult.success) {
      const type = check.effectiveSensitive ? c.secretType('secret') : c.configType('config')
      ui.log(`${symbols.success} Set ${type} ${c.key(v.key)} ${c.muted(`(${formatScope(scope)})`)}`)
      for (const w of writeResult.warnings) {
        print.warning(`  ${w}`)
      }
    }
  }

  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  // Collect and display suggestions
  if (!jsonOutput) {
    const allSuggestions = results.flatMap(r => r.suggestions ?? [])
    if (allSuggestions.length > 0) {
      ui.log('')
      ui.log(c.header('Suggestions:'))
      for (const s of [...new Set(allSuggestions)]) {
        ui.log(`  ${symbols.arrow} ${c.muted(s)}`)
      }
    }
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: failed === 0,
      results,
      summary: { total: results.length, successful, failed },
      scope: formatScope(scope),
      environment
    }))
  } else if (variables.length > 1) {
    ui.log(`\n${c.success(String(successful))}/${c.value(String(variables.length))} variables set in local state`)
    if (successful > 0) {
      ui.log(`Run ${c.command('vaulter plan -e ' + environment)} to preview, then ${c.command('vaulter apply')} to push.`)
    }
  } else if (successful > 0 && !jsonOutput) {
    ui.log(c.muted(`Run ${c.command('vaulter plan -e ' + environment)} to preview, then ${c.command('vaulter apply')} to push.`))
  }

  if (failed > 0) {
    process.exit(1)
  }
}

// ============================================================================
// change delete
// ============================================================================

async function runChangeDelete(context: VarContext): Promise<void> {
  const { args, environment, jsonOutput } = context

  const key = args._[2]
  if (!key) {
    print.error('Key name is required')
    ui.log(`${c.label('Usage:')} ${c.command('vaulter change delete')} ${c.key('<key>')} ${c.highlight('-e')} ${colorEnv('<env>')}`)
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found')
    ui.log(`Run "${c.command('vaulter init')}" to create one`)
    process.exit(1)
  }

  // Resolve scope — if not specified, try to find which scope the key lives in
  const resolution = resolveTargetScope(context)
  let scope: Scope | null = resolution?.scope ?? null
  if (!scope) {
    scope = findKeyScope(configDir, environment, key)
    if (!scope) {
      if (jsonOutput) {
        ui.output(JSON.stringify({ error: 'not_found', key }))
      } else {
        print.error(`Variable ${c.key(key)} not found in local state`)
        ui.log('Specify --scope to target a specific scope')
      }
      process.exit(1)
    }
  }

  if (context.dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        action: 'delete',
        key,
        scope: formatScope(scope),
        environment,
        dryRun: true
      }))
    } else {
      ui.log(`${c.muted('Dry run')} — would delete ${c.key(key)} from ${c.muted(formatScope(scope))}`)
    }
    return
  }

  const deleted = deleteLocalVariable(configDir, environment, key, scope, { source: 'cli' })

  if (!deleted) {
    if (jsonOutput) {
      ui.output(JSON.stringify({ error: 'not_found', key, scope: formatScope(scope) }))
    } else {
      print.error(`Variable ${c.key(key)} not found in ${c.muted(formatScope(scope))}`)
    }
    process.exit(1)
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: true,
      deleted: key,
      scope: formatScope(scope),
      environment
    }))
  } else {
    ui.success(`Deleted ${c.key(key)} from ${c.muted(formatScope(scope))}`)
    ui.log(c.muted(`Run ${c.command('vaulter plan -e ' + environment)} to preview, then ${c.command('vaulter apply')} to push.`))
  }
}

/**
 * Find which scope a key lives in within local state.
 *
 * Returns null if key is not found.
 * Throws (process.exit) if key exists in multiple scopes and no explicit scope was given,
 * since the user must disambiguate.
 */
function findKeyScope(configDir: string, environment: string, key: string): Scope | null {
  const vars = readLocalState(configDir, environment)
  const matches = vars.filter(v => v.key === key)

  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0].scope

  // Ambiguous: key exists in multiple scopes
  const scopeLabels = matches.map(m => formatScope(m.scope)).join(', ')
  print.error(`Variable ${c.key(key)} exists in multiple scopes: ${scopeLabels}`)
  ui.log(`Use ${c.highlight('--scope')} to specify which one (e.g. ${c.muted('--scope shared')} or ${c.muted('--scope <service>')})`)
  process.exit(1)
}

// ============================================================================
// change move
// ============================================================================

async function runChangeMove(context: VarContext): Promise<void> {
  const { args, environment, jsonOutput } = context

  const key = args._[2]
  if (!key) {
    print.error('Key name is required')
    ui.log(`${c.label('Usage:')} ${c.command('vaulter change move')} ${c.key('<key>')} ${c.highlight('--from')} ${c.muted('<scope>')} ${c.highlight('--to')} ${c.muted('<scope>')}`)
    process.exit(1)
  }

  const fromRaw = args.from
  const toRaw = args.to

  if (!fromRaw || !toRaw) {
    print.error('Both --from and --to are required')
    ui.log(`${c.label('Example:')} ${c.command('vaulter change move')} ${c.key(key)} ${c.highlight('--from shared --to svc-auth')}`)
    process.exit(1)
  }

  const from = parseScope(fromRaw)
  const to = parseScope(toRaw)

  if (!from || !to) {
    print.error('Invalid scope. Use \'shared\' or \'service:<name>\' or \'<name>\'')
    process.exit(1)
  }
  if (scopesEqual(from, to)) {
    print.error(`Source and destination scopes are the same: ${formatScope(from)}`)
    ui.log('Use distinct --from and --to values.')
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found')
    process.exit(1)
  }

  // Check if target already has this key (overwrite protection)
  const targetVars = readLocalState(configDir, environment)
  const existsInTarget = targetVars.some(v => v.key === key && v.scope.kind === to.kind && (to.kind === 'shared' || (v.scope as any).name === (to as any).name))
  const overwrite = args.overwrite === true
  const deleteOriginal = args.deleteOriginal !== false

  if (existsInTarget && !overwrite) {
    if (jsonOutput) {
      ui.output(JSON.stringify({ error: 'target_exists', key, scope: formatScope(to) }))
    } else {
      print.error(`Variable ${c.key(key)} already exists in ${c.muted(formatScope(to))}`)
      ui.log(`Use ${c.highlight('--overwrite')} to overwrite`)
    }
    process.exit(1)
  }

  const sourceEntry = targetVars.find(v => v.key === key && scopesEqual(v.scope, from))
  if (!sourceEntry) {
    if (jsonOutput) {
      ui.output(JSON.stringify({ error: 'not_found', key, scope: formatScope(from) }))
    } else {
      print.error(`Variable ${c.key(key)} not found in ${c.muted(formatScope(from))}`)
    }
    process.exit(1)
  }

  const govCheck = checkSingleVariable({
    key,
    value: sourceEntry.value,
    scope: to,
    sensitive: sourceEntry.sensitive,
    environment,
    config: context.config
  })

  if (govCheck.blocked) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        error: 'blocked',
        key,
        reason: govCheck.blockReason || 'policy block'
      }))
    } else {
      print.error(`Move blocked by policy: ${govCheck.blockReason || 'invalid scope for target.'}`)
    }
    process.exit(1)
  }

  if (!jsonOutput && govCheck.warnings.length > 0) {
    for (const warning of govCheck.warnings) {
      print.warning(`${c.key(key)}: ${warning}`)
    }
  }

  if (context.dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        action: 'move',
        key,
        from: formatScope(from),
        to: formatScope(to),
        environment,
        overwrite,
        deleteOriginal,
        dryRun: true
      }))
    } else {
      const overwriteNote = overwrite ? c.warning(' (overwrite)') : ''
      const copyNote = deleteOriginal ? '' : c.muted(' (copy)')
      ui.log(`${c.muted('Dry run')} — would move ${c.key(key)} from ${c.muted(formatScope(from))} to ${c.muted(formatScope(to))}${overwriteNote}${copyNote}`)
    }
    return
  }

  const result = moveLocalVariable(
    configDir,
    environment,
    key,
    from,
    to,
    { source: 'cli' },
    { overwrite, deleteOriginal }
  )

  if (!result.success) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        success: false,
        key,
        from: formatScope(from),
        to: formatScope(to),
        warnings: result.warnings
      }))
    } else {
      print.error(`Move failed: ${result.warnings.join(', ')}`)
    }
    process.exit(1)
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: true,
      key,
      from: formatScope(from),
      to: formatScope(to),
      environment
    }))
  } else {
    const actionVerb = deleteOriginal ? 'Moved' : 'Copied'
    ui.success(`${actionVerb} ${c.key(key)} from ${c.muted(formatScope(from))} to ${c.muted(formatScope(to))}`)
    ui.log(c.muted(`Run ${c.command('vaulter plan -e ' + environment)} to preview, then ${c.command('vaulter apply')} to push.`))
  }
}

// ============================================================================
// change import
// ============================================================================

async function runChangeImport(context: VarContext): Promise<void> {
  const { args, config, environment, jsonOutput } = context

  const filePath = args._[2] || args.file
  if (!filePath) {
    print.error('File path is required')
    ui.log(`${c.label('Usage:')} ${c.command('vaulter change import')} ${c.muted('<file>')} ${c.highlight('-e')} ${colorEnv('<env>')}`)
    ui.log(`${c.label('Example:')} ${c.command('vaulter change import .env.migration -e dev --scope svc-auth')}`)
    process.exit(1)
  }

  if (!fs.existsSync(filePath)) {
    print.error(`File not found: ${filePath}`)
    process.exit(1)
  }

  const configDir = findConfigDir()
  if (!configDir) {
    print.error('No .vaulter directory found')
    process.exit(1)
  }

  const resolution = resolveTargetScope(context)
  const scope = resolution?.scope ?? sharedScope()
  if (!resolution && !jsonOutput) {
    warnImplicitScope()
  }
  const vars = parseEnvFile(filePath)
  const keys = Object.keys(vars)

  if (keys.length === 0) {
    print.error('No variables found in file')
    process.exit(1)
  }

  if (context.dryRun) {
    if (jsonOutput) {
      ui.output(JSON.stringify({
        action: 'import',
        file: filePath,
        scope: formatScope(scope),
        environment,
        variables: keys,
        dryRun: true
      }))
    } else {
      ui.log(`${c.muted('Dry run')} — would import ${c.value(String(keys.length))} variable(s) from ${c.muted(filePath)}:`)
      for (const key of keys) {
        ui.log(`  ${c.key(key)} ${symbols.arrow} ${c.muted(formatScope(scope))}`)
      }
    }
    return
  }

  let imported = 0
  let failed = 0

  for (const [key, value] of Object.entries(vars)) {
    // Heuristic: keys containing SECRET, KEY, TOKEN, PASSWORD, URL are sensitive
    const sensitive = /secret|key|token|password|url|credentials?/i.test(key)

    // Governance check per key
    const govCheck = checkSingleVariable({
      key,
      value,
      scope,
      sensitive,
      environment,
      config
    })
    if (govCheck.blocked) {
      failed++
      if (!jsonOutput) {
        print.error(`${c.key(key)}: ${govCheck.blockReason || 'blocked by policy'}`)
      }
      continue
    }
    if (!jsonOutput && govCheck.sensitiveAutoCorrect) {
      print.warning(`${c.key(key)}: auto-set sensitive=true (name suggests secret material)`)
    }
    if (govCheck.warnings.length > 0 && !jsonOutput) {
      for (const w of govCheck.warnings) {
        print.warning(`${c.key(key)}: ${w}`)
      }
    }

    const result = writeLocalVariable(configDir, environment, {
      key,
      value,
      scope,
      sensitive: govCheck.effectiveSensitive
    }, { source: 'import' })

    if (result.success) {
      imported++
      if (!jsonOutput) {
        const type = govCheck.effectiveSensitive ? c.secretType('secret') : c.configType('config')
        ui.log(`${symbols.success} ${type} ${c.key(key)}`)
      }
    } else {
      failed++
    }
  }

  if (jsonOutput) {
    ui.output(JSON.stringify({
      success: failed === 0,
      imported,
      failed,
      scope: formatScope(scope),
      environment
    }))
  } else {
    ui.log(`\n${c.success(String(imported))} imported, ${failed > 0 ? c.error(String(failed)) : c.muted(String(failed))} failed`)
    if (imported > 0) {
      ui.log(`Run ${c.command('vaulter plan -e ' + environment)} to preview, then ${c.command('vaulter apply')} to push.`)
    }
  }

  if (failed > 0) process.exit(1)
}

// ============================================================================
// Router
// ============================================================================

/**
 * Router for change subcommands
 */
export async function runChange(context: VarContext): Promise<void> {
  const { args } = context
  const subcommand = args._[1]

  switch (subcommand) {
    case 'set':
      await runChangeSet(context)
      break

    case 'delete':
    case 'rm':
    case 'remove':
      await runChangeDelete(context)
      break

    case 'move':
      await runChangeMove(context)
      break

    case 'import':
      await runChangeImport(context)
      break

    default: {
      if (!subcommand || subcommand.startsWith('-')) {
        ui.log(`${c.label('Usage:')} ${c.command('vaulter change')} ${c.subcommand('<command>')} [options]`)
        ui.log('')
        ui.log(c.header('Commands:'))
        ui.log(`  ${c.subcommand('set')} ${c.muted('<vars>')}            Set variables (local-first)`)
        ui.log(`  ${c.subcommand('delete')} ${c.muted('<key>')}          Delete a variable`)
        ui.log(`  ${c.subcommand('move')} ${c.muted('<key>')}            Move between scopes`)
        ui.log(`  ${c.subcommand('import')} ${c.muted('<file>')}         Import from .env file`)
        ui.log('')
        ui.log(c.header('Set Syntax:'))
        ui.log(`  ${c.key('KEY')}${c.secret('=')}${c.value('value')}        ${c.secretType('secret')} ${c.muted('(sensitive)')}`)
        ui.log(`  ${c.key('KEY')}${c.config('::')}${c.value('value')}       ${c.configType('config')} ${c.muted('(plain text)')}`)
        ui.log('')
        ui.log(c.header('Scope:'))
        ui.log(`  ${c.highlight('--scope shared')}        Shared variables`)
        ui.log(`  ${c.highlight('--scope svc-auth')}      Service-specific`)
        ui.log(`  ${c.highlight('--shared')}              Alias for --scope shared`)
        ui.log('')
        ui.log(c.header('Workflow:'))
        ui.log(`  1. ${c.command('vaulter change set')} KEY=value -e dev   ${c.muted('(writes to local state)')}`)
        ui.log(`  2. ${c.command('vaulter plan -e dev')}                   ${c.muted('(preview diff + scorecard)')}`)
        ui.log(`  3. ${c.command('vaulter apply -e dev')}                  ${c.muted('(push to backend)')}`)
        process.exit(1)
      } else {
        print.error(`Unknown subcommand: ${c.command('change')} ${c.subcommand(subcommand)}`)
        ui.log(`Run "${c.command('vaulter change --help')}" for usage`)
        process.exit(1)
      }
    }
  }
}
