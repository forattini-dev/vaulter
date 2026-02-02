/**
 * Vaulter CLI - Service Dedupe Command
 *
 * Identifies and removes duplicated variables between services and __shared__.
 * Helps clean up after accidental bulk copies.
 */

import type { CLIArgs, VaulterConfig, Environment } from '../../../types.js'
import { withClient } from '../../lib/create-client.js'
import { c, symbols, print } from '../../lib/colors.js'
import { maskValue } from '../../../lib/masking.js'
import * as ui from '../../ui.js'
import { SHARED_SERVICE } from '../../../lib/shared.js'

export interface DedupeContext {
  args: CLIArgs
  config: VaulterConfig | null
  project: string
  service?: string
  environment: Environment
  verbose: boolean
  dryRun: boolean
  jsonOutput: boolean
}

interface DuplicateVar {
  key: string
  sharedValue: string
  serviceValue: string
  identical: boolean
}

interface ServiceDupeResult {
  service: string
  identical: DuplicateVar[]     // Same key AND value → safe to delete from service
  conflicts: DuplicateVar[]     // Same key, different value → needs decision
  serviceOnly: string[]         // Only in service → keep
  sharedOnly: string[]          // Only in shared (for info)
}

export async function runDedupe(context: DedupeContext): Promise<void> {
  const { args, config, project, service, environment, verbose, dryRun, jsonOutput } = context

  if (!project) {
    print.error('Project not specified')
    process.exit(1)
  }

  const action = args._[2] as string | undefined  // 'preview' | 'clean' | 'keep-service'

  if (!action || !['preview', 'clean', 'keep-service'].includes(action)) {
    printDedupeHelp()
    process.exit(1)
  }

  // Show environment banner
  if (!jsonOutput) {
    ui.showEnvironmentBanner(environment, {
      project,
      service: service || 'all services',
      action: action === 'preview' ? 'Analyzing duplicates' : 'Cleaning duplicates'
    })
  }

  await withClient({ args, config, project, verbose }, async (client) => {
    // Get shared vars
    const sharedVars = await client.list({
      project,
      service: SHARED_SERVICE,
      environment
    })
    const sharedMap = new Map(sharedVars.map(v => [v.key, v.value]))

    // Get list of services to check
    let servicesToCheck: string[] = []

    if (service) {
      // Single service specified
      servicesToCheck = [service]
    } else if (config?.monorepo?.services_pattern) {
      // Monorepo: get all services from outputs config
      if (config.outputs) {
        const outputServices = Object.values(config.outputs)
          .map(o => typeof o === 'object' ? o.service : undefined)
          .filter((s): s is string => !!s && s !== SHARED_SERVICE)
        servicesToCheck = [...new Set(outputServices)]
      }
    }

    if (servicesToCheck.length === 0) {
      print.error('No services found. Use -s <service> or configure outputs in .vaulter/config.yaml')
      process.exit(1)
    }

    // Analyze each service
    const results: ServiceDupeResult[] = []

    for (const svc of servicesToCheck) {
      const serviceVars = await client.list({
        project,
        service: svc,
        environment
      })
      const serviceMap = new Map(serviceVars.map(v => [v.key, v.value]))

      const identical: DuplicateVar[] = []
      const conflicts: DuplicateVar[] = []
      const serviceOnly: string[] = []
      const sharedOnly: string[] = []

      // Check service vars against shared
      for (const [key, serviceValue] of serviceMap) {
        const sharedValue = sharedMap.get(key)
        if (sharedValue !== undefined) {
          if (sharedValue === serviceValue) {
            identical.push({ key, sharedValue, serviceValue, identical: true })
          } else {
            conflicts.push({ key, sharedValue, serviceValue, identical: false })
          }
        } else {
          serviceOnly.push(key)
        }
      }

      // Check for shared-only vars (for info)
      for (const key of sharedMap.keys()) {
        if (!serviceMap.has(key)) {
          sharedOnly.push(key)
        }
      }

      results.push({
        service: svc,
        identical,
        conflicts,
        serviceOnly,
        sharedOnly
      })
    }

    // Output results
    if (jsonOutput) {
      ui.output(JSON.stringify({
        project,
        environment,
        action,
        dryRun,
        results: results.map(r => ({
          service: r.service,
          identicalCount: r.identical.length,
          conflictsCount: r.conflicts.length,
          serviceOnlyCount: r.serviceOnly.length,
          identical: r.identical.map(v => ({ key: v.key, value: maskValue(v.serviceValue) })),
          conflicts: r.conflicts.map(v => ({
            key: v.key,
            shared: maskValue(v.sharedValue),
            service: maskValue(v.serviceValue)
          })),
          serviceOnly: r.serviceOnly
        }))
      }, null, 2))
      return
    }

    // Visual output
    ui.log('')

    let totalIdentical = 0
    let totalConflicts = 0
    let totalServiceOnly = 0

    for (const r of results) {
      totalIdentical += r.identical.length
      totalConflicts += r.conflicts.length
      totalServiceOnly += r.serviceOnly.length

      if (r.identical.length === 0 && r.conflicts.length === 0) {
        ui.log(`${symbols.success} ${c.service(r.service)}: ${c.success('clean')} (${r.serviceOnly.length} service-only vars)`)
        continue
      }

      ui.log(`${symbols.warning} ${c.service(r.service)}:`)

      if (r.identical.length > 0) {
        ui.log(`  ${c.removed(`${r.identical.length} duplicates`)} (identical to __shared__, safe to delete)`)
        if (verbose) {
          for (const v of r.identical.slice(0, 5)) {
            ui.log(`    ${c.muted('-')} ${c.key(v.key)}`)
          }
          if (r.identical.length > 5) {
            ui.log(`    ${c.muted(`... and ${r.identical.length - 5} more`)}`)
          }
        }
      }

      if (r.conflicts.length > 0) {
        ui.log(`  ${c.warning(`${r.conflicts.length} conflicts`)} (same key, different value)`)
        if (verbose) {
          for (const v of r.conflicts.slice(0, 3)) {
            ui.log(`    ${c.muted('~')} ${c.key(v.key)}:`)
            ui.log(`      ${c.muted('shared:')} ${maskValue(v.sharedValue)}`)
            ui.log(`      ${c.muted('service:')} ${maskValue(v.serviceValue)}`)
          }
          if (r.conflicts.length > 3) {
            ui.log(`    ${c.muted(`... and ${r.conflicts.length - 3} more`)}`)
          }
        }
      }

      if (r.serviceOnly.length > 0) {
        ui.log(`  ${c.success(`${r.serviceOnly.length} service-only`)} (will keep)`)
      }

      ui.log('')
    }

    // Summary
    ui.log(c.header('Summary:'))
    ui.log(`  ${c.removed(String(totalIdentical))} duplicates (safe to clean)`)
    ui.log(`  ${c.warning(String(totalConflicts))} conflicts (need decision)`)
    ui.log(`  ${c.success(String(totalServiceOnly))} service-only (keep)`)
    ui.log('')

    if (action === 'preview') {
      ui.log(c.header('Actions:'))
      ui.log(`  ${c.command('vaulter service dedupe clean')}         ${c.muted('# Delete duplicates from services')}`)
      ui.log(`  ${c.command('vaulter service dedupe keep-service')}  ${c.muted('# Keep service values, delete from shared')}`)
      ui.log('')
      ui.log(`  ${c.muted('Add')} ${c.highlight('--dry-run')} ${c.muted('to preview changes')}`)
      ui.log(`  ${c.muted('Add')} ${c.highlight('-v')} ${c.muted('to see affected variables')}`)
      return
    }

    // Execute action
    if (action === 'clean') {
      // Delete duplicates from services (keep in shared)
      const toDelete: Array<{ key: string; service: string }> = []

      for (const r of results) {
        for (const v of r.identical) {
          toDelete.push({ key: v.key, service: r.service })
        }
      }

      if (toDelete.length === 0) {
        ui.log(`${symbols.success} ${c.success('Nothing to clean!')}`)
        return
      }

      if (dryRun) {
        ui.log(`${c.warning('DRY RUN')} - Would delete ${toDelete.length} duplicate vars from services:`)
        for (const item of toDelete.slice(0, 10)) {
          ui.log(`  ${c.removed('-')} ${c.key(item.key)} from ${c.service(item.service)}`)
        }
        if (toDelete.length > 10) {
          ui.log(`  ${c.muted(`... and ${toDelete.length - 10} more`)}`)
        }
        return
      }

      // Actually delete
      ui.log(`Deleting ${toDelete.length} duplicate vars from services...`)

      for (const item of toDelete) {
        await client.delete(item.key, project, environment, item.service)
      }

      ui.log(`${symbols.success} ${c.success(`Deleted ${toDelete.length} duplicate vars`)}`)
      ui.log(c.muted('Variables now only exist in __shared__'))

    } else if (action === 'keep-service') {
      // Delete duplicates from shared (keep in services)
      // Only makes sense for identical vars
      const toDeleteFromShared = new Set<string>()

      for (const r of results) {
        for (const v of r.identical) {
          toDeleteFromShared.add(v.key)
        }
      }

      if (toDeleteFromShared.size === 0) {
        ui.log(`${symbols.success} ${c.success('Nothing to clean!')}`)
        return
      }

      if (dryRun) {
        ui.log(`${c.warning('DRY RUN')} - Would delete ${toDeleteFromShared.size} vars from __shared__:`)
        const keys = [...toDeleteFromShared].slice(0, 10)
        for (const key of keys) {
          ui.log(`  ${c.removed('-')} ${c.key(key)}`)
        }
        if (toDeleteFromShared.size > 10) {
          ui.log(`  ${c.muted(`... and ${toDeleteFromShared.size - 10} more`)}`)
        }
        return
      }

      // Actually delete from shared
      ui.log(`Deleting ${toDeleteFromShared.size} vars from __shared__...`)

      for (const key of toDeleteFromShared) {
        await client.delete(key, project, environment, SHARED_SERVICE)
      }

      ui.log(`${symbols.success} ${c.success(`Deleted ${toDeleteFromShared.size} vars from __shared__`)}`)
      ui.log(c.muted('Variables now only exist in their respective services'))
    }
  })
}

