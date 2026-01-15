/**
 * Tests for env-parser.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseEnvFile, parseEnvString, serializeEnv, hasStdinData } from '../../src/lib/env-parser.js'

describe('env-parser', () => {
  describe('parseEnvString', () => {
    it('should parse simple key=value pairs', () => {
      const content = `
FOO=bar
BAZ=qux
`
      const result = parseEnvString(content)
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
    })

    it('should skip empty lines', () => {
      const content = `
FOO=bar

BAZ=qux
`
      const result = parseEnvString(content)
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
    })

    it('should skip comment lines starting with #', () => {
      const content = `
# This is a comment
FOO=bar
# Another comment
BAZ=qux
`
      const result = parseEnvString(content)
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
    })

    it('should skip comment lines starting with ;', () => {
      const content = `
; This is a comment
FOO=bar
`
      const result = parseEnvString(content)
      expect(result).toEqual({ FOO: 'bar' })
    })

    it('should handle inline comments in unquoted values', () => {
      const content = `FOO=bar # this is a comment`
      const result = parseEnvString(content)
      expect(result).toEqual({ FOO: 'bar' })
    })

    it('should handle spaces around equals sign', () => {
      const content = `FOO = bar`
      const result = parseEnvString(content)
      expect(result).toEqual({ FOO: 'bar' })
    })

    it('should skip invalid lines', () => {
      const content = `
FOO=bar
invalid line without equals
BAZ=qux
`
      const result = parseEnvString(content)
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
    })

    it('should handle keys with numbers and underscores', () => {
      const content = `
MY_VAR_1=value1
_PRIVATE=secret
VAR2=value2
`
      const result = parseEnvString(content)
      expect(result).toEqual({
        MY_VAR_1: 'value1',
        _PRIVATE: 'secret',
        VAR2: 'value2'
      })
    })

    describe('double quotes', () => {
      it('should parse double-quoted values', () => {
        const content = `FOO="bar baz"`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'bar baz' })
      })

      it('should handle escape sequences in double quotes', () => {
        const content = `FOO="line1\\nline2\\ttab"`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'line1\nline2\ttab' })
      })

      it('should handle escaped double quote', () => {
        const content = `FOO="say \\"hello\\""`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'say "hello"' })
      })

      it('should handle escaped backslash', () => {
        const content = `FOO="path\\\\to\\\\file"`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'path\\to\\file' })
      })

      it('should handle escaped dollar sign', () => {
        const content = `FOO="price is \\$10"`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'price is $10' })
      })

      it('should handle carriage return escape', () => {
        const content = `FOO="line1\\rline2"`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'line1\rline2' })
      })

      it('should preserve unknown escapes', () => {
        const content = `FOO="test\\x"`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'test\\x' })
      })

      it('should handle multiline double-quoted values', () => {
        const content = `FOO="line1
line2
line3"`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'line1\nline2\nline3' })
      })
    })

    describe('single quotes', () => {
      it('should parse single-quoted values literally', () => {
        const content = `FOO='bar baz'`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'bar baz' })
      })

      it('should not process escapes in single quotes', () => {
        const content = `FOO='line1\\nline2'`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'line1\\nline2' })
      })

      it('should handle escaped single quote (doubled)', () => {
        const content = `FOO='it''s working'`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: "it's working" })
      })

      it('should handle multiline single-quoted values', () => {
        const content = `FOO='line1
line2'`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'line1\nline2' })
      })
    })

    describe('backtick quotes', () => {
      it('should parse backtick-quoted values', () => {
        const content = 'FOO=`bar baz`'
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'bar baz' })
      })

      it('should handle multiline backtick-quoted values', () => {
        const content = 'FOO=`line1\nline2`'
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'line1\nline2' })
      })
    })

    describe('variable expansion', () => {
      it('should expand ${VAR} syntax', () => {
        const content = `
BASE=/home/user
PATH=\${BASE}/bin
`
        const result = parseEnvString(content)
        expect(result).toEqual({
          BASE: '/home/user',
          PATH: '/home/user/bin'
        })
      })

      it('should expand $VAR syntax', () => {
        const content = `
BASE=/home/user
PATH=$BASE/bin
`
        const result = parseEnvString(content)
        expect(result).toEqual({
          BASE: '/home/user',
          PATH: '/home/user/bin'
        })
      })

      it('should expand ${VAR:-default} with default when VAR is missing', () => {
        const content = `FOO=\${MISSING:-default_value}`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'default_value' })
      })

      it('should expand ${VAR:-default} with VAR when present', () => {
        const content = `
EXISTING=real_value
FOO=\${EXISTING:-default_value}
`
        const result = parseEnvString(content)
        expect(result).toEqual({
          EXISTING: 'real_value',
          FOO: 'real_value'
        })
      })

      it('should expand from provided env option', () => {
        const content = `FOO=\${EXTERNAL_VAR}`
        const result = parseEnvString(content, { env: { EXTERNAL_VAR: 'external' } })
        expect(result).toEqual({ FOO: 'external' })
      })

      it('should disable expansion when expand=false', () => {
        const content = `FOO=\${BAR}`
        const result = parseEnvString(content, { expand: false })
        expect(result).toEqual({ FOO: '${BAR}' })
      })

      it('should replace undefined variables with empty string', () => {
        const content = `FOO=prefix_\${UNDEFINED}_suffix`
        const result = parseEnvString(content, { env: {} })
        expect(result).toEqual({ FOO: 'prefix__suffix' })
      })
    })

    describe('edge cases', () => {
      it('should handle empty value', () => {
        const content = `FOO=`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: '' })
      })

      it('should handle empty quoted value', () => {
        const content = `FOO=""`
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: '' })
      })

      it('should handle Windows line endings', () => {
        const content = "FOO=bar\r\nBAZ=qux\r\n"
        const result = parseEnvString(content)
        expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
      })

      it('should handle value with equals sign', () => {
        const content = `DATABASE_URL="postgres://user:pass@host/db?ssl=true"`
        const result = parseEnvString(content)
        expect(result).toEqual({ DATABASE_URL: 'postgres://user:pass@host/db?ssl=true' })
      })

      it('should handle empty string input', () => {
        const result = parseEnvString('')
        expect(result).toEqual({})
      })

      it('should handle unclosed double quote', () => {
        const content = `FOO="unclosed`
        const result = parseEnvString(content)
        expect(result.FOO).toBeDefined()
      })

      it('should handle unclosed single quote', () => {
        const content = `FOO='unclosed`
        const result = parseEnvString(content)
        expect(result.FOO).toBeDefined()
      })

      it('should handle unclosed backtick', () => {
        const content = 'FOO=`unclosed'
        const result = parseEnvString(content)
        expect(result.FOO).toBeDefined()
      })
    })
  })

  describe('parseEnvFile', () => {
    let tempDir: string
    let tempFile: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaulter-test-'))
      tempFile = path.join(tempDir, '.env')
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('should parse env file from path', () => {
      fs.writeFileSync(tempFile, 'FOO=bar\nBAZ=qux')
      const result = parseEnvFile(tempFile)
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
    })

    it('should pass options to parseEnvString', () => {
      fs.writeFileSync(tempFile, 'FOO=${BAR}')
      const result = parseEnvFile(tempFile, { expand: false })
      expect(result).toEqual({ FOO: '${BAR}' })
    })

    it('should throw on non-existent file', () => {
      expect(() => parseEnvFile('/non/existent/file')).toThrow()
    })
  })

  describe('serializeEnv', () => {
    it('should serialize simple values', () => {
      const env = { FOO: 'bar', BAZ: 'qux' }
      const result = serializeEnv(env)
      expect(result).toBe('FOO=bar\nBAZ=qux')
    })

    it('should quote values with spaces', () => {
      const env = { FOO: 'hello world' }
      const result = serializeEnv(env)
      expect(result).toBe('FOO="hello world"')
    })

    it('should quote values with newlines and escape them', () => {
      const env = { FOO: 'line1\nline2' }
      const result = serializeEnv(env)
      expect(result).toBe('FOO="line1\\nline2"')
    })

    it('should quote and escape values with double quotes', () => {
      const env = { FOO: 'say "hello"' }
      const result = serializeEnv(env)
      expect(result).toBe('FOO="say \\"hello\\""')
    })

    it('should quote values with hash', () => {
      const env = { FOO: 'test#value' }
      const result = serializeEnv(env)
      expect(result).toBe('FOO="test#value"')
    })

    it('should quote values with dollar sign', () => {
      const env = { PRICE: '$100' }
      const result = serializeEnv(env)
      expect(result).toBe('PRICE="$100"')
    })

    it('should quote values with equals sign', () => {
      const env = { EQUATION: 'x=1' }
      const result = serializeEnv(env)
      expect(result).toBe('EQUATION="x=1"')
    })

    it('should quote values with single quotes', () => {
      const env = { FOO: "it's" }
      const result = serializeEnv(env)
      expect(result).toBe('FOO="it\'s"')
    })

    it('should handle backslashes in unquoted values', () => {
      // Backslashes alone don't trigger quoting
      const env = { PATH: 'C:\\Users\\test' }
      const result = serializeEnv(env)
      expect(result).toBe('PATH=C:\\Users\\test')
    })

    it('should handle tabs and carriage returns in unquoted values', () => {
      // Tabs and carriage returns alone don't trigger quoting
      const env = { FOO: 'a\tb\rc' }
      const result = serializeEnv(env)
      expect(result).toBe('FOO=a\tb\rc')
    })

    it('should escape backslashes when value needs quoting', () => {
      // Value with space triggers quoting, then backslashes are escaped
      const env = { PATH: 'C:\\Users\\my folder' }
      const result = serializeEnv(env)
      expect(result).toBe('PATH="C:\\\\Users\\\\my folder"')
    })

    it('should handle empty object', () => {
      const result = serializeEnv({})
      expect(result).toBe('')
    })
  })

  describe('hasStdinData', () => {
    it('should return boolean based on TTY status', () => {
      // This test just verifies the function returns a boolean
      const result = hasStdinData()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('roundtrip', () => {
    it('should preserve values through parse -> serialize -> parse', () => {
      const original = {
        SIMPLE: 'value',
        WITH_SPACE: 'hello world',
        WITH_NEWLINE: 'line1\nline2',
        WITH_QUOTE: 'say "hi"',
        WITH_TAB: 'col1\tcol2'
      }

      const serialized = serializeEnv(original)
      const parsed = parseEnvString(serialized, { expand: false })

      expect(parsed).toEqual(original)
    })
  })
})
