/**
 * MiniEnv - Auto-load environment variables
 *
 * Import this module to automatically load .env files into process.env
 *
 * Usage:
 *   import 'minienv/load'
 *
 * This is equivalent to:
 *   import dotenv from 'dotenv'
 *   dotenv.config()
 */

import dotenv from 'dotenv'

dotenv.config()
