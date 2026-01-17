/**
 * Vaulter CLI - Colors Utility
 *
 * Terminal colors using tuiuiu.js text-utils
 * Supports NO_COLOR environment variable
 */

import {
  colorize,
  style,
  styles as tuiStyles,
  stripAnsi
} from 'tuiuiu.js'

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

// Semantic colors for vaulter
export const c = {
  // Commands and actions
  command: (text: string) => enabled ? style(colorize(text, 'cyan'), 'bold') : text,
  subcommand: (text: string) => color(text, 'cyan'),

  // Values and data
  key: (text: string) => color(text, 'yellowBright'),
  value: (text: string) => color(text, 'green'),
  secret: (text: string) => color(text, 'magenta'),
  config: (text: string) => color(text, 'cyan'),

  // Type indicators (for set/list)
  secretType: (text: string) => enabled ? style(colorize(text, 'magenta'), 'bold') : text,
  configType: (text: string) => enabled ? style(colorize(text, 'cyan'), 'bold') : text,

  // Environments
  env: (text: string) => color(text, 'blueBright'),
  envDev: (text: string) => color(text, 'green'),
  envStg: (text: string) => color(text, 'yellow'),
  envPrd: (text: string) => enabled ? style(colorize(text, 'red'), 'bold') : text,

  // Status
  success: (text: string) => color(text, 'greenBright'),
  error: (text: string) => color(text, 'redBright'),
  warning: (text: string) => color(text, 'yellowBright'),
  info: (text: string) => color(text, 'cyanBright'),

  // Diff
  added: (text: string) => color(text, 'green'),
  removed: (text: string) => color(text, 'red'),
  modified: (text: string) => color(text, 'yellow'),
  unchanged: (text: string) => color(text, 'gray'),

  // Structure
  header: (text: string) => enabled ? style(colorize(text, 'whiteBright'), 'bold') : text,
  label: (text: string) => color(text, 'gray'),
  highlight: (text: string) => enabled ? style(colorize(text, 'cyanBright'), 'bold') : text,
  muted: (text: string) => styled(text, 'dim'),

  // Projects/Services
  project: (text: string) => enabled ? style(colorize(text, 'magentaBright'), 'bold') : text,
  service: (text: string) => color(text, 'blueBright'),
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

// Symbols with colors
export const symbols = {
  success: enabled ? colorize('✓', 'greenBright') : '[OK]',
  error: enabled ? colorize('✗', 'redBright') : '[ERROR]',
  warning: enabled ? colorize('⚠', 'yellowBright') : '[WARN]',
  info: enabled ? colorize('ℹ', 'cyanBright') : '[INFO]',
  bullet: enabled ? colorize('•', 'gray') : '*',
  arrow: enabled ? colorize('→', 'cyan') : '->',
  arrowRight: enabled ? colorize('→', 'green') : '->',
  arrowLeft: enabled ? colorize('←', 'yellow') : '<-',
  arrowBoth: enabled ? colorize('↔', 'cyan') : '<->',
  plus: enabled ? colorize('+', 'green') : '+',
  minus: enabled ? colorize('-', 'red') : '-',
  equal: enabled ? colorize('=', 'gray') : '=',
  tilde: enabled ? colorize('~', 'yellow') : '~',
  lock: enabled ? '🔒' : '[LOCKED]',
  unlock: enabled ? '🔓' : '[UNLOCKED]',
  key: enabled ? '🔑' : '[KEY]',
  folder: enabled ? '📁' : '[DIR]',
  file: enabled ? '📄' : '[FILE]',
  package: enabled ? '📦' : '[PKG]',
  globe: enabled ? '🌐' : '[GLOBAL]',
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
