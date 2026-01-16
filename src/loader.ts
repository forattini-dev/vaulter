/**
 * Vaulter - Programmatic environment loader
 *
 * Usage:
 *   import { loader } from 'vaulter'
 *   loader()
 *
 * With options:
 *   loader({ path: '.env.local' })
 *   loader({ path: '.env.production', override: true })
 */

import dotenv from 'dotenv'
import type { DotenvConfigOptions, DotenvConfigOutput } from 'dotenv'

export interface LoaderOptions extends DotenvConfigOptions {
  /**
   * Path to .env file
   * @default '.env'
   */
  path?: string

  /**
   * Override existing environment variables
   * @default false
   */
  override?: boolean

  /**
   * Enable debug output
   * @default false
   */
  debug?: boolean
}

/**
 * Load environment variables from .env file into process.env
 *
 * @param options - Configuration options
 * @returns Result with parsed variables or error
 *
 * @example
 * // Basic usage
 * import { loader } from 'vaulter'
 * loader()
 *
 * @example
 * // Load specific file
 * loader({ path: '.env.production' })
 *
 * @example
 * // Override existing vars
 * loader({ path: '.env.local', override: true })
 */
export function loader(options?: LoaderOptions): DotenvConfigOutput {
  // Default to quiet mode unless debug is enabled
  const opts = { quiet: !options?.debug, ...options }
  return dotenv.config(opts)
}

/**
 * Parse a string containing environment variables
 * Does NOT modify process.env
 *
 * @param src - String to parse (e.g., contents of .env file)
 * @returns Parsed key-value pairs
 *
 * @example
 * import { parse } from 'vaulter'
 * const vars = parse('FOO=bar\nBAZ=qux')
 * // { FOO: 'bar', BAZ: 'qux' }
 */
export function parse(src: string): Record<string, string> {
  return dotenv.parse(src)
}
