/**
 * Vaulter MCP Server Entry Point
 *
 * Run with: npx vaulter-mcp
 * Or: node dist/mcp/index.js
 */

// Preload must be first - sets process.maxListeners before other imports
import './preload.js'

import { startServer } from './server.js'

startServer().catch((error) => {
  console.error('Failed to start MCP server:', error)
  process.exit(1)
})
