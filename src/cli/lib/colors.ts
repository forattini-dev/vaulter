/**
 * Vaulter CLI - Colors Utility
 *
 * 🎨 Vaulter Blue Theme
 * A rich blue palette for the secrets manager CLI
 *
 * Terminal colors using tuiuiu.js text-utils + ANSI 256 for blue palette
 * Supports NO_COLOR environment variable
 */

import {
  colorize,
  style,
  styles as tuiStyles,
  stripAnsi
} from 'tuiuiu.js'
import type { Formatter } from 'cli-args-parser'

// Check if colors should be enabled
const isColorEnabled = (): boolean => {
  // Respect NO_COLOR standard
  if (process.env.NO_COLOR !== undefined) return false
  // Respect FORCE_COLOR
  if (process.env.FORCE_COLOR !== undefined) return true
  // Check if stdout is a TTY
  return process.stdout.isTTY ?? false
}

const enabled = isColorEnabled()

// Wrapper that respects NO_COLOR
const color = (text: string, col: string): string => {
  if (!enabled) return text
  return colorize(text, col)
}

const styled = (text: string, ...styleNames: (keyof typeof tuiStyles)[]): string => {
  if (!enabled) return text
  return style(text, ...styleNames)
}

// Combined color + style
const colorStyled = (text: string, col: string, ...styleNames: (keyof typeof tuiStyles)[]): string => {
  if (!enabled) return text
  // Apply style first, then color
  const styledText = style(text, ...styleNames)
  return colorize(styledText, col)
}

/**
 * 🎨 Vaulter Blue Palette (ANSI 256)
 *
 * Uses ANSI 256 color codes for rich blue palette:
 * - 39:  Neon blue     (#00AFFF) — primary, commands
 * - 45:  Electric blue (#00D7FF) — highlights, bright accents
 * - 33:  Sky blue      (#0087FF) — secondary, options
 * - 27:  Deep blue     (#005FFF) — emphasis, important
 * - 75:  Steel blue    (#5FAFFF) — muted, descriptions
 * - 111: Pale blue     (#87AFFF) — subtle, defaults
 * - 252: Light gray    (#D0D0D0) — text
 * - 245: Medium gray   (#8A8A8A) — muted text
 */
const ansi = {
  // Styles
  bold: (s: string) => enabled ? `\x1b[1m${s}\x1b[22m` : s,
  dim: (s: string) => enabled ? `\x1b[2m${s}\x1b[22m` : s,
  italic: (s: string) => enabled ? `\x1b[3m${s}\x1b[23m` : s,
  underline: (s: string) => enabled ? `\x1b[4m${s}\x1b[24m` : s,

  // Blue palette (ANSI 256)
  neonBlue: (s: string) => enabled ? `\x1b[38;5;39m${s}\x1b[39m` : s,      // Primary (#00AFFF)
  electricBlue: (s: string) => enabled ? `\x1b[38;5;45m${s}\x1b[39m` : s,  // Bright accent (#00D7FF)
  skyBlue: (s: string) => enabled ? `\x1b[38;5;33m${s}\x1b[39m` : s,       // Secondary (#0087FF)
  deepBlue: (s: string) => enabled ? `\x1b[38;5;27m${s}\x1b[39m` : s,      // Emphasis (#005FFF)
  steelBlue: (s: string) => enabled ? `\x1b[38;5;75m${s}\x1b[39m` : s,     // Muted (#5FAFFF)
  paleBlue: (s: string) => enabled ? `\x1b[38;5;111m${s}\x1b[39m` : s,     // Subtle (#87AFFF)
  iceBlue: (s: string) => enabled ? `\x1b[38;5;117m${s}\x1b[39m` : s,      // Very light (#87D7FF)

  // Neutrals
  white: (s: string) => enabled ? `\x1b[97m${s}\x1b[39m` : s,
  gray: (s: string) => enabled ? `\x1b[38;5;245m${s}\x1b[39m` : s,
  lightGray: (s: string) => enabled ? `\x1b[38;5;252m${s}\x1b[39m` : s,
  darkGray: (s: string) => enabled ? `\x1b[38;5;240m${s}\x1b[39m` : s,

  // Semantic (keep for status - don't make everything blue)
  red: (s: string) => enabled ? `\x1b[91m${s}\x1b[39m` : s,
  green: (s: string) => enabled ? `\x1b[92m${s}\x1b[39m` : s,
  yellow: (s: string) => enabled ? `\x1b[93m${s}\x1b[39m` : s,
}

