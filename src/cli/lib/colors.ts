/**
 * Vaulter CLI - Colors Utility
 *
 * Vaulter Blue Theme
 * A rich blue palette for the secrets manager CLI
 *
 * Uses tuiuiu.js/colors for terminal styling with ANSI 256 blue palette
 * Supports NO_COLOR environment variable
 */

import {
  bold, dim, italic, underline,
  red, green, yellow, white, gray,
  bgRed, bgGreen, bgYellow, bgBlue,
  ansi256, compose, c as chain, tpl,
  stripAnsi
} from 'tuiuiu.js/colors'
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

// Wrapper that respects NO_COLOR for any color function
const wrap = <T extends (...args: string[]) => string>(fn: T) =>
  (text: string) => enabled ? fn(text) : text

/**
 * Vaulter Blue Palette (ANSI 256)
 *
 * Uses ANSI 256 color codes for rich blue palette:
 * - 39:  Neon blue     (#00AFFF) - primary, commands
 * - 45:  Electric blue (#00D7FF) - highlights, bright accents
 * - 33:  Sky blue      (#0087FF) - secondary, options
 * - 27:  Deep blue     (#005FFF) - emphasis, important
 * - 75:  Steel blue    (#5FAFFF) - muted, descriptions
 * - 111: Pale blue     (#87AFFF) - subtle, defaults
 * - 117: Ice blue      (#87D7FF) - very light
 * - 252: Light gray    (#D0D0D0) - text
 * - 245: Medium gray   (#8A8A8A) - muted text
 */

// Blue palette colors
const neonBlue = ansi256(39)      // Primary (#00AFFF)
const electricBlue = ansi256(45)  // Bright accent (#00D7FF)
const skyBlue = ansi256(33)       // Secondary (#0087FF)
const deepBlue = ansi256(27)      // Emphasis (#005FFF)
const steelBlue = ansi256(75)     // Muted (#5FAFFF)
const paleBlue = ansi256(111)     // Subtle (#87AFFF)
const iceBlue = ansi256(117)      // Very light (#87D7FF)

// Neutrals
const lightGray = ansi256(252)
const mediumGray = ansi256(245)
const darkGray = ansi256(240)

// Backgrounds
const bgNeonBlue = (s: string) => chain.bgAnsi256(39).white(s)
const bgElectricBlue = (s: string) => chain.bgAnsi256(45).black(s)
const bgDeepBlue = (s: string) => chain.bgAnsi256(27).white(s)

// Composed styles using compose()
const boldNeonBlue = compose(bold, neonBlue)
const boldElectricBlue = compose(bold, electricBlue)
const boldDeepBlue = compose(bold, deepBlue)
const boldWhite = compose(bold, white)
const boldRed = compose(bold, red)
const dimPaleBlue = compose(dim, paleBlue)
const dimGray = compose(dim, gray)

// Export ANSI utilities for external use (wrapped for NO_COLOR)
export const ansi = {
  // Styles
  bold: wrap(bold),
  dim: wrap(dim),
  italic: wrap(italic),
  underline: wrap(underline),

  // Blue palette
  neonBlue: wrap(neonBlue),
  electricBlue: wrap(electricBlue),
  skyBlue: wrap(skyBlue),
  deepBlue: wrap(deepBlue),
  steelBlue: wrap(steelBlue),
  paleBlue: wrap(paleBlue),
  iceBlue: wrap(iceBlue),

  // Neutrals
  white: wrap(white),
  gray: wrap(mediumGray),
  lightGray: wrap(lightGray),
  darkGray: wrap(darkGray),

  // Semantic (keep for status)
  red: wrap(red),
  green: wrap(green),
  yellow: wrap(yellow),
}

/**
 * Vaulter Blue Theme Formatter for cli-args-parser
 *
 * Maps help/version tokens to the blue palette
 */
export const vaulterFormatter: Formatter = {
  // Headers & structure
  'section-header': s => enabled ? boldWhite(s) : s,

  // Identity
  'program-name': s => enabled ? boldNeonBlue(s) : s,
  'version': s => enabled ? electricBlue(s) : s,
  'description': s => enabled ? lightGray(s) : s,

  // Commands
  'command-name': s => enabled ? neonBlue(s) : s,
  'command-alias': s => enabled ? mediumGray(s) : s,
  'command-description': s => enabled ? lightGray(s) : s,

  // Options
  'option-flag': s => enabled ? electricBlue(s) : s,
  'option-type': s => enabled ? steelBlue(s) : s,
  'option-default': s => enabled ? dimPaleBlue(s) : s,
  'option-description': s => enabled ? lightGray(s) : s,

  // Positionals
  'positional-name': s => enabled ? skyBlue(s) : s,

  // Errors (keep red for visibility)
  'error-header': s => enabled ? chain.bgRed.white.bold(` ${s} `) : s,
  'error-message': s => enabled ? red(s) : s,
  'error-option': s => enabled ? neonBlue(s) : s,
}

