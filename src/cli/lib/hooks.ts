/**
 * CLI hook runner.
 */

import { execSync } from 'node:child_process'
import * as ui from '../ui.js'

export function runHook(command: string | null | undefined, name: string, verbose: boolean): void {
  if (!command) {
    return
  }

  ui.verbose(`Running ${name} hook: ${command}`, verbose)

  execSync(command, {
    stdio: 'inherit',
    env: process.env
  })
}
