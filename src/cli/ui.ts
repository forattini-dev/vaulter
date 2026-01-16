/**
 * CLI UI utilities - TTY-aware output
 *
 * - TTY (interactive): Pretty UI with tables, colors
 * - Pipe: Clean output, no UI elements, data only to stdout
 */

import { Table, renderToString, createSpinner as tuiuiuCreateSpinner, getSpinnerConfig } from 'tuiuiu.js'
import type { SpinnerStyle } from 'tuiuiu.js'

// Detect if running in interactive terminal
export const isTTY = process.stdout.isTTY ?? false
export const isStderrTTY = process.stderr.isTTY ?? false

/**
 * Output data to stdout (for pipes)
 * This is the ONLY function that should write to stdout for data
 */
export function output(data: string): void {
  process.stdout.write(data + '\n')
}

/**
 * Output raw data without newline
 */
export function outputRaw(data: string): void {
  process.stdout.write(data)
}

/**
 * Log message to stderr (doesn't interfere with pipes)
 */
export function log(message: string): void {
  if (isTTY) {
    console.error(message)
  }
}

/**
 * Log verbose message (only in TTY mode with verbose flag)
 */
export function verbose(message: string, enabled: boolean): void {
  if (enabled) {
    console.error(`[vaulter] ${message}`)
  }
}

/**
 * Log error to stderr (always shown)
 */
export function error(message: string): void {
  console.error(`Error: ${message}`)
}

/**
 * Log success message (only in TTY mode)
 */
export function success(message: string): void {
  if (isTTY) {
    console.error(`✓ ${message}`)
  }
}

/**
 * Log warning message (always shown)
 */
export function warn(message: string): void {
  console.error(`Warning: ${message}`)
}

/**
 * Simple spinner for stderr
 * Uses tuiuiu.js spinner frames but renders imperatively to stderr
 */
export function createSpinner(text: string, style: SpinnerStyle = 'dots') {
  if (!isStderrTTY) {
    // No-op spinner for non-TTY
    return {
      start: () => { console.error(text) },
      stop: () => {},
      update: (_text: string) => {},
      succeed: (msg?: string) => { if (msg) console.error(`✓ ${msg}`) },
      fail: (msg?: string) => { if (msg) console.error(`✗ ${msg}`) }
    }
  }

  const config = getSpinnerConfig(style)
  let frameIndex = 0
  let interval: ReturnType<typeof setInterval> | null = null
  let currentText = text

  const render = () => {
    const frame = config.frames[frameIndex % config.frames.length]
    process.stderr.write(`\r\x1b[K${frame} ${currentText}`)
    frameIndex++
  }

  return {
    start: () => {
      render()
      interval = setInterval(render, config.interval)
    },
    stop: (finalText?: string) => {
      if (interval) clearInterval(interval)
      process.stderr.write(`\r\x1b[K`)
      if (finalText) console.error(finalText)
    },
    update: (newText: string) => {
      currentText = newText
    },
    succeed: (msg?: string) => {
      if (interval) clearInterval(interval)
      process.stderr.write(`\r\x1b[K`)
      console.error(`✓ ${msg || currentText}`)
    },
    fail: (msg?: string) => {
      if (interval) clearInterval(interval)
      process.stderr.write(`\r\x1b[K`)
      console.error(`✗ ${msg || currentText}`)
    }
  }
}

/**
 * Format data as a table using tuiuiu.js
 */
export function formatTable(
  columns: Array<{ key: string; header: string; align?: 'left' | 'center' | 'right' }>,
  data: Array<Record<string, any>>,
  options: { borderStyle?: 'single' | 'round' | 'ascii' | 'none' } = {}
): string {
  if (!isTTY) {
    // Simple tab-separated output for pipes
    const headers = columns.map(c => c.header).join('\t')
    const rows = data.map(row => columns.map(c => String(row[c.key] ?? '')).join('\t'))
    return [headers, ...rows].join('\n')
  }

  // Pretty table for TTY using tuiuiu.js
  const table = Table({
    columns: columns.map(c => ({
      key: c.key,
      header: c.header,
      align: c.align || 'left'
    })),
    data,
    borderStyle: options.borderStyle || 'round',
    showHeader: true
  })

  return renderToString(table)
}

/**
 * Format simple rows as a table (shorthand)
 */
export function formatSimpleTable(
  headers: string[],
  rows: string[][]
): string {
  if (!isTTY) {
    return rows.map(row => row.join('\t')).join('\n')
  }

  const columns = headers.map((h, i) => ({ key: `col${i}`, header: h }))
  const data = rows.map(row => {
    const obj: Record<string, string> = {}
    row.forEach((cell, i) => { obj[`col${i}`] = cell })
    return obj
  })

  return formatTable(columns, data)
}

/**
 * Format key-value pairs
 */
export function formatKeyValue(pairs: Array<[string, string]>, separator = '='): string {
  if (!isTTY) {
    return pairs.map(([k, v]) => `${k}${separator}${v}`).join('\n')
  }

  const maxKeyLen = Math.max(...pairs.map(([k]) => k.length))
  return pairs
    .map(([k, v]) => `${k.padEnd(maxKeyLen)} ${separator} ${v}`)
    .join('\n')
}

/**
 * Wrap an async operation with a spinner
 */
export async function withSpinner<T>(
  text: string,
  operation: () => Promise<T>,
  options: { successText?: string; failText?: string } = {}
): Promise<T> {
  const spinner = createSpinner(text)
  spinner.start()

  try {
    const result = await operation()
    spinner.succeed(options.successText)
    return result
  } catch (err) {
    spinner.fail(options.failText)
    throw err
  }
}

/**
 * Print a styled header (only in TTY mode)
 */
export function header(text: string): void {
  if (isTTY) {
    console.error(`\n${text}\n${'─'.repeat(text.length)}`)
  }
}

/**
 * Print a divider line (only in TTY mode)
 */
export function divider(): void {
  if (isTTY) {
    console.error('─'.repeat(40))
  }
}
