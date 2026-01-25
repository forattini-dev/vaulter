import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'releases/**',
        '**/*.d.ts',
        'vitest.config.ts',
        'esbuild.config.js',
        'src/cli/**',
        'src/mcp/**',
        'src/load.ts',
        'src/action/**',        // GitHub Actions specific
        'src/index.ts',         // Re-exports only
        'src/runtime/index.ts', // Re-exports only
        'src/runtime/types.ts', // Types only
        'src/runtime/load.ts'   // Side-effect import wrapper
      ],
      thresholds: {
        statements: 84,
        branches: 77,
        functions: 88,
        lines: 85
      }
    },
    testTimeout: 30000
  }
})