// Export strip utility
export { stripAnsi }

// Export template literal for external use
export { tpl }

// Style functions (wrapped for NO_COLOR)
export { bold, dim, italic, underline }

// Color functions (wrapped for NO_COLOR)
export { red, green, yellow, white, gray }

// Bright color functions using ANSI 256
export const brightRed = wrap(ansi256(196))
export const brightGreen = wrap(ansi256(46))
export const brightYellow = wrap(ansi256(226))
export const brightBlue = wrap(ansi256(39))
export const brightMagenta = wrap(ansi256(201))
export const brightCyan = wrap(ansi256(51))
export const brightWhite = wrap(ansi256(15))

// Basic colors for compatibility
export const black = wrap(ansi256(0))
export const blue = wrap(ansi256(33))
export const magenta = wrap(ansi256(165))
export const cyan = wrap(ansi256(51))

// Semantic colors for vaulter (Blue Theme)
export const c = {
  // Commands and actions - neon blue
  command: (text: string) => enabled ? boldNeonBlue(text) : text,
  subcommand: (text: string) => enabled ? neonBlue(text) : text,

  // Values and data - blue variations
  key: (text: string) => enabled ? electricBlue(text) : text,
  value: (text: string) => enabled ? iceBlue(text) : text,
  secret: (text: string) => enabled ? deepBlue(text) : text,
  config: (text: string) => enabled ? steelBlue(text) : text,

  // Type indicators (for set/list)
  secretType: (text: string) => enabled ? boldDeepBlue(text) : text,
  configType: (text: string) => enabled ? compose(bold, steelBlue)(text) : text,

  // Environments - keep distinct for safety
  env: (text: string) => enabled ? skyBlue(text) : text,
  envDev: (text: string) => enabled ? green(text) : text,      // green = safe
  envStg: (text: string) => enabled ? yellow(text) : text,    // yellow = caution
  envPrd: (text: string) => enabled ? boldRed(text) : text,   // red = danger

  // Status - keep standard colors for UX
  success: (text: string) => enabled ? green(text) : text,
  error: (text: string) => enabled ? red(text) : text,
  warning: (text: string) => enabled ? yellow(text) : text,
  info: (text: string) => enabled ? neonBlue(text) : text,

  // Diff - keep standard for visibility
  added: (text: string) => enabled ? green(text) : text,
  removed: (text: string) => enabled ? red(text) : text,
  modified: (text: string) => enabled ? yellow(text) : text,
  unchanged: (text: string) => enabled ? mediumGray(text) : text,

  // Structure
  header: (text: string) => enabled ? boldWhite(text) : text,
  label: (text: string) => enabled ? mediumGray(text) : text,
  highlight: (text: string) => enabled ? boldElectricBlue(text) : text,
  muted: (text: string) => enabled ? dim(text) : text,

  // Projects/Services - blue theme
  project: (text: string) => enabled ? boldNeonBlue(text) : text,
  service: (text: string) => enabled ? skyBlue(text) : text,
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

// Security badges with backgrounds
export const badge = {
  encrypted: () => enabled ? chain.bgGreen.black(' ENCRYPTED ') : '[ENCRYPTED]',
  decrypted: () => enabled ? chain.bgYellow.black(' DECRYPTED ') : '[DECRYPTED]',
  danger: () => enabled ? chain.bgRed.white.bold(' DANGER ') : '[DANGER]',
  secret: () => enabled ? chain.bgAnsi256(27).white(' SECRET ') : '[SECRET]',
  config: () => enabled ? chain.bgAnsi256(75).black(' CONFIG ') : '[CONFIG]',
}

// Environment badges
export const envBadge = {
  dev: () => enabled ? chain.bgGreen.black(' DEV ') : '[DEV]',
  stg: () => enabled ? chain.bgYellow.black(' STG ') : '[STG]',
  prd: () => enabled ? chain.bgRed.white.bold(' PRD ') : '[PRD]',
}

// Symbols with colors (Blue Theme)
export const symbols = {
  // Status - keep semantic colors
  success: enabled ? green('✓') : '[OK]',
  error: enabled ? red('✗') : '[ERROR]',
  warning: enabled ? yellow('⚠') : '[WARN]',
  info: enabled ? neonBlue('ℹ') : '[INFO]',

  // Navigation - blue theme
  bullet: enabled ? steelBlue('•') : '*',
  arrow: enabled ? neonBlue('→') : '->',
  arrowRight: enabled ? electricBlue('→') : '->',
  arrowLeft: enabled ? paleBlue('←') : '<-',
  arrowBoth: enabled ? skyBlue('↔') : '<->',

  // Diff - keep semantic
  plus: enabled ? green('+') : '+',
  minus: enabled ? red('-') : '-',
  equal: enabled ? mediumGray('=') : '=',
  tilde: enabled ? yellow('~') : '~',

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