// Export ANSI utilities for external use
export { ansi }

/**
 * 🎨 Vaulter Blue Theme Formatter for cli-args-parser
 *
 * Maps help/version tokens to the blue palette
 */
export const vaulterFormatter: Formatter = {
  // Headers & structure
  'section-header': s => ansi.bold(ansi.white(s)),

  // Identity
  'program-name': s => ansi.bold(ansi.neonBlue(s)),
  'version': s => ansi.electricBlue(s),
  'description': s => ansi.lightGray(s),

  // Commands
  'command-name': s => ansi.neonBlue(s),
  'command-alias': s => ansi.gray(s),
  'command-description': s => ansi.lightGray(s),

  // Options
  'option-flag': s => ansi.electricBlue(s),
  'option-type': s => ansi.steelBlue(s),
  'option-default': s => ansi.dim(ansi.paleBlue(s)),
  'option-description': s => ansi.lightGray(s),

  // Positionals
  'positional-name': s => ansi.skyBlue(s),

  // Errors (keep red for visibility)
  'error-header': s => ansi.bold(ansi.red(s)),
  'error-message': s => ansi.red(s),
  'error-option': s => ansi.neonBlue(s),
}

// Export strip utility
export { stripAnsi }

// Style functions
export const bold = (text: string) => styled(text, 'bold')
export const dim = (text: string) => styled(text, 'dim')
export const italic = (text: string) => styled(text, 'italic')
export const underline = (text: string) => styled(text, 'underline')

// Color functions
export const black = (text: string) => color(text, 'black')
export const red = (text: string) => color(text, 'red')
export const green = (text: string) => color(text, 'green')
export const yellow = (text: string) => color(text, 'yellow')
export const blue = (text: string) => color(text, 'blue')
export const magenta = (text: string) => color(text, 'magenta')
export const cyan = (text: string) => color(text, 'cyan')
export const white = (text: string) => color(text, 'white')
export const gray = (text: string) => color(text, 'gray')

// Bright color functions
export const brightRed = (text: string) => color(text, 'redBright')
export const brightGreen = (text: string) => color(text, 'greenBright')
export const brightYellow = (text: string) => color(text, 'yellowBright')
export const brightBlue = (text: string) => color(text, 'blueBright')
export const brightMagenta = (text: string) => color(text, 'magentaBright')
export const brightCyan = (text: string) => color(text, 'cyanBright')
export const brightWhite = (text: string) => color(text, 'whiteBright')

// Semantic colors for vaulter (Blue Theme)
export const c = {
  // Commands and actions - neon blue
  command: (text: string) => ansi.bold(ansi.neonBlue(text)),
  subcommand: (text: string) => ansi.neonBlue(text),

  // Values and data - blue variations
  key: (text: string) => ansi.electricBlue(text),
  value: (text: string) => ansi.iceBlue(text),
  secret: (text: string) => ansi.deepBlue(text),
  config: (text: string) => ansi.steelBlue(text),

  // Type indicators (for set/list)
  secretType: (text: string) => ansi.bold(ansi.deepBlue(text)),
  configType: (text: string) => ansi.bold(ansi.steelBlue(text)),

  // Environments - keep distinct for safety
  env: (text: string) => ansi.skyBlue(text),
  envDev: (text: string) => ansi.green(text),      // green = safe
  envStg: (text: string) => ansi.yellow(text),    // yellow = caution
  envPrd: (text: string) => ansi.bold(ansi.red(text)), // red = danger

  // Status - keep standard colors for UX
  success: (text: string) => ansi.green(text),
  error: (text: string) => ansi.red(text),
  warning: (text: string) => ansi.yellow(text),
  info: (text: string) => ansi.neonBlue(text),

  // Diff - keep standard for visibility
  added: (text: string) => ansi.green(text),
  removed: (text: string) => ansi.red(text),
  modified: (text: string) => ansi.yellow(text),
  unchanged: (text: string) => ansi.gray(text),

  // Structure
  header: (text: string) => ansi.bold(ansi.white(text)),
  label: (text: string) => ansi.gray(text),
  highlight: (text: string) => ansi.bold(ansi.electricBlue(text)),
  muted: (text: string) => ansi.dim(text),

  // Projects/Services - blue theme
  project: (text: string) => ansi.bold(ansi.neonBlue(text)),
  service: (text: string) => ansi.skyBlue(text),
}

