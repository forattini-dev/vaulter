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
        'src/load.ts'
      ]
    },
    testTimeout: 10000
  }
})
