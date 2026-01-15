/**
 * Tests for loader.ts (dotenv integration)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loader, parse } from '../src/loader.js'

describe('loader', () => {
  let tempDir: string
  let originalCwd: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minienv-loader-test-'))
    originalCwd = process.cwd()
    originalEnv = { ...process.env }
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    process.env = originalEnv
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('loader()', () => {
    it('should load .env file into process.env', () => {
      fs.writeFileSync(path.join(tempDir, '.env'), 'LOADER_TEST_VAR=hello')

      const result = loader()

      expect(result.error).toBeUndefined()
      expect(process.env.LOADER_TEST_VAR).toBe('hello')
    })

    it('should load custom path', () => {
      fs.writeFileSync(path.join(tempDir, '.env.custom'), 'CUSTOM_VAR=custom_value')

      const result = loader({ path: '.env.custom' })

      expect(result.error).toBeUndefined()
      expect(process.env.CUSTOM_VAR).toBe('custom_value')
    })

    it('should not override existing env vars by default', () => {
      process.env.EXISTING_VAR = 'original'
      fs.writeFileSync(path.join(tempDir, '.env'), 'EXISTING_VAR=new_value')

      loader()

      expect(process.env.EXISTING_VAR).toBe('original')
    })

    it('should override with override option', () => {
      process.env.OVERRIDE_VAR = 'original'
      fs.writeFileSync(path.join(tempDir, '.env'), 'OVERRIDE_VAR=overridden')

      loader({ override: true })

      expect(process.env.OVERRIDE_VAR).toBe('overridden')
    })

    it('should return parsed values', () => {
      fs.writeFileSync(path.join(tempDir, '.env'), 'FOO=bar\nBAZ=qux')

      const result = loader()

      expect(result.parsed).toEqual({ FOO: 'bar', BAZ: 'qux' })
    })

    it('should return error for non-existent file', () => {
      const result = loader({ path: 'non-existent.env' })

      expect(result.error).toBeDefined()
    })
  })

  describe('parse()', () => {
    it('should parse env string without modifying process.env', () => {
      const envString = 'PARSE_VAR=parsed_value'
      const originalValue = process.env.PARSE_VAR

      const result = parse(envString)

      expect(result).toEqual({ PARSE_VAR: 'parsed_value' })
      expect(process.env.PARSE_VAR).toBe(originalValue)
    })

    it('should parse multiple variables', () => {
      const envString = `
FOO=bar
BAZ=qux
NUMBER=123
`
      const result = parse(envString)

      expect(result).toEqual({
        FOO: 'bar',
        BAZ: 'qux',
        NUMBER: '123'
      })
    })

    it('should handle quoted values', () => {
      const envString = 'QUOTED="hello world"'
      const result = parse(envString)

      expect(result.QUOTED).toBe('hello world')
    })

    it('should handle empty string', () => {
      const result = parse('')
      expect(result).toEqual({})
    })
  })
})