// Helper to colorize environment name based on type
export function colorEnv(env: string): string {
  if (!enabled) return env
  if (env === 'prd' || env === 'prod' || env === 'production') {
    return c.envPrd(env)
  }
  if (env === 'stg' || env === 'staging' || env === 'homolog') {
    return c.envStg(env)
  }
  return c.envDev(env)
}

// Symbols with colors (Blue Theme)
export const symbols = {
  // Status - keep semantic colors
  success: enabled ? ansi.green('✓') : '[OK]',
  error: enabled ? ansi.red('✗') : '[ERROR]',
  warning: enabled ? ansi.yellow('⚠') : '[WARN]',
  info: enabled ? ansi.neonBlue('ℹ') : '[INFO]',

  // Navigation - blue theme
  bullet: enabled ? ansi.steelBlue('•') : '*',
  arrow: enabled ? ansi.neonBlue('→') : '->',
  arrowRight: enabled ? ansi.electricBlue('→') : '->',
  arrowLeft: enabled ? ansi.paleBlue('←') : '<-',
  arrowBoth: enabled ? ansi.skyBlue('↔') : '<->',

  // Diff - keep semantic
  plus: enabled ? ansi.green('+') : '+',
  minus: enabled ? ansi.red('-') : '-',
  equal: enabled ? ansi.gray('=') : '=',
  tilde: enabled ? ansi.yellow('~') : '~',

  // Icons - blue accents
  lock: enabled ? '🔒' : '[LOCKED]',
  unlock: enabled ? '🔓' : '[UNLOCKED]',
  key: enabled ? '🔑' : '[KEY]',
  folder: enabled ? '📁' : '[DIR]',
  file: enabled ? '📄' : '[FILE]',
  package: enabled ? '📦' : '[PKG]',
  globe: enabled ? '🌐' : '[GLOBAL]',
  vault: enabled ? '🔐' : '[VAULT]',
  shield: enabled ? '🛡️' : '[SHIELD]',
}

// Box drawing characters
export const box = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
  teeDown: '┬',
  teeUp: '┴',
  cross: '┼',
}

// Format a header box
export function header(text: string, width = 50): string {
  const padding = Math.max(0, width - text.length - 4)
  const line = box.horizontal.repeat(width)
  return [
    c.muted(box.topLeft + line + box.topRight),
    c.muted(box.vertical) + '  ' + c.header(text) + ' '.repeat(padding) + c.muted(box.vertical),
    c.muted(box.bottomLeft + line + box.bottomRight),
  ].join('\n')
}

// Format a simple divider
export function divider(width = 50): string {
  return c.muted(box.horizontal.repeat(width))
}

// Format a key=value pair
export function keyValue(key: string, value: string, masked = false): string {
  const displayValue = masked ? c.secret('••••••••') : c.value(value)
  return `${c.key(key)}${c.muted('=')}${displayValue}`
}

// Format a labeled value
export function labeled(label: string, value: string): string {
  return `${c.label(label + ':')} ${value}`
}

// Print utilities
export const print = {
  success: (msg: string) => console.log(`${symbols.success} ${c.success(msg)}`),
  error: (msg: string) => console.error(`${symbols.error} ${c.error(msg)}`),
  warning: (msg: string) => console.error(`${symbols.warning} ${c.warning(msg)}`),
  info: (msg: string) => console.log(`${symbols.info} ${c.info(msg)}`),

  // Print a list item
  item: (text: string) => console.log(`  ${symbols.bullet} ${text}`),

  // Print a key-value pair
  kv: (key: string, value: string, masked = false) => {
    console.log(`  ${keyValue(key, value, masked)}`)
  },
}