function printDedupeHelp(): void {
  ui.log(`${c.label('Usage:')} ${c.command('vaulter service dedupe')} ${c.subcommand('<action>')} [options]`)
  ui.log('')
  ui.log(c.header('Actions:'))
  ui.log(`  ${c.subcommand('preview')}       Show duplicates without making changes`)
  ui.log(`  ${c.subcommand('clean')}         Delete duplicates from services (keep in __shared__)`)
  ui.log(`  ${c.subcommand('keep-service')}  Delete from __shared__ (keep in services)`)
  ui.log('')
  ui.log(c.header('Options:'))
  ui.log(`  ${c.highlight('-e')}, ${c.highlight('--env')}        Environment (required)`)
  ui.log(`  ${c.highlight('-s')}, ${c.highlight('--service')}    Check specific service (default: all)`)
  ui.log(`  ${c.highlight('--dry-run')}      Preview changes without executing`)
  ui.log(`  ${c.highlight('-v')}             Show affected variables`)
  ui.log('')
  ui.log(c.header('Examples:'))
  ui.log(`  ${c.command('vaulter service dedupe preview -e dev')}        ${c.muted('# See all duplicates')}`)
  ui.log(`  ${c.command('vaulter service dedupe clean -e dev --dry-run')} ${c.muted('# Preview cleanup')}`)
  ui.log(`  ${c.command('vaulter service dedupe clean -e dev')}          ${c.muted('# Delete from services')}`)
}
