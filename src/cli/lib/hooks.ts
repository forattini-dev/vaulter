/**
 * CLI hook runner.
 */

import { execSync } from 'node:child_process'

export function runHook(command: string | null | undefined, name: string, verbose: boolean): void {
  if (!command) {
    return
  }

  if (verbose) {
    console.error(`Running ${name} hook: ${command}`)
  }

  execSync(command, {
    stdio: 'inherit',
    env: process.env
  })
}
